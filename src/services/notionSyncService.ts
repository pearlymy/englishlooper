import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Project } from '../types';
import { StorageService } from './storageService';

const NOTION_KEY_PREFIX = '@notion_api_key';
const NOTION_DB_PREFIX = '@notion_db_id';
const DEFAULT_DB_ID = '36a9aa24e8b48038ab29d0b4c7b9a501';

export class NotionSyncService {
  // Load API Key
  static async getApiKey(): Promise<string> {
    try {
      const key = await AsyncStorage.getItem(NOTION_KEY_PREFIX);
      return key || '';
    } catch {
      return '';
    }
  }

  // Save API Key
  static async setApiKey(key: string): Promise<void> {
    try {
      await AsyncStorage.setItem(NOTION_KEY_PREFIX, key.trim());
    } catch (err) {
      console.warn('Failed to save Notion API key:', err);
    }
  }

  // Load Database ID
  static async getDatabaseId(): Promise<string> {
    try {
      const id = await AsyncStorage.getItem(NOTION_DB_PREFIX);
      return id || DEFAULT_DB_ID;
    } catch {
      return DEFAULT_DB_ID;
    }
  }

  // Save Database ID
  static async setDatabaseId(id: string): Promise<void> {
    try {
      await AsyncStorage.setItem(NOTION_DB_PREFIX, id.trim());
    } catch (err) {
      console.warn('Failed to save Notion Database ID:', err);
    }
  }

