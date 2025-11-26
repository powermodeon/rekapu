/**
 * AnkiToRekapuConverter - Convert parsed Anki data to Rekapu card format
 * Uses lazy loading for DOMPurify to keep main bundle size small
 */

import { Card } from '../types/index';
import { DEFAULT_SPACED_REPETITION } from '../types/storage';
import { AnkiNote, AnkiModel, MediaFile, AnkiCard } from './apkgParser';

export interface ConversionResult {
  cards: Card[];
  tags: Map<string, { id: string; name: string; color: string; created: number }>;
  warnings: string[];
  mediaUsage: Map<string, string[]>; // mediaId -> cardIds that use it
}

export interface ConversionOptions {
  mediaIdMap: Map<string, string>; // originalName -> mediaId
  additionalTags?: string[];
  preserveScheduling?: boolean;
  collectionCreated?: number;
  ankiCards?: AnkiCard[];
}

type DOMPurifyInstance = {
  sanitize: (html: string, config?: any) => string;
};

export class AnkiToRekapuConverter {
  private static domPurifyPromise: Promise<DOMPurifyInstance> | null = null;

  private static async getDOMPurify(): Promise<DOMPurifyInstance> {
    if (!this.domPurifyPromise) {
      this.domPurifyPromise = (async () => {
        const DOMPurify = (await import(/* webpackChunkName: "dompurify" */ 'dompurify')).default;
        return DOMPurify;
      })();
    }
    return this.domPurifyPromise;
  }

  static async convert(
    notes: AnkiNote[],
    models: Map<string, AnkiModel>,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const DOMPurify = await this.getDOMPurify();
    
    const result: ConversionResult = {
      cards: [],
      tags: new Map(),
      warnings: [],
      mediaUsage: new Map()
    };

    const now = Date.now();

    for (const note of notes) {
      const model = models.get(note.modelId);
      if (!model) {
        result.warnings.push(`Model not found for note ${note.id}`);
        continue;
      }

      const isCloze = model.type === 1;
      const card = this.convertNote(note, model, isCloze, options, DOMPurify, result, now);
      
      if (card) {
        result.cards.push(card);
        this.collectTags(note.tags, options.additionalTags || [], result.tags, now);
      }
    }

    return result;
  }

  private static convertNote(
    note: AnkiNote,
    model: AnkiModel,
    isCloze: boolean,
    options: ConversionOptions,
    DOMPurify: DOMPurifyInstance,
    result: ConversionResult,
    now: number
  ): Card | null {
    const id = `anki_${note.id}_${Math.random().toString(36).substr(2, 9)}`;
    
    let front = '';
    let back = '';

    if (isCloze) {
      const clozeField = note.fields[0] || '';
      front = this.sanitizeHtml(clozeField, DOMPurify);
      back = '';
      
      front = this.convertAnkiClozeToRekapu(front);
    } else {
      if (model.templates.length > 0 && note.fields.length >= 2) {
        front = this.sanitizeHtml(note.fields[0] || '', DOMPurify);
        back = this.sanitizeHtml(note.fields[1] || '', DOMPurify);
      } else if (note.fields.length >= 2) {
        front = this.sanitizeHtml(note.fields[0] || '', DOMPurify);
        back = this.sanitizeHtml(note.fields[1] || '', DOMPurify);
      } else {
        result.warnings.push(`Note ${note.id} has insufficient fields`);
        return null;
      }
    }

    front = this.processMediaReferences(front, options.mediaIdMap, id, result.mediaUsage);
    back = this.processMediaReferences(back, options.mediaIdMap, id, result.mediaUsage);

    front = this.convertSoundTags(front, options.mediaIdMap, id, result.mediaUsage);
    back = this.convertSoundTags(back, options.mediaIdMap, id, result.mediaUsage);

    const allTags = [...note.tags, ...(options.additionalTags || [])];
    const uniqueTags = [...new Set(allTags)];

    const card: Card = {
      id,
      type: isCloze ? 'cloze' : 'basic',
      front,
      back,
      tags: uniqueTags,
      created: note.modified || now,
      modified: now,
      isDraft: false,
      algorithm: { ...DEFAULT_SPACED_REPETITION, dueDate: now }
    };

    if (isCloze) {
      card.clozeSource = front;
      card.clozeDeletions = this.parseClozeForCard(front);
    }

    return card;
  }

