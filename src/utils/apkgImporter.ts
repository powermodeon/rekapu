/**
 * ApkgImporter - Main orchestrator for .apkg file import
 * Coordinates parsing, media storage, and conversion
 */

import { ApkgParser, ApkgParseResult, MediaFile } from './apkgParser';
import { AnkiToRekapuConverter, ConversionResult } from './ankiToRekapuConverter';
import { MediaStorageManager } from '../storage/MediaStorageManager';
import { BackupData } from '../types/storage';
import { Card } from '../types/index';

export interface ApkgImportOptions {
  additionalTags?: string[];
  onProgress?: (progress: number, status: string) => void;
}

export interface ApkgImportResult {
  success: boolean;
  backupData?: BackupData;
  previewCards: Array<{ front: string; back: string; tags: string[] }>;
  errors: string[];
  warnings: string[];
  stats: {
    totalCards: number;
    totalNotes: number;
    mediaFiles: number;
    processingTimeMs: number;
  };
}

export class ApkgImporter {
  private static readonly BACKUP_VERSION = '2.0.0';

  static async parse(file: File, options: ApkgImportOptions = {}): Promise<ApkgImportResult> {
    const startTime = Date.now();
    const { onProgress } = options;

    const result: ApkgImportResult = {
      success: false,
      previewCards: [],
      errors: [],
      warnings: [],
      stats: {
        totalCards: 0,
        totalNotes: 0,
        mediaFiles: 0,
        processingTimeMs: 0
      }
    };

    try {
      onProgress?.(5, 'Loading import tools...');

      onProgress?.(10, 'Extracting archive...');
      const parseResult = await ApkgParser.parse(file);
      
      if (!parseResult.success) {
        result.errors.push(...parseResult.errors);
        result.warnings.push(...parseResult.warnings);
        return result;
      }

      result.warnings.push(...parseResult.warnings);
      result.stats.totalNotes = parseResult.notes.length;

      onProgress?.(30, 'Storing media files...');
      const mediaIdMap = await this.storeMedia(parseResult.media, onProgress);
      result.stats.mediaFiles = parseResult.media.length;

      onProgress?.(60, 'Converting cards...');
      const conversionResult = await AnkiToRekapuConverter.convert(
        parseResult.notes,
        parseResult.models,
        {
          mediaIdMap,
          additionalTags: options.additionalTags,
          collectionCreated: parseResult.collectionCreated,
          ankiCards: parseResult.cards
        }
      );

      result.warnings.push(...conversionResult.warnings);
      result.stats.totalCards = conversionResult.cards.length;

      onProgress?.(80, 'Preparing import data...');
      result.backupData = this.createBackupData(conversionResult);
      result.previewCards = this.generatePreview(conversionResult.cards);
      
      result.success = result.errors.length === 0;
      result.stats.processingTimeMs = Date.now() - startTime;

      onProgress?.(100, 'Complete');

    } catch (error) {
      result.errors.push(`Import error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  private static async storeMedia(
    media: MediaFile[],
    onProgress?: (progress: number, status: string) => void
  ): Promise<Map<string, string>> {
    if (media.length === 0) {
      return new Map();
    }

    const files = media.map(m => ({
      originalName: m.originalName,
      data: m.data,
      mimeType: m.mimeType
    }));

    const batchSize = 10;
    const mediaIdMap = new Map<string, string>();
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchResult = await MediaStorageManager.storeMedia(batch);
      
      for (const [name, id] of batchResult) {
        mediaIdMap.set(name, id);
      }

      const progress = 30 + Math.floor((i / files.length) * 30);
      onProgress?.(progress, `Storing media... (${Math.min(i + batchSize, files.length)}/${files.length})`);
    }

    return mediaIdMap;
  }

  private static createBackupData(conversionResult: ConversionResult): BackupData {
    const now = Date.now();
    
    const cards: Record<string, Card> = {};
    for (const card of conversionResult.cards) {
      cards[card.id] = card;
    }

    const tags: Record<string, any> = {};
    for (const [name, tag] of conversionResult.tags) {
      tags[name] = tag;
    }

    return {
      version: this.BACKUP_VERSION,
      timestamp: now,
      scope: 'cards',
      data: {
        cards,
        tags
      }
    };
  }

  private static generatePreview(cards: Card[]): Array<{ front: string; back: string; tags: string[] }> {
    const previewCount = Math.min(3, cards.length);
    const preview: Array<{ front: string; back: string; tags: string[] }> = [];

    for (let i = 0; i < previewCount; i++) {
      const card = cards[i];
      preview.push({
        front: this.stripHtml(card.front).substring(0, 200),
        back: this.stripHtml(card.back).substring(0, 200),
        tags: card.tags
      });
    }

    return preview;
  }

  private static stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  static async validateFile(file: File): Promise<{ valid: boolean; error?: string }> {
    if (!file.name.toLowerCase().endsWith('.apkg')) {
      return { valid: false, error: 'File must be an .apkg file' };
    }

    if (file.size > 500 * 1024 * 1024) {
      return { valid: false, error: 'File too large (max 500MB)' };
    }

    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      
      if (!zip.file('collection.anki2') && !zip.file('collection.anki21')) {
        return { valid: false, error: 'Invalid .apkg file: no collection database found' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Invalid ZIP file or corrupted .apkg' };
    }
  }
}