  // Format headers for Notion API requests
  private static async getHeaders(token: string) {
    return {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
  }

  // Get API URL using a transparent CORS proxy for web browsers
  private static getApiUrl(path: string): string {
    const baseUrl = `https://api.notion.com${path}`;
    if (Platform.OS === 'web') {
      return `https://corsproxy.io/?${baseUrl}`;
    }
    return baseUrl;
  }

  // Check if a page for the project already exists in the Notion Database
  static async findProjectPageId(
    projectId: string, 
    token: string, 
    dbId: string,
    projectIdKey?: string,
    titleKey?: string
  ): Promise<string | null> {
    const headers = await this.getHeaders(token);
    const url = this.getApiUrl(`/v1/databases/${dbId}/query`);

    // If projectIdKey exists in database, query by ProjectID property
    if (projectIdKey) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filter: {
              property: projectIdKey,
              rich_text: {
                equals: projectId
              }
            }
          })
        });

        if (response.ok) {
          const json = await response.json();
          if (json.results && json.results.length > 0) {
            return json.results[0].id;
          }
        }
      } catch (err) {
        console.warn('[NotionSync] Query by dynamic ProjectID property failed:', err);
      }
    }

    // Fallback: Search by titleKey
    const activeTitleKey = titleKey || 'Name';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            property: activeTitleKey,
            title: {
              contains: projectId
            }
          }
        })
      });

      if (response.ok) {
        const json = await response.json();
        if (json.results && json.results.length > 0) {
          return json.results[0].id;
        }
      }
    } catch (err) {
      console.warn('[NotionSync] Fallback search by titleKey failed:', err);
    }
    return null;
  }

  // Calculate project progress percentage
  private static getProgress(project: Project): number {
    if (!project.segments || !project.segments.length) return 0;
    const mastered = project.segments.filter(s => s.status === 'mastered').length;
    return Math.round((mastered / project.segments.length) * 100);
  }

  // Sync a single project to Notion
  static async syncProject(project: Project): Promise<boolean> {
    const token = await this.getApiKey();
    const dbId = await this.getDatabaseId();
    if (!token || !dbId) {
      console.log('[NotionSync] Sync skipped: Notion token or Database ID is missing.');
      return false;
    }

    try {
      console.log(`[NotionSync] Starting sync for lesson: "${project.title}" (${project.id})`);
      const headers = await this.getHeaders(token);

      // 1. Fetch database properties to map keys dynamically (resilient to column renaming)
      const dbUrl = this.getApiUrl(`/v1/databases/${dbId}`);
      const dbResponse = await fetch(dbUrl, { headers });
      if (!dbResponse.ok) {
        const dbErr = await dbResponse.json().catch(() => ({}));
        throw new Error(dbErr.message || 'Không thể kết nối tới Notion Database (kiểm tra Token/DB ID)');
      }
      
      const dbInfo = await dbResponse.json();
      const schema = dbInfo.properties || {};
      
      // Find keys dynamically by scanning types and lowercased names
      let titleKey = '';
      let projectIdKey = '';
      let progressKey = '';
      let folderKey = '';
      let durationKey = '';
      let segmentsKey = '';
      
      for (const key of Object.keys(schema)) {
        const type = schema[key].type;
        if (type === 'title') {
          titleKey = key;
        } else if (key.toLowerCase() === 'projectid') {
          projectIdKey = key;
        } else if (key.toLowerCase() === 'progress') {
          progressKey = key;
        } else if (key.toLowerCase() === 'folder') {
          folderKey = key;
        } else if (key.toLowerCase() === 'duration') {
          durationKey = key;
        } else if (key.toLowerCase() === 'segments' || key.toLowerCase() === 'segment') {
          segmentsKey = key;
        }
      }

      if (!titleKey) {
        throw new Error('Database Notion của bạn thiếu cột tiêu đề chính (Title property).');
      }

      const pageId = await this.findProjectPageId(project.id, token, dbId, projectIdKey, titleKey);
      const progress = this.getProgress(project);

      // Load folder name if folderId exists
      let folderName = 'Chưa phân loại';
      if (project.folderId) {
        try {
          const folders = await StorageService.loadFolders();
          const match = folders.find(f => f.id === project.folderId);
          if (match) folderName = match.name;
        } catch {}
      }

      // Serialize segments for structured data inside Notion rich_text property
      const serializedSegments = JSON.stringify(
        project.segments.map(s => ({
          idx: s.index,
          txt: s.transcript || '',
          ipa: s.ipa || '',
          trans: s.translation || '',
          status: s.status,
          count: s.studyCount || 0,
        })).slice(0, 100) // Safety boundary: limit to first 100 segments to keep rich_text limits safe
      );

      // Dynamically build properties map based on active columns in the user's Notion database
      const properties: any = {};
      
      // Map Title column
      properties[titleKey] = {
        title: [
          {
            text: {
              content: `${project.title}`
            }
          }
        ]
      };
      
      // Map ProjectID column (if exists as a separate rich_text field)
      if (projectIdKey && projectIdKey !== titleKey && schema[projectIdKey].type === 'rich_text') {
        properties[projectIdKey] = {
          rich_text: [
            {
              text: {
                content: project.id
              }
            }
          ]
        };
      }
      
      // Map Folder column (if exists in Notion schema)
      if (folderKey && schema[folderKey].type === 'select') {
        properties[folderKey] = {
          select: {
            name: folderName
          }
        };
      }
      
      // Map Duration column (if exists in Notion schema)
      if (durationKey && schema[durationKey].type === 'number') {
        properties[durationKey] = {
          number: Math.round(project.durationMs / 1000) // Store in seconds
        };
      }
      
      // Map Progress column (if exists in Notion schema)
      if (progressKey && schema[progressKey].type === 'number') {
        properties[progressKey] = {
          number: progress
        };
      }
      
      // Map Segments/Segment column (if exists in Notion schema)
      if (segmentsKey && schema[segmentsKey].type === 'rich_text') {
        properties[segmentsKey] = {
          rich_text: [
            {
              text: {
                content: serializedSegments
              }
            }
          ]
        };
      }

      if (pageId) {
        // 1. UPDATE EXISTING PAGE
        console.log(`[NotionSync] Found existing page: ${pageId}. Updating properties...`);
        const url = this.getApiUrl(`/v1/pages/${pageId}`);
        const response = await fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ properties })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.warn('[NotionSync] Failed to update page:', err);
          
          // Schema mismatch fallback: Attempt a minimal update (Title/Name and Progress only)
          console.log('[NotionSync] Attempting minimal update fallback...');
          const fallbackProperties: any = {};
          fallbackProperties[titleKey] = properties[titleKey];
          if (progressKey) fallbackProperties[progressKey] = properties[progressKey];

          const fallbackResponse = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ properties: fallbackProperties })
          });
          
          if (!fallbackResponse.ok) {
            const fbErr = await fallbackResponse.json().catch(() => ({}));
            throw new Error(fbErr.message || 'Lỗi cập nhật bảng Notion (Cột dữ liệu không khớp)');
          }
          return true;
        }
        return true;
      } else {
        // 2. CREATE NEW PAGE
        console.log('[NotionSync] Page not found. Creating new database row...');
        const url = this.getApiUrl('/v1/pages');
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: dbId },
            properties
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.warn('[NotionSync] Failed to create page:', err);

          // Schema mismatch fallback: Attempt to create with title only
          console.log('[NotionSync] Attempting minimal database row creation fallback...');
          const fallbackProperties: any = {};
          fallbackProperties[titleKey] = properties[titleKey];

          const fallbackResponse = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              parent: { database_id: dbId },
              properties: fallbackProperties
            })
          });

          if (!fallbackResponse.ok) {
            const fbErr = await fallbackResponse.json().catch(() => ({}));
            throw new Error(fbErr.message || 'Lỗi tạo mới hàng Notion (Cột dữ liệu không khớp)');
          }
          return true;
        }
        return true;
      }
    } catch (err: any) {
      console.warn('[NotionSync] Sync project error:', err);
      throw err;
    }
  }

  // Sync all local projects to the Notion database
  static async syncAllProjects(): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    try {
      const projects = await StorageService.loadProjects();
      if (projects.length === 0) {
        return { successCount: 0, failedCount: 0, errors: ['Không tìm thấy bài học nào cục bộ để đồng bộ.'] };
      }
      for (const p of projects) {
        try {
          const ok = await this.syncProject(p);
          if (ok) {
            successCount++;
          } else {
            failedCount++;
            errors.push(`Bài học "${p.title}" bị từ chối.`);
          }
        } catch (err: any) {
          failedCount++;
          const msg = err?.message || String(err);
          errors.push(`Bài học "${p.title}": ${msg}`);
        }
      }
    } catch (err: any) {
      console.warn('[NotionSync] Sync all projects error:', err);
      errors.push(err?.message || String(err));
    }
    return { successCount, failedCount, errors };
  }
}
