import { Platform } from 'react-native';

const DB_NAME = 'mp3looper_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_files';

export class DBService {
  private static db: IDBDatabase | null = null;

  private static initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (Platform.OS !== 'web') {
        reject(new Error('IndexedDB is only supported on Web platform.'));
        return;
      }

      if (this.db) {
        resolve(this.db);
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  // Lưu file audio (Blob/File) vào IndexedDB
  static async saveAudio(projectId: string, audioBlob: Blob): Promise<void> {
    if (Platform.OS !== 'web') return;

    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(audioBlob, projectId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Lỗi saveAudio vào IndexedDB:', err);
      throw err;
    }
  }

  // Lấy file audio (Blob) từ IndexedDB
  static async getAudio(projectId: string): Promise<Blob | null> {
    if (Platform.OS !== 'web') return null;

    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(projectId);

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Lỗi getAudio từ IndexedDB:', err);
      return null;
    }
  }

  // Xóa file audio khỏi IndexedDB
  static async deleteAudio(projectId: string): Promise<void> {
    if (Platform.OS !== 'web') return;

    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(projectId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Lỗi deleteAudio từ IndexedDB:', err);
      throw err;
    }
  }
}
