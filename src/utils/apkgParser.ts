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
      
      // Try different database formats (newest to oldest)
      const dbFile = zip.file('collection.anki21b') || 
                     zip.file('collection.anki21') || 
                     zip.file('collection.anki2');
      
      if (!dbFile) {
        result.errors.push('Invalid .apkg file: no collection database found. This may be a very old Anki format.');
        return result;
      }

      const isNewFormat = dbFile.name === 'collection.anki21b';
      const dbBuffer = await dbFile.async('uint8array');
      const SQL = await this.getSqlJs();
      const db = new SQL.Database(dbBuffer);

      try {
        if (isNewFormat) {
          // Anki 2.1.28+ format with separate notetypes/decks tables
          this.parseCollectionNew(db, result);
        } else {
          // Legacy format with models/decks in col table
          this.parseCollection(db, result);
        }
        this.parseNotes(db, result);
        this.parseCards(db, result);
        await this.parseMedia(zip, result);
        result.success = result.errors.length === 0;
      } finally {
        db.close();
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errorMsg.includes('no such table') || errorMsg.includes('no such column')) {
        result.errors.push(`Unsupported Anki format. Please export from Anki 2.1+ using "Export" > "Anki Deck Package (.apkg)"`);
      } else {
        result.errors.push(`Parse error: ${errorMsg}`);
      }
    }

    return result;
  }

  /**
   * Parse collection metadata from legacy format (Anki < 2.1.28)
   * Models and decks are stored as JSON in the col table
   */
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

  /**
   * Parse collection metadata from new format (Anki 2.1.28+)
   * Models are in 'notetypes' table, decks in 'decks' table
   */
  private static parseCollectionNew(db: SqlJsDatabase, result: ApkgParseResult): void {
    try {
      // Get collection creation time
      const colResult = db.exec('SELECT crt FROM col LIMIT 1');
      if (colResult.length > 0 && colResult[0].values.length > 0) {
        result.collectionCreated = (colResult[0].values[0][0] as number) * 1000;
      }

      // Parse notetypes (models) - new format stores them in separate table
      const notetypesResult = db.exec('SELECT id, name, config FROM notetypes');
      if (notetypesResult.length > 0) {
        for (const row of notetypesResult[0].values) {
          const [id, name, configBlob] = row;
          const modelId = String(id);
          
          // Config is stored as a protobuf blob in new format, but we can try JSON first
          let fields: Array<{ name: string; ord: number }> = [];
          let templates: Array<{ name: string; qfmt: string; afmt: string; ord: number }> = [];
          let modelType = 0;

          // Try to get fields from fields table
          const fieldsResult = db.exec(`SELECT name, ord FROM fields WHERE ntid = ${id} ORDER BY ord`);
          if (fieldsResult.length > 0) {
            fields = fieldsResult[0].values.map(([fname, ford]) => ({
              name: String(fname),
              ord: Number(ford)
            }));
          }

          // Try to get templates from templates table
          const templatesResult = db.exec(`SELECT name, qfmt, afmt, ord FROM templates WHERE ntid = ${id} ORDER BY ord`);
          if (templatesResult.length > 0) {
            templates = templatesResult[0].values.map(([tname, qfmt, afmt, tord]) => ({
              name: String(tname),
              qfmt: String(qfmt),
              afmt: String(afmt),
              ord: Number(tord)
            }));
          }

          // Check if it's a cloze type (type is in config, but we can infer from template)
          if (templates.some(t => t.qfmt.includes('{{cloze:') || t.afmt.includes('{{cloze:'))) {
            modelType = 1;
          }

          result.models.set(modelId, {
            id: modelId,
            name: String(name),
            type: modelType,
            fields,
            templates
          });
        }
      }

      // Parse decks - new format stores them in separate table
      const decksResult = db.exec('SELECT id, name FROM decks');
      if (decksResult.length > 0) {
        for (const row of decksResult[0].values) {
          const [id, name] = row;
          result.decks.set(String(id), {
            id: String(id),
            name: String(name)
          });
        }
      }
    } catch (error) {
      // If new format tables don't exist, fall back to legacy
      result.warnings.push('Trying legacy format parser...');
      this.parseCollection(db, result);
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

