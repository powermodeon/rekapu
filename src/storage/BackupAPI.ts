/**
 * BackupAPI - Client interface for backup and import operations
 * Communicates with background script for all backup/import functionality
 */

import { BackupScope, ConflictStrategy, ImportReport } from '../types/storage';
import { ConflictDetectionResult, DataConflict } from './ConflictResolver';
import { DataSnapshot, ValidationResult } from './ImportTransaction';

export interface ProgressCallback {
  (progress: number, status: string): void;
}

export interface BackupExportResult {
  blob: Uint8Array;
  mimeType: string;
  size: number;
}

export interface FileData {
  data: number[];
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Convert File to FileData for message passing
 */
function fileToFileData(file: File): Promise<FileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      resolve({
        data: Array.from(uint8Array),
        name: file.name,
        mimeType: file.type,
        size: file.size
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Generate unique operation ID
 */
function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send message to background script
 */
function sendBackgroundMessage(action: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && !response.success) {
        reject(new Error(response.error || 'Unknown error'));
      } else {
        resolve(response);
      }
    });
  });
}

export class BackupAPI {
  /**
   * Export backup data
   */
  static async exportBackup(
    scope: BackupScope,
    onProgress?: ProgressCallback
  ): Promise<Blob> {
    const operationId = generateOperationId();
    
    try {
      // Start progress monitoring if callback provided
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch (error) {
            // Ignore progress errors
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_export', {
        scope,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      // Convert array back to blob
      const uint8Array = new Uint8Array(response.data.blob);
      return new Blob([uint8Array], { type: response.data.mimeType });

    } catch (error) {
      throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import backup data (legacy method with automatic conflict resolution)
   */
  static async importBackup(
    file: File,
    scope: BackupScope,
    strategy: ConflictStrategy,
    onProgress?: ProgressCallback
  ): Promise<ImportReport> {
    const operationId = generateOperationId();
    
    try {
      const fileData = await fileToFileData(file);

      // Start progress monitoring if callback provided
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch (error) {
            // Ignore progress errors
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_import', {
        fileData,
        scope,
        strategy,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect conflicts before importing
   */
  static async detectConflicts(
    file: File,
    scope: BackupScope,
    onProgress?: ProgressCallback
  ): Promise<ConflictDetectionResult & { backupData: any }> {
    const operationId = generateOperationId();
    
    try {
      const fileData = await fileToFileData(file);

      // Start progress monitoring if callback provided
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch (error) {
            // Ignore progress errors
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_detectConflicts', {
        fileData,
        scope,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Conflict detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import backup with pre-resolved conflicts
   */
  static async importWithConflictResolution(
    backupData: any,
    scope: BackupScope,
    conflicts: DataConflict[],
    resolutions: Array<{ conflictId: string; action: ConflictStrategy; newId?: string }>,
    onProgress?: ProgressCallback
  ): Promise<ImportReport> {
    const operationId = generateOperationId();
    
    try {
      // Start progress monitoring if callback provided
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch (error) {
            // Ignore progress errors
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_importWithResolution', {
        backupData,
        scope,
        conflicts,
        resolutions,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Import with resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import Anki .txt file (plain text export with tab-separated values)
   * @param file - The Anki .txt file to import
   * @param strategy - Conflict resolution strategy
   * @param additionalTags - Optional tags to add to all imported cards
   * @param onProgress - Optional progress callback
   */
  static async importAnki(
    file: File,
    strategy: ConflictStrategy,
    additionalTags: string[] = [],
    onProgress?: ProgressCallback
  ): Promise<ImportReport> {
    const operationId = generateOperationId();
    
    try {
      const fileData = await fileToFileData(file);

      // Start progress monitoring if callback provided
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch (error) {
            // Ignore progress errors
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_importAnki', {
        fileData,
        strategy,
        additionalTags,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Anki import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fast batch import for new cards (skips conflict resolution and snapshots)
   */
  static async importCardsBatch(
    backupData: any,
    onProgress?: ProgressCallback
  ): Promise<ImportReport> {
    const operationId = generateOperationId();
    
    try {
      let progressInterval: NodeJS.Timeout | undefined;
      if (onProgress) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await sendBackgroundMessage('operation_getProgress', { operationId });
            if (progressResponse.success) {
              const { progress, status } = progressResponse.data;
              onProgress(progress, status);
              if (progress >= 100) {
                clearInterval(progressInterval);
              }
            }
          } catch {
            // Ignore
          }
        }, 500);
      }

      const response = await sendBackgroundMessage('backup_importCardsBatch', {
        backupData,
        operationId
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Batch import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cancel an active operation
   */
  static async cancelOperation(operationId: string): Promise<void> {
    try {
      const response = await sendBackgroundMessage('operation_cancel', { operationId });
      
      if (!response.success) {
        throw new Error(response.error);
      }
    } catch (error) {
      throw new Error(`Cancel operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get progress for an active operation
   */
  static async getOperationProgress(operationId: string): Promise<{
    type: 'export' | 'import' | 'anki_import';
    progress: number;
    status: string;
  }> {
    try {
      const response = await sendBackgroundMessage('operation_getProgress', { operationId });
      
      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;
    } catch (error) {
      throw new Error(`Get progress failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available backup snapshots for recovery
   */
  static async getAvailableSnapshots(): Promise<DataSnapshot[]> {
    try {
      const response = await sendBackgroundMessage('backup_getSnapshots', {});
      
      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;
    } catch (error) {
      throw new Error(`Get snapshots failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Restore from a specific backup snapshot
   */
  static async restoreFromSnapshot(snapshotId: string): Promise<void> {
    try {
      const response = await sendBackgroundMessage('backup_restoreSnapshot', { snapshotId });
      
      if (!response.success) {
        throw new Error(response.error);
      }
    } catch (error) {
      throw new Error(`Snapshot restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a specific backup snapshot
   */
  static async deleteSnapshot(snapshotId: string): Promise<void> {
    try {
      const response = await sendBackgroundMessage('backup_deleteSnapshot', { snapshotId });
      
      if (!response.success) {
        throw new Error(response.error);
      }
    } catch (error) {
      throw new Error(`Snapshot deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate current data integrity
   */
  static async validateDataIntegrity(): Promise<ValidationResult> {
    try {
      const response = await sendBackgroundMessage('backup_validateIntegrity', {});
      
      if (!response.success) {
        throw new Error(response.error);
      }

      return response.data;
    } catch (error) {
      throw new Error(`Data validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
} 