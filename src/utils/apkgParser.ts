/**
 * ApkgParser - Parse Anki .apkg files (ZIP containing SQLite database + media)
 * Uses lazy loading for sql.js to keep main bundle size small
 */

import JSZip from 'jszip';

export interface AnkiNote {
  id: string;
  guid: string;
  modelId: string;
  fields: string[];
  tags: string[];
  flags: number;
  modified: number;
}

export interface AnkiCard {
  id: string;
  noteId: string;
  deckId: string;
  ordinal: number;
  type: number;
  queue: number;
  due: number;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

export interface AnkiModel {
  id: string;
  name: string;
  type: number; // 0 = standard, 1 = cloze
  fields: Array<{ name: string; ord: number }>;
  templates: Array<{
    name: string;
    qfmt: string;
    afmt: string;
    ord: number;
  }>;
}

export interface AnkiDeck {
  id: string;
  name: string;
}

export interface MediaMapping {
  [numberedName: string]: string; // e.g., "0" -> "image.jpg"
}

export interface MediaFile {
  originalName: string;
  data: Uint8Array;
  mimeType: string;
}

export interface ApkgParseResult {
  success: boolean;
  notes: AnkiNote[];
  cards: AnkiCard[];
  models: Map<string, AnkiModel>;
  decks: Map<string, AnkiDeck>;
  media: MediaFile[];
  collectionCreated: number;
  errors: string[];
  warnings: string[];
}

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: any[][] }>;
  close: () => void;
};

type SqlJsStatic = {
  Database: new (data: ArrayLike<number>) => SqlJsDatabase;
};

export class ApkgParser {
  private static sqlPromise: Promise<SqlJsStatic> | null = null;

  private static async getSqlJs(): Promise<SqlJsStatic> {
    if (!this.sqlPromise) {
      this.sqlPromise = (async () => {
        const initSqlJs = (await import(/* webpackChunkName: "sql" */ 'sql.js')).default;
        return await initSqlJs({
          locateFile: (filename: string) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
              return chrome.runtime.getURL(filename);
            }
            return filename;
          }
        });
      })();
    }
    return this.sqlPromise;
  }

  static async parse(file: File): Promise<ApkgParseResult> {
    const result: ApkgParseResult = {
      success: false,
      notes: [],
      cards: [],
      models: new Map(),
      decks: new Map(),
      media: [],
      collectionCreated: 0,
      errors: [],
      warnings: []
    };

    try {
      const zip = await JSZip.loadAsync(file);
      const dbFile = zip.file('collection.anki2') || zip.file('collection.anki21');
      
      if (!dbFile) {
        result.errors.push('Invalid .apkg file: no collection database found');
        return result;
      }

      const dbBuffer = await dbFile.async('uint8array');
      const SQL = await this.getSqlJs();
      const db = new SQL.Database(dbBuffer);

      try {
        this.parseCollection(db, result);
        this.parseNotes(db, result);
        this.parseCards(db, result);
        await this.parseMedia(zip, result);
        result.success = result.errors.length === 0;
      } finally {
        db.close();
      }

    } catch (error) {
      result.errors.push(`Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  private static parseCollection(db: SqlJsDatabase, result: ApkgParseResult): void {
    try {
      const colResult = db.exec('SELECT models, decks, crt FROM col LIMIT 1');
      if (colResult.length === 0 || colResult[0].values.length === 0) {
        result.errors.push('No collection metadata found');
        return;
      }

      const [modelsJson, decksJson, crt] = colResult[0].values[0];
      result.collectionCreated = (crt as number) * 1000;

      const modelsData = JSON.parse(modelsJson as string);
      for (const [id, model] of Object.entries(modelsData)) {
        const m = model as any;
        result.models.set(id, {
          id,
          name: m.name,
          type: m.type || 0,
          fields: (m.flds || []).map((f: any) => ({ name: f.name, ord: f.ord })),
          templates: (m.tmpls || []).map((t: any) => ({
            name: t.name,
            qfmt: t.qfmt,
            afmt: t.afmt,
            ord: t.ord
          }))
        });
      }

      const decksData = JSON.parse(decksJson as string);
      for (const [id, deck] of Object.entries(decksData)) {
        const d = deck as any;
        result.decks.set(id, {
          id,
          name: d.name
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse collection metadata: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private static parseNotes(db: SqlJsDatabase, result: ApkgParseResult): void {
    try {
      const notesResult = db.exec('SELECT id, guid, mid, flds, tags, flags, mod FROM notes');
      if (notesResult.length === 0) {
        result.warnings.push('No notes found in database');
        return;
      }

      for (const row of notesResult[0].values) {
        const [id, guid, mid, flds, tags, flags, mod] = row;
        result.notes.push({
          id: String(id),
          guid: String(guid),
          modelId: String(mid),
          fields: (flds as string).split('\x1f'),
          tags: (tags as string).trim().split(/\s+/).filter(t => t),
          flags: flags as number,
          modified: (mod as number) * 1000
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse notes: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private static parseCards(db: SqlJsDatabase, result: ApkgParseResult): void {
    try {
      const cardsResult = db.exec('SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards');
      if (cardsResult.length === 0) {
        return;
      }

      for (const row of cardsResult[0].values) {
        const [id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses] = row;
        result.cards.push({
          id: String(id),
          noteId: String(nid),
          deckId: String(did),
          ordinal: ord as number,
          type: type as number,
          queue: queue as number,
          due: due as number,
          interval: ivl as number,
          ease: (factor as number) / 1000,
          reps: reps as number,
          lapses: lapses as number
        });
      }
    } catch (error) {
      result.warnings.push(`Failed to parse cards table: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private static async parseMedia(zip: JSZip, result: ApkgParseResult): Promise<void> {
    try {
      const mediaFile = zip.file('media');
      if (!mediaFile) {
        return;
      }

      const mediaJson = await mediaFile.async('string');
      const mediaMapping: MediaMapping = JSON.parse(mediaJson);

      for (const [numberedName, originalName] of Object.entries(mediaMapping)) {
        const file = zip.file(numberedName);
        if (!file) {
          result.warnings.push(`Media file not found: ${numberedName} (${originalName})`);
          continue;
        }

        const data = await file.async('uint8array');
        const mimeType = this.getMimeType(originalName);

        result.media.push({
          originalName,
          data,
          mimeType
        });
      }
    } catch (error) {
      result.warnings.push(`Failed to parse media: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private static getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'mp3': 'audio/mpeg',
      'ogg': 'audio/ogg',
      'wav': 'audio/wav',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

