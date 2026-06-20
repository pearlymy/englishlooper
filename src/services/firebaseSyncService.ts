import { doc, setDoc, deleteDoc, collection, getDocs, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBlob, deleteObject, getMetadata } from 'firebase/storage';
import { db, storage, auth } from './firebaseConfig';
import { Project, Folder } from '../types';
import { StorageService } from './storageService';
import { DBService } from './dbService';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export class FirebaseSyncService {
  // Check if user is logged in
  static getUserId(): string | null {
    return auth.currentUser ? auth.currentUser.uid : null;
  }

  // Check if online (on Web, check navigator.onLine)
  static isOnline(): boolean {
    if (Platform.OS === 'web') {
      return navigator.onLine;
    }
    return true; // Simple fallback for native
  }

  // --- FOLDERS SYNC ---

  static async uploadFolder(folder: Folder): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      const docRef = doc(db, 'users', uid, 'folders', folder.id);
      await setDoc(docRef, {
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt
      });
    } catch (err) {
      console.error('Error uploading folder to Firestore:', err);
    }
  }

  static async deleteFolder(folderId: string): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      const docRef = doc(db, 'users', uid, 'folders', folderId);
      await deleteDoc(docRef);
    } catch (err) {
      console.error('Error deleting folder from Firestore:', err);
    }
  }

  // --- PROJECTS SYNC ---

  static async uploadProject(project: Project): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      // 1. Upload project metadata to Firestore
      const docRef = doc(db, 'users', uid, 'projects', project.id);
      // Strip actual object URLs or local native paths so that they don't overwrite server config with temporary/local URIs.
      // We store a relative placeholder on the server.
      const projectToUpload = JSON.parse(JSON.stringify({
        ...project,
        audioUri: `db:${project.id}` // Keep normalized format on server
      })); // JSON.parse(JSON.stringify()) strips all undefined values that Firestore rejects
      await setDoc(docRef, projectToUpload);

      // 2. Upload the MP3 file to Firebase Storage in background
      this.uploadAudioFile(project.id, project.audioUri, false)
        .catch(err => console.warn('Background audio upload failed inside uploadProject:', err));
    } catch (err) {
      console.error('Error uploading project to Firestore:', err);
    }
  }

  static async uploadAudioFile(projectId: string, audioUri: string, force: boolean = false): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      const storageRef = ref(storage, `users/${uid}/projects/${projectId}/audio.mp3`);

      // If not forcing, check if the file already exists on Storage to save bandwidth
      if (!force) {
        try {
          await getMetadata(storageRef);
          console.log(`Audio file for project ${projectId} already exists on Firebase Storage. Skipping upload.`);
          return;
        } catch (metadataErr) {
          // File does not exist (or other error), proceed to upload
        }
      }

      console.log(`Uploading audio file for project ${projectId} to Firebase Storage...`);
      let blob: Blob | null = null;

      if (Platform.OS === 'web') {
        blob = await DBService.getAudio(projectId);
      } else {
        // Resolve path to ensure correct prefix
        const localPath = audioUri.startsWith('file://') ? audioUri : `${FileSystem.documentDirectory}${projectId}.mp3`;
        const response = await fetch(localPath);
        blob = await response.blob();
      }

      if (!blob) {
        console.warn(`No audio file found locally to upload for project ${projectId}`);
        return;
      }

      await uploadBytes(storageRef, blob);
      console.log(`Successfully uploaded audio file for project ${projectId} to Firebase Storage.`);
    } catch (err) {
      console.error(`Error uploading audio file to Firebase Storage for project ${projectId}:`, err);
    }
  }

  static async deleteProject(projectId: string): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      // 1. Delete Firestore document
      const docRef = doc(db, 'users', uid, 'projects', projectId);
      await deleteDoc(docRef);

      // 2. Delete Storage file
      const storageRef = ref(storage, `users/${uid}/projects/${projectId}/audio.mp3`);
      await deleteObject(storageRef).catch(() => {});
    } catch (err) {
      console.error('Error deleting project from Firebase:', err);
    }
  }
  static async getProjectFromFirestore(projectId: string): Promise<Project | null> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return null;

    try {
      const docRef = doc(db, 'users', uid, 'projects', projectId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as Project;
      }
      return null;
    } catch (err) {
      console.error('Error fetching project from Firestore:', err);
      return null;
    }
  }
  // --- SYNC DOWN (ON LOGIN) ---

  static async syncDownAll(): Promise<void> {
    const uid = this.getUserId();
    if (!uid || !this.isOnline()) return;

    try {
      // 1. Fetch current server folders and projects
      const foldersColl = collection(db, 'users', uid, 'folders');
      const foldersSnapshot = await getDocs(foldersColl);
      const serverFolders: Folder[] = [];
      foldersSnapshot.forEach((doc) => {
        serverFolders.push(doc.data() as Folder);
      });

      const projectsColl = collection(db, 'users', uid, 'projects');
      const projectsSnapshot = await getDocs(projectsColl);
      const serverProjects: Project[] = [];
      projectsSnapshot.forEach((doc) => {
        serverProjects.push(doc.data() as Project);
      });

      // 2. Upload local folders that don't exist on server
      const localFolders = await StorageService.loadFolders();
      for (const lf of localFolders) {
        const sf = serverFolders.find(f => f.id === lf.id);
        if (!sf) {
          await this.uploadFolder(lf);
        }
      }

      // 3. Upload local projects that don't exist on server OR are newer
      const localProjects = await StorageService.loadProjects();
      for (const lp of localProjects) {
        const sp = serverProjects.find(p => p.id === lp.id);
        if (!sp) {
          await this.uploadProject(lp);
        } else {
          const lpTime = lp.lastOpenedAt || lp.createdAt;
          const spTime = sp.lastOpenedAt || sp.createdAt;
          if (lpTime > spTime) {
            await this.uploadProject(lp);
          }
        }
      }

      // 4. Fetch final updated server folders and projects
      const finalFoldersSnapshot = await getDocs(foldersColl);
      const finalServerFolders: Folder[] = [];
      finalFoldersSnapshot.forEach((doc) => {
        finalServerFolders.push(doc.data() as Folder);
      });

      const finalProjectsSnapshot = await getDocs(projectsColl);
      const finalServerProjects: Project[] = [];
      finalProjectsSnapshot.forEach((doc) => {
        finalServerProjects.push(doc.data() as Project);
      });

      // 5. Merge server folders to local storage
      const mergedFolders = [...localFolders];
      for (const sf of finalServerFolders) {
        const idx = mergedFolders.findIndex(f => f.id === sf.id);
        if (idx !== -1) {
          mergedFolders[idx] = sf;
        } else {
          mergedFolders.push(sf);
        }
      }
      // Save all folders locally
      for (const f of mergedFolders) {
        await StorageService.saveFolder(f);
      }

      // 6. Merge server projects to local storage
      const mergedProjects = [...localProjects];
      for (const sp of finalServerProjects) {
        let mappedProject = { ...sp };
        if (Platform.OS !== 'web') {
          mappedProject.audioUri = `${FileSystem.documentDirectory}${sp.id}.mp3`;
        } else {
          mappedProject.audioUri = `db:${sp.id}`;
        }

        const idx = mergedProjects.findIndex(p => p.id === sp.id);
        if (idx !== -1) {
          const lpTime = mergedProjects[idx].lastOpenedAt || mergedProjects[idx].createdAt;
          const spTime = sp.lastOpenedAt || sp.createdAt;
          if (spTime >= lpTime) {
            mergedProjects[idx] = mappedProject;
          }
        } else {
          mergedProjects.push(mappedProject);
        }
      }

      // Save all projects locally
      for (const p of mergedProjects) {
        await StorageService.saveProject(p);
      }
    } catch (err) {
      console.error('Error during full sync down:', err);
      throw err;
    }
  }

  // --- LAZY AUDIO RESOLVER ---

  static async resolveAndDownloadAudio(projectId: string, currentUri: string): Promise<string> {
    // 1. Always check and resolve local files first, regardless of auth state,
    // which handles IndexedDB on Web and dynamically prepending the fresh FileSystem.documentDirectory on Mobile.
    try {
      if (Platform.OS === 'web') {
        const exists = await DBService.getAudio(projectId);
        if (exists) {
          return URL.createObjectURL(exists);
        }
      } else {
        const localPath = `${FileSystem.documentDirectory}${projectId}.mp3`;
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
          return localPath;
        }
      }
    } catch (err) {
      console.warn(`Local file resolution failed for project ${projectId}:`, err);
    }

    // 2. Try to download from Firebase Storage if not found locally and user is logged in
    const uid = this.getUserId();
    if (uid && this.isOnline()) {
      try {
        console.log(`Downloading audio file from Firebase Storage for project: ${projectId}`);
        const storageRef = ref(storage, `users/${uid}/projects/${projectId}/audio.mp3`);

        if (Platform.OS === 'web') {
          // Use Firebase SDK getBlob() to bypass CORS restrictions
          const blob = await getBlob(storageRef);
          await DBService.saveAudio(projectId, blob);
          console.log(`Successfully downloaded audio from Firebase Storage for project: ${projectId}`);
          return URL.createObjectURL(blob);
        } else {
          const downloadUrl = await getDownloadURL(storageRef);
          const localPath = `${FileSystem.documentDirectory}${projectId}.mp3`;
          await FileSystem.downloadAsync(downloadUrl, localPath);
          return localPath;
        }
      } catch (err) {
        console.error(`Error downloading audio file from Firebase Storage for project ${projectId}:`, err);
      }
    }

    throw new Error('AUDIO_NOT_FOUND: Tệp âm thanh cục bộ không tìm thấy và không thể tải xuống từ đám mây. Vui lòng chọn lại tệp âm thanh.');
  }
}
