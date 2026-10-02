/**
 * TTS Provider Tests
 * Tests the ElevenLabs provider request/response handling, provider selection,
 * and migration of pre-multi-provider TTS settings
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { ElevenLabsTTSProvider } from '../src/tts/providers/ElevenLabsTTSProvider';
import { GoogleTTSProvider } from '../src/tts/providers/GoogleTTSProvider';
import { TTSProviderFactory } from '../src/tts/TTSProviderFactory';
import { TTSKeyStorage } from '../src/tts/TTSKeyStorage';
import { voiceMatchesModel } from '../src/tts/providerCatalog';

interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

const originalFetch = globalThis.fetch;
let requests: RecordedRequest[] = [];

function mockFetch(respond: (url: string) => Response) {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    requests.push({ url, init });
    return respond(url);
  }) as typeof fetch;
}

const voicesResponse = {
  voices: [
    { voice_id: 'voice-b', name: 'Brian', labels: { accent: 'american', gender: 'male' } },
    { voice_id: 'voice-a', name: 'Alice', labels: { accent: 'british', gender: 'female' } }
  ],
  has_more: false,
  next_page_token: null
};

describe('ElevenLabsTTSProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('synthesizes with voice id, model and API key header', async () => {
    mockFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = new ElevenLabsTTSProvider('sk_test');

    const audio = await provider.synthesize('Hello', {
      text: 'Hello',
      language: 'en',
      voice: 'voice-a',
      model: 'eleven_multilingual_v2'
    });

    assert.deepStrictEqual(Array.from(new Uint8Array(audio)), [1, 2, 3]);
    assert.strictEqual(requests.length, 1);
    assert.ok(requests[0].url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/voice-a?'));
    const headers = requests[0].init?.headers as Record<string, string>;
    assert.strictEqual(headers['xi-api-key'], 'sk_test');
    const body = JSON.parse(requests[0].init?.body as string);
    assert.deepStrictEqual(body, { text: 'Hello', model_id: 'eleven_multilingual_v2' });
  });

  test('sends language_code only for models that support it', async () => {
    mockFetch(() => new Response(new Uint8Array([0]), { status: 200 }));
    const provider = new ElevenLabsTTSProvider('sk_test');

    await provider.synthesize('Hola', { text: 'Hola', language: 'es-ES', voice: 'v', model: 'eleven_v4' });
    await provider.synthesize('Hola', { text: 'Hola', language: 'es', voice: 'v', model: 'eleven_multilingual_v2' });

    assert.strictEqual(JSON.parse(requests[0].init?.body as string).language_code, 'es');
    assert.strictEqual(JSON.parse(requests[1].init?.body as string).language_code, undefined);
  });

  test('falls back to the default model', async () => {
    mockFetch(() => new Response(new Uint8Array([0]), { status: 200 }));
    const provider = new ElevenLabsTTSProvider('sk_test');

    await provider.synthesize('Hi', { text: 'Hi', language: 'en', voice: 'v' });

    assert.strictEqual(JSON.parse(requests[0].init?.body as string).model_id, 'eleven_multilingual_v2');
  });

  test('throws with API error details', async () => {
    mockFetch(() => new Response('{"detail":"quota_exceeded"}', { status: 429 }));
    const provider = new ElevenLabsTTSProvider('sk_test');

    await assert.rejects(
      provider.synthesize('Hi', { text: 'Hi', language: 'en', voice: 'v' }),
      /ElevenLabs TTS API error: 429 - quota_exceeded/
    );
  });

  test('maps and sorts voices, without tying them to a model', async () => {
    mockFetch(() => Response.json(voicesResponse));
    const provider = new ElevenLabsTTSProvider('sk_test');

    const voices = await provider.getAvailableVoices('en');

    assert.deepStrictEqual(voices.map(v => v.id), ['voice-a', 'voice-b']);
    assert.strictEqual(voices[0].name, 'Alice (british, female)');
    assert.strictEqual(voices[0].gender, 'female');
    assert.strictEqual(voices[0].model, undefined);
    assert.ok(voiceMatchesModel(voices[0], 'eleven_flash_v2_5'));
  });

  test('follows voice list pagination', async () => {
    mockFetch(url => url.includes('next_page_token=page2')
      ? Response.json({ voices: [{ voice_id: 'voice-c', name: 'Chris' }], has_more: false })
      : Response.json({ ...voicesResponse, has_more: true, next_page_token: 'page2' }));
    const provider = new ElevenLabsTTSProvider('sk_test');

    const voices = await provider.getAvailableVoices();

    assert.deepStrictEqual(voices.map(v => v.id), ['voice-a', 'voice-b', 'voice-c']);
    assert.strictEqual(requests.length, 2);
    assert.ok(requests[0].url.startsWith('https://api.elevenlabs.io/v2/voices?page_size=100'));
  });

  test('caches the voice list', async () => {
    mockFetch(() => Response.json(voicesResponse));
    const provider = new ElevenLabsTTSProvider('sk_test');

    await provider.getAvailableVoices();
    await provider.getAvailableVoices('de');

    assert.strictEqual(requests.length, 1);
  });

  test('rejects keys ElevenLabs reports as invalid, with the API message', async () => {
    mockFetch(() => Response.json(
      { detail: { type: 'authentication_error', code: 'unauthorized', message: 'Invalid API key', status: 'invalid_api_key' } },
      { status: 401 }
    ));
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepStrictEqual(
        await new ElevenLabsTTSProvider('x').validateApiKey('bad'),
        { valid: false, message: 'Invalid API key' }
      );
    } finally {
      console.error = originalError;
    }
  });

  test('accepts keys that authenticate but lack voice read permission', async () => {
    const message = 'The API key you used is missing the permission voices_read to execute this operation.';
    mockFetch(() => Response.json({ detail: { status: 'missing_permissions', message } }, { status: 401 }));
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepStrictEqual(await new ElevenLabsTTSProvider('x').validateApiKey('restricted'), { valid: true, message });
    } finally {
      console.error = originalError;
    }
  });

  test('accepts keys that can list voices', async () => {
    mockFetch(() => Response.json(voicesResponse));
    assert.deepStrictEqual(await new ElevenLabsTTSProvider('x').validateApiKey('good'), { valid: true });
    assert.strictEqual((requests[0].init?.headers as Record<string, string>)['xi-api-key'], 'good');
  });

  test('surfaces the API message when synthesis fails', async () => {
    mockFetch(() => Response.json({ detail: { status: 'quota_exceeded', message: 'Quota exceeded' } }, { status: 401 }));
    await assert.rejects(
      new ElevenLabsTTSProvider('x').synthesize('Hi', { text: 'Hi', language: 'en', voice: 'v' }),
      /ElevenLabs TTS API error: 401 - Quota exceeded/
    );
  });

  test('includes the model in the cache key', () => {
    const provider = new ElevenLabsTTSProvider('sk_test');
    const base = { text: 'Hi', language: 'en', voice: 'v' };

    assert.notStrictEqual(
      provider.getCacheKey({ ...base, model: 'eleven_flash_v2_5' }),
      provider.getCacheKey({ ...base, model: 'eleven_v3' })
    );
  });
});

describe('Google cache key', () => {
  test('keeps the pre-multi-provider format so existing cached audio stays valid', () => {
    const provider = new GoogleTTSProvider('key');
    assert.strictEqual(
      provider.getCacheKey({ text: 'Hi', language: 'en-US', voice: 'en-US-Neural2-A', model: 'Neural2' }),
      'Hi|en-US|en-US-Neural2-A|google'
    );
  });
});

describe('TTSProviderFactory', () => {
  test('creates the requested provider', () => {
    const factory = TTSProviderFactory.getInstance();
    assert.strictEqual(factory.createProvider({ provider: 'google', apiKey: 'a' }).getName(), 'google');
    assert.strictEqual(factory.createProvider({ provider: 'elevenlabs', apiKey: 'a' }).getName(), 'elevenlabs');
    assert.deepStrictEqual(factory.getSupportedProviders(), ['google', 'elevenlabs']);
  });

  test('does not reuse a provider for a different key with the same prefix', () => {
    const factory = TTSProviderFactory.getInstance();
    const first = factory.createProvider({ provider: 'elevenlabs', apiKey: 'sk_0123456789_a' });
    const second = factory.createProvider({ provider: 'elevenlabs', apiKey: 'sk_0123456789_b' });
    assert.notStrictEqual(first, second);
  });
});

describe('TTSKeyStorage', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(store, items),
          remove: async (key: string) => { delete store[key]; }
        }
      }
    };
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  const googleConfig = { language: 'en-US', model: 'Neural2', voice: 'en-US-Neural2-A', cardSide: 'back' as const };
  const elevenConfig = { language: 'en', model: 'eleven_v3', voice: 'voice-a', cardSide: 'front' as const };

  test('migrates legacy tag configs to Google', async () => {
    store.tts_settings = {
      provider: 'google',
      keys: { google: 'g-key' },
      selectedVoices: {},
      cacheSizeLimit: 1,
      enabledTags: ['spanish'],
      tagConfigs: { spanish: googleConfig }
    };
    const storage = TTSKeyStorage.getInstance();

    assert.deepStrictEqual(await storage.getTagConfig('spanish'), googleConfig);

    await storage.updateProvider('elevenlabs');
    const saved = store.tts_settings as any;
    assert.strictEqual(saved.tagConfigs, undefined);
    assert.deepStrictEqual(saved.tagConfigsByProvider.google.spanish, googleConfig);
  });

  test('keeps tag configs separate per provider', async () => {
    const storage = TTSKeyStorage.getInstance();
    await storage.saveApiKey('google', 'g-key');
    await storage.setTagConfig('spanish', googleConfig);

    await storage.updateProvider('elevenlabs');
    await storage.saveApiKey('elevenlabs', 'sk-key');
    assert.strictEqual(await storage.getTagConfig('spanish'), null);
    await storage.setTagConfig('spanish', elevenConfig);
    assert.deepStrictEqual(await storage.getTagConfig('spanish'), elevenConfig);

    await storage.updateProvider('google');
    assert.deepStrictEqual(await storage.getTagConfig('spanish'), googleConfig);
    assert.strictEqual(await storage.getApiKey('google'), 'g-key');
    assert.strictEqual(await storage.getApiKey('elevenlabs'), 'sk-key');
  });
});
