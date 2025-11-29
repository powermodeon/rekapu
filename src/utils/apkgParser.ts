/**
 * ApkgParser - Parse Anki .apkg files (ZIP containing SQLite database + media)
 * Uses lazy loading for sql.js to keep main bundle size small
 * Supports zstd-compressed databases (Anki 2.1.50+)
 */

import JSZip from 'jszip';
import { decompress as zstdDecompress } from 'fzstd';

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

  /**
   * Check if a table exists in the database
   */
  private static hasTable(db: SqlJsDatabase, tableName: string): boolean {
    try {
      const result = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
      return result.length > 0 && result[0].values.length > 0;
    } catch {
      return false;
    }
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

      let dbBuffer = await dbFile.async('uint8array');
      
      // Check if database is zstd-compressed (Anki 2.1.50+)
      // Zstd magic bytes: 0x28 0xB5 0x2F 0xFD
      if (dbBuffer[0] === 0x28 && dbBuffer[1] === 0xB5 && dbBuffer[2] === 0x2F && dbBuffer[3] === 0xFD) {
        try {
          dbBuffer = zstdDecompress(dbBuffer);
        } catch (decompressError) {
          result.errors.push(`Failed to decompress database: ${decompressError instanceof Error ? decompressError.message : 'Unknown error'}`);
          return result;
        }
      }
      
      const SQL = await this.getSqlJs();
      const db = new SQL.Database(dbBuffer);

      try {
        // Try to detect format and parse collection metadata
        // First check if notetypes table exists (new format)
        // If not, check if col.models has data (legacy format)
        // Some hybrid formats have both but models is empty
        
        const hasNotetypesTable = this.hasTable(db, 'notetypes');
        
        // Try legacy format first (col.models JSON)
        const legacyWorked = this.parseCollectionLegacy(db, result);
        
        if (!legacyWorked) {
          // Legacy didn't work (models is empty), try new format tables
          if (hasNotetypesTable) {
            this.parseCollectionNew(db, result);
          } else {
            result.errors.push('No models found in database - unsupported Anki format');
          }
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
   * Returns true if successfully parsed models, false if models column is empty
   */
  private static parseCollectionLegacy(db: SqlJsDatabase, result: ApkgParseResult): boolean {
    try {
      const colResult = db.exec('SELECT * FROM col LIMIT 1');
      if (colResult.length === 0 || colResult[0].values.length === 0) {
        return false;
      }

      const colNames = colResult[0].columns;
      const row = colResult[0].values[0];
      
      const modelsIdx = colNames.indexOf('models');
      const decksIdx = colNames.indexOf('decks');
      const crtIdx = colNames.indexOf('crt');

      if (crtIdx >= 0) {
        result.collectionCreated = (row[crtIdx] as number) * 1000;
      }

      // Check if models column has actual data
      if (modelsIdx < 0) {
        return false;
      }
      
      const modelsJson = row[modelsIdx];
      if (!modelsJson || typeof modelsJson !== 'string' || !modelsJson.trim()) {
        return false;
      }
      const modelsData = JSON.parse(modelsJson);
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

      // Parse decks
      if (decksIdx >= 0) {
        const decksJson = row[decksIdx];
        if (decksJson && typeof decksJson === 'string' && decksJson.trim()) {
          const decksData = JSON.parse(decksJson);
          for (const [id, deck] of Object.entries(decksData)) {
            const d = deck as any;
            result.decks.set(id, {
              id,
              name: d.name
            });
          }
        }
      }
      
      return true;
    } catch (error) {
      return false;
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

      // Detect template table schema (varies by Anki version)
      const templatesSchema = db.exec("PRAGMA table_info(templates)");
      const templateCols = templatesSchema.length > 0 
        ? templatesSchema[0].values.map(row => row[1]) 
        : [];

      // Parse notetypes (models) - new format stores them in separate table
      const notetypesResult = db.exec('SELECT id, name, config FROM notetypes');
      if (notetypesResult.length > 0) {
        for (const row of notetypesResult[0].values) {
          const [id, name, configBlob] = row;
          const modelId = String(id);
          
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

          // Get templates - column names vary by Anki version
          // Newer: id, ntid, ord, name, mtime_secs, usn, config
          // Older: id, ntid, ord, name, qfmt, afmt, bqfmt, bafmt, did
          if (templateCols.includes('qfmt')) {
            // Old-style templates table with qfmt/afmt columns
            const templatesResult = db.exec(`SELECT name, qfmt, afmt, ord FROM templates WHERE ntid = ${id} ORDER BY ord`);
            if (templatesResult.length > 0) {
              templates = templatesResult[0].values.map(([tname, qfmt, afmt, tord]) => ({
                name: String(tname),
                qfmt: String(qfmt),
                afmt: String(afmt),
                ord: Number(tord)
              }));
            }
          } else if (templateCols.includes('config')) {
            // New-style templates table with config blob (protobuf)
            const templatesResult = db.exec(`SELECT name, ord, config FROM templates WHERE ntid = ${id} ORDER BY ord`);
            if (templatesResult.length > 0) {
              for (const [tname, tord, configData] of templatesResult[0].values) {
                const template = this.parseTemplateConfig(configData, String(tname), Number(tord));
                if (template) {
                  templates.push(template);
                }
              }
            }
          }

          // Check if it's a cloze type
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
      result.errors.push(`Failed to parse collection: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * Parse template config blob (protobuf format in newer Anki)
   * The config contains qfmt and afmt as fields 1 and 2
   */
  private static parseTemplateConfig(
    configData: any, 
    name: string, 
    ord: number
  ): { name: string; qfmt: string; afmt: string; ord: number } | null {
    try {
      if (!configData) {
        return { name, qfmt: '', afmt: '', ord };
      }

      // configData is a Uint8Array containing protobuf
      // Protobuf structure for CardTemplate:
      // field 1 (tag 0x0a): qfmt (string)
      // field 2 (tag 0x12): afmt (string)
      // We'll do simple protobuf parsing for strings
      
      const bytes = configData instanceof Uint8Array 
        ? configData 
        : new Uint8Array(configData);
      
      let qfmt = '';
      let afmt = '';
      let pos = 0;

      while (pos < bytes.length) {
        const tag = bytes[pos];
        pos++;
        
        if (pos >= bytes.length) break;

        // Read varint length
        let length = 0;
        let shift = 0;
        while (pos < bytes.length) {
          const b = bytes[pos];
          pos++;
          length |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }

        if (pos + length > bytes.length) break;

        const fieldData = bytes.slice(pos, pos + length);
        const fieldStr = new TextDecoder().decode(fieldData);
        pos += length;

        // Tag 0x0a = field 1 (qfmt), Tag 0x12 = field 2 (afmt)
        if (tag === 0x0a) {
          qfmt = fieldStr;
        } else if (tag === 0x12) {
          afmt = fieldStr;
        }
      }

      return { name, qfmt, afmt, ord };
    } catch {
      return { name, qfmt: '', afmt: '', ord };
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

      let mediaBytes = await mediaFile.async('uint8array');
      
      // Check if media file is zstd compressed (Anki 2.1.50+)
      if (mediaBytes[0] === 0x28 && mediaBytes[1] === 0xB5 && mediaBytes[2] === 0x2F && mediaBytes[3] === 0xFD) {
        try {
          mediaBytes = zstdDecompress(mediaBytes);
        } catch (e) {
          result.warnings.push('Failed to decompress media mapping');
          return;
        }
      }
      
      const mediaJson = new TextDecoder().decode(mediaBytes);
      
      // Handle empty media file
      if (!mediaJson.trim() || mediaJson.trim() === '{}') {
        return;
      }
      
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