  private static sanitizeHtml(html: string, DOMPurify: DOMPurifyInstance): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'div', 'span', 'br', 'hr',
        'b', 'i', 'u', 'strong', 'em', 'mark', 'del', 's', 'sub', 'sup',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'dl', 'dt', 'dd',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'blockquote', 'pre', 'code',
        'a', 'img', 'audio', 'video', 'source',
        'ruby', 'rt', 'rp'
      ],
      ALLOWED_ATTR: [
        'src', 'href', 'alt', 'title', 'class', 'style', 'id',
        'width', 'height', 'controls', 'autoplay', 'loop', 'muted',
        'target', 'rel', 'type', 'colspan', 'rowspan'
      ],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
      FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover']
    });
  }

  private static convertAnkiClozeToRekapu(text: string): string {
    return text.replace(/\{\{c(\d+)::([^}]+?)(?:::([^}]*))?\}\}/g, 
      (match, id, content, hint) => {
        if (hint) {
          return `{{c${id}::${content}::${hint}}}`;
        }
        return `{{c${id}::${content}}}`;
      }
    );
  }

  private static parseClozeForCard(text: string): Card['clozeDeletions'] {
    const deletions: NonNullable<Card['clozeDeletions']> = [];
    const regex = /\{\{c(\d+)::([^}]+?)(?:::([^}]*))?\}\}/g;
    let match;
    const seen = new Set<number>();

    while ((match = regex.exec(text)) !== null) {
      const id = parseInt(match[1], 10);
      if (seen.has(id)) continue;
      seen.add(id);

      deletions.push({
        id,
        text: match[2],
        hint: match[3] || undefined,
        algorithm: { ...DEFAULT_SPACED_REPETITION, dueDate: Date.now() }
      });
    }

    return deletions.sort((a, b) => a.id - b.id);
  }

  private static processMediaReferences(
    html: string,
    mediaIdMap: Map<string, string>,
    cardId: string,
    mediaUsage: Map<string, string[]>
  ): string {
    return html.replace(
      /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
      (match, before, src, after) => {
        const mediaId = mediaIdMap.get(src);
        if (mediaId) {
          this.trackMediaUsage(mediaUsage, mediaId, cardId);
          // Don't include src - it will be resolved from IndexedDB at render time
          return `<img ${before}data-media-id="${mediaId}" alt="${src}"${after}>`;
        }
        return match;
      }
    );
  }

  private static convertSoundTags(
    text: string,
    mediaIdMap: Map<string, string>,
    cardId: string,
    mediaUsage: Map<string, string[]>
  ): string {
    return text.replace(
      /\[sound:([^\]]+)\]/gi,
      (match, filename) => {
        const mediaId = mediaIdMap.get(filename);
        if (mediaId) {
          this.trackMediaUsage(mediaUsage, mediaId, cardId);
          // Don't include src - it will be resolved from IndexedDB at render time
          return `<audio controls data-media-id="${mediaId}" data-filename="${filename}"></audio>`;
        }
        return `<!-- audio not found: ${filename} -->`;
      }
    );
  }

  private static trackMediaUsage(
    mediaUsage: Map<string, string[]>,
    mediaId: string,
    cardId: string
  ): void {
    if (!mediaUsage.has(mediaId)) {
      mediaUsage.set(mediaId, []);
    }
    mediaUsage.get(mediaId)!.push(cardId);
  }

  private static collectTags(
    noteTags: string[],
    additionalTags: string[],
    tagMap: Map<string, { id: string; name: string; color: string; created: number }>,
    now: number
  ): void {
    const allTags = [...noteTags, ...additionalTags];
    
    for (const tagName of allTags) {
      if (!tagName || tagMap.has(tagName)) continue;
      
      tagMap.set(tagName, {
        id: `tag_${now}_${Math.random().toString(36).substr(2, 9)}`,
        name: tagName,
        color: this.generateTagColor(tagName),
        created: now
      });
    }
  }

  private static generateTagColor(tagName: string): string {
    let hash = 0;
    for (let i = 0; i < tagName.length; i++) {
      hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
  }
}

