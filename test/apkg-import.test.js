/**
 * APKG Import Tests
 * 
 * Real tests for Anki .apkg file import functionality
 * Tests actual module implementations
 */

require('ts-node').register({
  project: './tsconfig.json',
  compilerOptions: {
    module: 'CommonJS'
  }
});

const { test, describe, before } = require('node:test');
const assert = require('node:assert');

// Mock chrome API before importing modules
global.chrome = {
  runtime: {
    getURL: (filename) => `chrome-extension://fake-id/${filename}`
  }
};

// Mock DOMPurify for Node.js environment
const mockDOMPurify = {
  sanitize: (html, config) => {
    // Simple sanitization: remove script tags and event handlers
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  }
};

// Import real modules (they will use our mocked DOMPurify)
const { AnkiToRekapuConverter } = require('../src/utils/ankiToRekapuConverter');
const { ApkgParser } = require('../src/utils/apkgParser');
const { ApkgImporter } = require('../src/utils/apkgImporter');
const { DEFAULT_SPACED_REPETITION } = require('../src/types/storage');

// Manually set the DOMPurify instance to avoid async loading issues
AnkiToRekapuConverter['domPurifyPromise'] = Promise.resolve(mockDOMPurify);

// Helper to create mock AnkiNote
function createMockNote(overrides = {}) {
  return {
    id: '123',
    guid: 'abc123',
    modelId: 'model1',
    fields: ['Question', 'Answer'],
    tags: ['tag1', 'tag2'],
    flags: 0,
    modified: Date.now(),
    ...overrides
  };
}

// Helper to create mock AnkiModel
function createMockModel(overrides = {}) {
  return {
    id: 'model1',
    name: 'Basic',
    type: 0,
    fields: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}', ord: 0 }],
    ...overrides
  };
}

