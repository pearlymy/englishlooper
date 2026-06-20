import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Project, Folder } from '../types';
import { DBService } from './dbService';

const PROJECTS_KEY = '@mp3looper_projects';
const FOLDERS_KEY = '@mp3looper_folders';

export class StorageService {
  // Lấy toàn bộ danh sách projects
  static async loadProjects(): Promise<Project[]> {
    try {
      const json = await AsyncStorage.getItem(PROJECTS_KEY);
      if (!json) return [];
      const projects: Project[] = JSON.parse(json);
      // Sắp xếp theo ngày cập nhật (lastOpenedAt hoặc createdAt) mới nhất
      return projects.sort((a, b) => (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));
    } catch (err) {
      console.error('Lỗi đọc projects từ storage:', err);
      return [];
    }
  }

  // Lưu 1 project mới (thêm vào danh sách)
  static async saveProject(project: Project): Promise<void> {
    try {
      const projects = await this.loadProjects();
      // Kiểm tra trùng ID
      const existingIndex = projects.findIndex(p => p.id === project.id);
      if (existingIndex !== -1) {
        projects[existingIndex] = project;
      } else {
        projects.unshift(project);
      }
      await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    } catch (err) {
      console.error('Lỗi lưu project:', err);
      throw err;
    }
  }

  // Cập nhật project đã tồn tại (segments, progress, v.v.)
  static async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    try {
      const projects = await this.loadProjects();
      const index = projects.findIndex(p => p.id === projectId);
      if (index === -1) return;

      projects[index] = { ...projects[index], ...updates };
      await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    } catch (err) {
      console.error('Lỗi cập nhật project:', err);
      throw err;
    }
  }

  // Xóa tệp nhạc của project khỏi bộ nhớ lâu dài
  static async deleteProjectFiles(projectId: string, audioUri: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        await DBService.deleteAudio(projectId);
      } else {
        if (audioUri && audioUri.startsWith('file://')) {
          const fileInfo = await FileSystem.getInfoAsync(audioUri);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(audioUri, { idempotent: true });
          }
        }
      }
    } catch (err) {
      console.warn('Lỗi dọn dẹp file cho project:', projectId, err);
    }
  }

  // Xóa 1 project
  static async deleteProject(projectId: string): Promise<void> {
    try {
      const projects = await this.loadProjects();
      const project = projects.find(p => p.id === projectId);
      if (project) {
        await this.deleteProjectFiles(projectId, project.audioUri);
      }
      const filtered = projects.filter(p => p.id !== projectId);
      await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(filtered));
    } catch (err) {
      console.error('Lỗi xóa project:', err);
      throw err;
    }
  }

  // Lấy 1 project theo ID
  static async getProject(projectId: string): Promise<Project | null> {
    try {
      const projects = await this.loadProjects();
      return projects.find(p => p.id === projectId) || null;
    } catch (err) {
      console.error('Lỗi tìm project:', err);
      return null;
    }
  }

  // Lấy toàn bộ danh sách folders
  static async loadFolders(): Promise<Folder[]> {
    try {
      const json = await AsyncStorage.getItem(FOLDERS_KEY);
      if (!json) return [];
      const folders: Folder[] = JSON.parse(json);
      return folders.sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      console.error('Lỗi đọc folders từ storage:', err);
      return [];
    }
  }

  // Lưu 1 folder mới hoặc cập nhật
  static async saveFolder(folder: Folder): Promise<void> {
    try {
      const folders = await this.loadFolders();
      const existingIndex = folders.findIndex(f => f.id === folder.id);
      if (existingIndex !== -1) {
        folders[existingIndex] = folder;
      } else {
        folders.unshift(folder);
      }
      await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch (err) {
      console.error('Lỗi lưu folder:', err);
      throw err;
    }
  }

  // Xóa 1 folder (và xóa toàn bộ projects con bên trong)
  static async deleteFolder(folderId: string): Promise<void> {
    try {
      // 1. Xóa folder
      const folders = await this.loadFolders();
      const filteredFolders = folders.filter(f => f.id !== folderId);
      await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(filteredFolders));

      // 2. Xóa các project con liên quan và tệp nhạc của chúng
      const projects = await this.loadProjects();
      const folderProjects = projects.filter(p => p.folderId === folderId);
      for (const p of folderProjects) {
        await this.deleteProjectFiles(p.id, p.audioUri);
      }

      const filteredProjects = projects.filter(p => p.folderId !== folderId);
      await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(filteredProjects));
    } catch (err) {
      console.error('Lỗi xóa folder:', err);
      throw err;
    }
  }
}
