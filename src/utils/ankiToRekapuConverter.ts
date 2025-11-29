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

    // Build note lookup map for quick access
    const noteMap = new Map<string, AnkiNote>();
    for (const note of notes) {
      noteMap.set(note.id, note);
    }

    // If we have Anki cards, iterate over them to use correct templates
    // Each Anki card represents a specific template for a note
    if (options.ankiCards && options.ankiCards.length > 0) {
      for (const ankiCard of options.ankiCards) {
        const note = noteMap.get(ankiCard.noteId);
        if (!note) {
          continue; // Note not found, skip
        }

        const model = models.get(note.modelId);
        if (!model) {
          result.warnings.push(`Model not found for note ${note.id}`);
          continue;
        }

        const isCloze = model.type === 1;
        const templateIndex = ankiCard.ordinal;

        const card = this.convertNoteWithTemplate(
          note, model, isCloze, templateIndex, ankiCard.id,
          options, DOMPurify, result, now
        );
        
        if (card) {
          result.cards.push(card);
          this.collectTags(note.tags, options.additionalTags || [], result.tags, now);
        }
      }
    } else {
      // Fallback: no Anki cards available, use old behavior (one card per note, first template)
      for (const note of notes) {
        const model = models.get(note.modelId);
        if (!model) {
          result.warnings.push(`Model not found for note ${note.id}`);
          continue;
        }

        const isCloze = model.type === 1;
        const card = this.convertNoteWithTemplate(
          note, model, isCloze, 0, null,
          options, DOMPurify, result, now
        );
        
        if (card) {
          result.cards.push(card);
          this.collectTags(note.tags, options.additionalTags || [], result.tags, now);
        }
      }
    }

    return result;
  }

  private static convertNoteWithTemplate(
    note: AnkiNote,
    model: AnkiModel,
    isCloze: boolean,
    templateIndex: number,
    ankiCardId: string | null,
    options: ConversionOptions,
    DOMPurify: DOMPurifyInstance,
    result: ConversionResult,
    now: number
  ): Card | null {
    // Use Anki card ID if available, otherwise generate one
    const id = ankiCardId 
      ? `anki_${ankiCardId}_${Math.random().toString(36).substr(2, 9)}`
      : `anki_${note.id}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Build field map for template rendering
    const fieldMap = this.buildFieldMap(note.fields, model.fields);
    
    // Get the correct template based on index
    const template = model.templates[templateIndex] || model.templates[0];
    if (!template && model.templates.length === 0) {
      // No templates at all, use fallback
      if (note.fields.length < 2) {
        result.warnings.push(`Note ${note.id} has insufficient fields and no templates`);
        return null;
      }
    }
    
    let front = '';
    let back = '';

    if (isCloze) {
      // For cloze, use the specified template or fall back to first field
      if (template) {
        front = this.renderTemplate(template.qfmt, fieldMap, false);
        // For cloze, back template - strip FrontSide to avoid duplication
        back = this.renderTemplate(template.afmt, fieldMap, true);
      } else {
        front = fieldMap.get(model.fields[0]?.name) || note.fields[0] || '';
      }
      
      front = this.sanitizeHtml(front, DOMPurify);
      back = this.sanitizeHtml(back, DOMPurify);
      front = this.convertAnkiClozeToRekapu(front);
      back = this.convertAnkiClozeToRekapu(back);
    } else {
      // For standard cards, render the specified template
      if (template) {
        front = this.renderTemplate(template.qfmt, fieldMap, false);
        // Back template - strip FrontSide to avoid duplication
        back = this.renderTemplate(template.afmt, fieldMap, true);
        
        front = this.sanitizeHtml(front, DOMPurify);
        back = this.sanitizeHtml(back, DOMPurify);
      } else if (note.fields.length >= 2) {
        // Fallback: no templates, use first two fields
        front = this.sanitizeHtml(note.fields[0] || '', DOMPurify);
        back = this.sanitizeHtml(note.fields[1] || '', DOMPurify);
      } else {
        result.warnings.push(`Note ${note.id} has insufficient fields`);
        return null;
      }
    }
    
    // Skip empty cards (template rendered to nothing because required fields are empty)
    if (!front.trim() && !back.trim()) {
      return null;
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

  /**
   * Build a map of field names to field values
   */
  private static buildFieldMap(
    fieldValues: string[],
    fieldDefs: Array<{ name: string; ord: number }>
  ): Map<string, string> {
    const map = new Map<string, string>();
    
    // Sort by ordinal to ensure correct mapping
    const sortedDefs = [...fieldDefs].sort((a, b) => a.ord - b.ord);
    
    sortedDefs.forEach((def, index) => {
      map.set(def.name, fieldValues[index] || '');
    });
    
    return map;
  }

  /**
   * Get field value with case-insensitive lookup
   */
  private static getFieldValue(fieldMap: Map<string, string>, fieldName: string): string {
    // Try exact match first
    if (fieldMap.has(fieldName)) {
      return fieldMap.get(fieldName) || '';
    }
    
    // Try case-insensitive match
    const lowerName = fieldName.toLowerCase();
    for (const [key, value] of fieldMap.entries()) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }
    
    return '';
  }

  /**
   * Process Anki conditional blocks from innermost to outermost
   * Handles both {{#Field}}...{{/Field}} and {{^Field}}...{{/Field}}
   */
  private static processConditionals(text: string, fieldMap: Map<string, string>): string {
    let result = text;
    let changed = true;
    let iterations = 0;
    const maxIterations = 100; // Safety limit
    
    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;
      
      // Match innermost conditionals only (content has no {{ }}  tags)
      // This regex matches conditionals where content doesn't contain other conditionals
      
      // Handle {{#Field}}...{{/Field}} - show if field non-empty
      const positiveRegex = /\{\{#([^}]+?)\}\}((?:(?!\{\{[#^\/])[\s\S])*?)\{\{\/\1\}\}/g;
      const newResult = result.replace(positiveRegex, (match, fieldName, content) => {
        changed = true;
        const value = this.getFieldValue(fieldMap, fieldName.trim());
        return value.trim() ? content : '';
      });
      
      if (newResult !== result) {
        result = newResult;
        continue; // Process more after this change
      }
      
      // Handle {{^Field}}...{{/Field}} - show if field empty
      const negativeRegex = /\{\{\^([^}]+?)\}\}((?:(?!\{\{[#^\/])[\s\S])*?)\{\{\/\1\}\}/g;
      result = result.replace(negativeRegex, (match, fieldName, content) => {
        changed = true;
        const value = this.getFieldValue(fieldMap, fieldName.trim());
        return value.trim() ? '' : content;
      });
    }
    
    // Clean up any unmatched/broken conditional tags that remain
    result = result.replace(/\{\{[#^][^}]*\}\}/g, '');
    result = result.replace(/\{\{\/[^}]*\}\}/g, '');
    
    return result;
  }

  /**
   * Render an Anki template with field values
   * Handles: {{FieldName}}, {{FrontSide}}, {{#Field}}...{{/Field}}, {{^Field}}...{{/Field}}
   * 
   * @param template - The Anki template (qfmt or afmt)
   * @param fieldMap - Map of field names to values
   * @param isBackTemplate - If true, strips {{FrontSide}} and content before <hr id=answer>
   */
  private static renderTemplate(
    template: string,
    fieldMap: Map<string, string>,
    isBackTemplate: boolean = false
  ): string {
    let result = template;
    
    // For back templates, remove {{FrontSide}} - we don't want to duplicate content
    if (isBackTemplate) {
      result = result.replace(/\{\{FrontSide\}\}/gi, '');
      
      // Also remove content before <hr id=answer> or <hr id="answer"> (Anki convention)
      const hrMatch = result.match(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i);
      if (hrMatch) {
        const hrIndex = result.indexOf(hrMatch[0]);
        result = result.substring(hrIndex + hrMatch[0].length);
      }
    }
    
    // Trim leading/trailing whitespace to prevent markdown code block issues
    result = result.trim();
    
    // Handle conditional blocks {{#FieldName}}...{{/FieldName}}
    // and inverse conditionals {{^FieldName}}...{{/FieldName}}
    // Process from innermost to outermost to handle nesting
    result = this.processConditionals(result, fieldMap);
    
    // Handle {{hint:FieldName}} - wrap in hint span (click to reveal in Anki)
    result = result.replace(
      /\{\{hint:([^}]+)\}\}/g,
      (match, fieldName) => {
        const fieldValue = this.getFieldValue(fieldMap, fieldName.trim());
        return fieldValue ? `<span class="hint">${fieldValue}</span>` : '';
      }
    );
    
    // Handle {{text:FieldName}} - strip HTML from field
    result = result.replace(
      /\{\{text:([^}]+)\}\}/g,
      (match, fieldName) => {
        const fieldValue = this.getFieldValue(fieldMap, fieldName.trim());
        // Strip HTML tags
        return fieldValue.replace(/<[^>]*>/g, '');
      }
    );
    
    // Handle {{type:FieldName}} - type-in answer (just show the field value)
    result = result.replace(
      /\{\{type:([^}]+)\}\}/g,
      (match, fieldName) => {
        return this.getFieldValue(fieldMap, fieldName.trim());
      }
    );
    
    // Handle {{cloze:FieldName}} - cloze deletion field
    result = result.replace(
      /\{\{cloze:([^}]+)\}\}/g,
      (match, fieldName) => {
        return this.getFieldValue(fieldMap, fieldName.trim());
      }
    );
    
    // Handle {{furigana:FieldName}} - just use the field value (furigana handling is complex)
    result = result.replace(
      /\{\{furigana:([^}]+)\}\}/g,
      (match, fieldName) => {
        return this.getFieldValue(fieldMap, fieldName.trim());
      }
    );
    
    // Handle simple field replacement {{FieldName}}
    // Must be done last to avoid replacing already-processed special syntax
    result = result.replace(
      /\{\{([^#^/}:]+)\}\}/g,
      (match, fieldName) => {
        const trimmedName = fieldName.trim();
        // Skip if it looks like a special field we missed
        if (trimmedName.startsWith('#') || trimmedName.startsWith('^') || trimmedName.startsWith('/')) {
          return match;
        }
        return this.getFieldValue(fieldMap, trimmedName);
      }
    );
    
    // Final trim to remove any leading/trailing whitespace
    // This prevents markdown from treating indented content as code blocks
    return result.trim();
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