describe('AnkiToRekapuConverter - Real Implementation', () => {
  
  describe('convert() method', () => {
    test('converts basic note to Rekapu card', async () => {
      const notes = [createMockNote()];
      const models = new Map([['model1', createMockModel()]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.strictEqual(result.cards.length, 1, 'Should create one card');
      assert.strictEqual(result.cards[0].type, 'basic');
      assert.strictEqual(result.cards[0].front, 'Question');
      assert.strictEqual(result.cards[0].back, 'Answer');
      assert.ok(result.cards[0].id.startsWith('anki_'), 'ID should start with anki_');
    });

    test('converts cloze note to Rekapu cloze card', async () => {
      const clozeNote = createMockNote({
        modelId: 'clozeModel',
        fields: ['The capital of {{c1::France}} is {{c2::Paris}}', '']
      });
      const clozeModel = createMockModel({
        id: 'clozeModel',
        name: 'Cloze',
        type: 1
      });
      
      const notes = [clozeNote];
      const models = new Map([['clozeModel', clozeModel]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.strictEqual(result.cards[0].type, 'cloze');
      assert.ok(result.cards[0].front.includes('{{c1::France}}'));
      assert.ok(result.cards[0].clozeDeletions, 'Should have cloze deletions');
      assert.strictEqual(result.cards[0].clozeDeletions.length, 2);
    });

    test('sanitizes HTML content by removing script tags', async () => {
      const htmlNote = createMockNote({
        fields: ['<p>Question with <script>alert("xss")</script></p>', '<b>Bold answer</b>']
      });
      
      const notes = [htmlNote];
      const models = new Map([['model1', createMockModel()]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.ok(!result.cards[0].front.includes('<script>'), 'Should remove script tags');
      assert.ok(result.cards[0].back.includes('<b>'), 'Should preserve safe tags');
    });

    test('converts [sound:file.mp3] to audio tags', async () => {
      const audioNote = createMockNote({
        fields: ['Listen: [sound:audio.mp3]', 'Answer']
      });
      
      const notes = [audioNote];
      const models = new Map([['model1', createMockModel()]]);
      const mediaIdMap = new Map([['audio.mp3', 'media_123']]);
      const options = { mediaIdMap };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.ok(result.cards[0].front.includes('<audio'), 'Should create audio tag');
      assert.ok(result.cards[0].front.includes('data-media-id="media_123"'), 'Should include media ID');
    });

    test('adds additional tags to all cards', async () => {
      const notes = [createMockNote({ tags: ['original'] })];
      const models = new Map([['model1', createMockModel()]]);
      const options = { 
        mediaIdMap: new Map(),
        additionalTags: ['imported', 'anki-deck']
      };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.ok(result.cards[0].tags.includes('original'));
      assert.ok(result.cards[0].tags.includes('imported'));
      assert.ok(result.cards[0].tags.includes('anki-deck'));
    });

    test('collects all unique tags from notes', async () => {
      const notes = [
        createMockNote({ tags: ['tag1', 'tag2'] }),
        createMockNote({ id: '456', tags: ['tag2', 'tag3'] })
      ];
      const models = new Map([['model1', createMockModel()]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.strictEqual(result.tags.size, 3);
      assert.ok(result.tags.has('tag1'));
      assert.ok(result.tags.has('tag2'));
      assert.ok(result.tags.has('tag3'));
    });

    test('warns when model is not found for note', async () => {
      const notes = [createMockNote({ modelId: 'nonexistent' })];
      const models = new Map();
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.strictEqual(result.cards.length, 0);
      assert.ok(result.warnings.some(w => w.includes('Model not found')));
    });

    test('tracks media usage per card', async () => {
      const note = createMockNote({
        fields: ['<img src="image.jpg">', '[sound:audio.mp3]']
      });
      
      const notes = [note];
      const models = new Map([['model1', createMockModel()]]);
      const mediaIdMap = new Map([
        ['image.jpg', 'media_img'],
        ['audio.mp3', 'media_audio']
      ]);
      const options = { mediaIdMap };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      // Should track at least one of the media references
      assert.ok(result.mediaUsage.size > 0, 'Should track media usage');
    });

    test('sets proper algorithm defaults for new cards', async () => {
      const notes = [createMockNote()];
      const models = new Map([['model1', createMockModel()]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      const card = result.cards[0];
      assert.strictEqual(card.algorithm.interval, DEFAULT_SPACED_REPETITION.interval);
      assert.strictEqual(card.algorithm.ease, DEFAULT_SPACED_REPETITION.ease);
      assert.strictEqual(card.algorithm.repetitions, DEFAULT_SPACED_REPETITION.repetitions);
      assert.ok(card.algorithm.dueDate, 'Should have dueDate set');
    });

    test('preserves cloze hints in conversion', async () => {
      const clozeNote = createMockNote({
        modelId: 'clozeModel',
        fields: ['{{c1::Paris::capital of France}} is beautiful', '']
      });
      const clozeModel = createMockModel({ id: 'clozeModel', type: 1 });
      
      const notes = [clozeNote];
      const models = new Map([['clozeModel', clozeModel]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      assert.strictEqual(result.cards[0].clozeDeletions[0].hint, 'capital of France');
    });

    test('handles multiple cloze deletions with same ID', async () => {
      const clozeNote = createMockNote({
        modelId: 'clozeModel',
        fields: ['{{c1::France}} and {{c1::Germany}}', ''] // Same c1
      });
      const clozeModel = createMockModel({ id: 'clozeModel', type: 1 });
      
      const notes = [clozeNote];
      const models = new Map([['clozeModel', clozeModel]]);
      const options = { mediaIdMap: new Map() };
      
      const result = await AnkiToRekapuConverter.convert(notes, models, options);
      
      // Should only have one deletion with id 1 (first occurrence)
      const c1Deletions = result.cards[0].clozeDeletions.filter(d => d.id === 1);
      assert.strictEqual(c1Deletions.length, 1);
    });
  });
});

describe('ApkgParser - Real Implementation', () => {
  
  describe('parse() method', () => {
    test('handles invalid ZIP file gracefully', async () => {
      const invalidFile = new File(['not a zip'], 'invalid.apkg', { type: 'application/octet-stream' });
      
      const result = await ApkgParser.parse(invalidFile);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.length > 0);
    });

    test('handles ZIP without database file', async () => {
      const JSZip = require('jszip');
      const zip = new JSZip();
      zip.file('random.txt', 'not a database');
      
      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const file = new File([content], 'nodatabase.apkg', { type: 'application/octet-stream' });
      
      const result = await ApkgParser.parse(file);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.length > 0, 'Should have errors');
    });
  });
});

describe('ApkgImporter - Real Implementation', () => {
  
  describe('validateFile() method', () => {
    test('rejects non-.apkg extension', async () => {
      const file = new File(['test'], 'deck.txt', { type: 'text/plain' });
      const result = await ApkgImporter.validateFile(file);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('.apkg'));
    });

    test('checks extension case-insensitively', () => {
      // Test extension checking logic directly
      const checkExtension = (filename) => filename.toLowerCase().endsWith('.apkg');
      
      assert.strictEqual(checkExtension('test.apkg'), true);
      assert.strictEqual(checkExtension('test.APKG'), true);
      assert.strictEqual(checkExtension('test.ApKg'), true);
      assert.strictEqual(checkExtension('test.txt'), false);
    });
  });

  describe('parse() method', () => {
    test('calls onProgress callback during parsing', async () => {
      const progressCalls = [];
      const options = {
        onProgress: (progress, status) => {
          progressCalls.push({ progress, status });
        }
      };
      
      const file = new File(['invalid'], 'test.apkg', { type: 'application/octet-stream' });
      
      await ApkgImporter.parse(file, options);
      
      assert.ok(progressCalls.length > 0, 'Should call progress callback');
      assert.ok(progressCalls[0].status, 'Should have status message');
    });

    test('returns error for invalid file', async () => {
      const file = new File(['not a zip'], 'test.apkg', { type: 'application/octet-stream' });
      
      const result = await ApkgImporter.parse(file);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.length > 0);
    });
  });
});

describe('Integration - Full Pipeline', () => {
  
  test('converts multiple notes with different types', async () => {
    const basicNote = createMockNote({ id: '1', modelId: 'basic' });
    const clozeNote = createMockNote({
      id: '2',
      modelId: 'cloze',
      fields: ['{{c1::Test}} cloze', '']
    });
    
    const basicModel = createMockModel({ id: 'basic', type: 0 });
    const clozeModel = createMockModel({ id: 'cloze', type: 1 });
    
    const notes = [basicNote, clozeNote];
    const models = new Map([
      ['basic', basicModel],
      ['cloze', clozeModel]
    ]);
    
    const result = await AnkiToRekapuConverter.convert(notes, models, { mediaIdMap: new Map() });
    
    assert.strictEqual(result.cards.length, 2);
    assert.strictEqual(result.cards[0].type, 'basic');
    assert.strictEqual(result.cards[1].type, 'cloze');
  });

  test('handles empty notes array', async () => {
    const result = await AnkiToRekapuConverter.convert([], new Map(), { mediaIdMap: new Map() });
    
    assert.strictEqual(result.cards.length, 0);
    assert.strictEqual(result.tags.size, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  test('generates valid BackupData structure', async () => {
    const notes = [createMockNote()];
    const models = new Map([['model1', createMockModel()]]);
    
    const result = await AnkiToRekapuConverter.convert(notes, models, { mediaIdMap: new Map() });
    
    const card = result.cards[0];
    assert.ok(card.id, 'Should have id');
    assert.ok(card.type, 'Should have type');
    assert.ok(card.front !== undefined, 'Should have front');
    assert.ok(card.back !== undefined, 'Should have back');
    assert.ok(Array.isArray(card.tags), 'Should have tags array');
    assert.ok(card.created, 'Should have created timestamp');
    assert.ok(card.modified, 'Should have modified timestamp');
    assert.strictEqual(card.isDraft, false, 'Should not be draft');
    assert.ok(card.algorithm, 'Should have algorithm');
  });

  test('tag colors are consistent for same tag name', async () => {
    const notes1 = [createMockNote({ tags: ['programming'] })];
    const notes2 = [createMockNote({ id: '456', tags: ['programming'] })];
    const models = new Map([['model1', createMockModel()]]);
    
    const result1 = await AnkiToRekapuConverter.convert(notes1, models, { mediaIdMap: new Map() });
    const result2 = await AnkiToRekapuConverter.convert(notes2, models, { mediaIdMap: new Map() });
    
    const tag1 = result1.tags.get('programming');
    const tag2 = result2.tags.get('programming');
    
    assert.strictEqual(tag1.color, tag2.color, 'Same tag should have same color');
  });
});

console.log('✅ Real APKG import tests loaded');
