/**
 * MediaStorageManager - Store and retrieve media files from IndexedDB
 * Uses a dedicated object store for media to enable deduplication and efficient storage
 */

import { INDEXEDDB_SCHEMA } from './IndexedDBSchema';

export interface StoredMedia {
  id: string;
  originalName: string;
  data: Blob;
  mimeType: string;
  size: number;
  hash: string;
  createdAt: number;
  refCount: number;
}

export interface MediaStats {
  totalFiles: number;
  totalSize: number;
  byType: Record<string, { count: number; size: number }>;
}

export class MediaStorageManager {
  private static readonly STORE_NAME = 'media';
  private static readonly DB_NAME = INDEXEDDB_SCHEMA.name;
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        // Use schema version to ensure we open the correct DB version.
        // Store creation is handled by IndexedDBManager during upgrades.
        const request = indexedDB.open(this.DB_NAME, INDEXEDDB_SCHEMA.version);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  private static async hashData(data: Uint8Array): Promise<string> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  static async storeMedia(
    files: Array<{ originalName: string; data: Uint8Array; mimeType: string }>
  ): Promise<Map<string, string>> {
    const db = await this.getDb();
    const mediaIdMap = new Map<string, string>();

    for (const file of files) {
      const dataArray = new Uint8Array(file.data);
      const hash = await this.hashData(dataArray);
      const existing = await this.findByHash(hash);
      
      if (existing) {
        await this.incrementRefCount(existing.id);
        mediaIdMap.set(file.originalName, existing.id);
      } else {
        const id = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const blob = new Blob([dataArray], { type: file.mimeType });
        
        const storedMedia: StoredMedia = {
          id,
          originalName: file.originalName,
          data: blob,
          mimeType: file.mimeType,
          size: file.data.length,
          hash,
          createdAt: Date.now(),
          refCount: 1
        };

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          tx.objectStore(this.STORE_NAME).add(storedMedia);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        mediaIdMap.set(file.originalName, id);
      }
    }

    return mediaIdMap;
  }

  private static async findByHash(hash: string): Promise<StoredMedia | null> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('hash');
      const request = index.get(hash);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  private static async incrementRefCount(id: string): Promise<void> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const media = getRequest.result;
        if (media) {
          media.refCount = (media.refCount || 0) + 1;
          store.put(media);
        }
      };
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Retrieve media by ID. Returns the full StoredMedia record including the blob.
   * Callers should use the returned `data` blob directly or create their own
   * blob URL with URL.createObjectURL() and remember to revoke it when done.
   */
  static async getMediaById(id: string): Promise<StoredMedia | null> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).get(id);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteMedia(id: string): Promise<void> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const media = getRequest.result as StoredMedia | undefined;
        if (media) {
          media.refCount = Math.max(0, (media.refCount || 1) - 1);
          if (media.refCount === 0) {
            store.delete(id);
          } else {
            store.put(media);
          }
        }
      };
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  static async getStats(): Promise<MediaStats> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).getAll();
      
      request.onsuccess = () => {
        const media = request.result as StoredMedia[];
        const stats: MediaStats = {
          totalFiles: media.length,
          totalSize: 0,
          byType: {}
        };

        for (const m of media) {
          stats.totalSize += m.size;
          const type = m.mimeType.split('/')[0] || 'other';
          if (!stats.byType[type]) {
            stats.byType[type] = { count: 0, size: 0 };
          }
          stats.byType[type].count++;
          stats.byType[type].size += m.size;
        }

        resolve(stats);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async cleanupOrphanedMedia(usedMediaIds: Set<string>): Promise<number> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();
      let deletedCount = 0;
      
      request.onsuccess = () => {
        const media = request.result as StoredMedia[];
        for (const m of media) {
          const refCount = m.refCount ?? 0;
          // Only delete if not in use AND has no remaining references
          if (!usedMediaIds.has(m.id) && refCount <= 0) {
            store.delete(m.id);
            deletedCount++;
          }
        }
      };
      
      tx.oncomplete = () => resolve(deletedCount);
      tx.onerror = () => reject(tx.error);
    });
  }
}

