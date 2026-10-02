import { ApiKeyValidationResult, BaseTTSProvider, TTSOptions, Voice } from '../TTSProvider';
import { TTS_PROVIDERS } from '../providerCatalog';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string>;
}

interface ElevenLabsError {
  status?: string; // e.g. 'invalid_api_key', 'missing_permissions'
  message: string;
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
  has_more: boolean;
  next_page_token?: string | null;
}

// Multilingual v2 rejects `language_code`; the other models use it to enforce the language
const MODELS_WITHOUT_LANGUAGE_CODE = new Set(['eleven_multilingual_v2']);

// ISO 639-1 codes of the languages supported by Eleven v4, the model with the widest coverage.
// Older models support a subset and detect the language from the text.
const SUPPORTED_LANGUAGES = [
  'af', 'am', 'ar', 'as', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'fa', 'ff', 'fi', 'fil', 'fr', 'gl', 'gu', 'ha', 'he', 'hi', 'hr', 'hu',
  'hy', 'id', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'kn', 'ko', 'ky', 'lb', 'lg', 'ln', 'lo',
  'lt', 'lv', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl', 'oc', 'or',
  'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'sk', 'sl', 'sn', 'so', 'sr', 'sv', 'sw', 'ta',
  'te', 'tg', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'wo', 'zh', 'zu',
];

const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;

export class ElevenLabsTTSProvider extends BaseTTSProvider {
  private readonly baseUrl = 'https://api.elevenlabs.io';
  private voicesCache: { voices: Voice[]; fetchedAt: number } | null = null;

  constructor(apiKey: string) {
    super(apiKey, 'elevenlabs');
  }

  async synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer> {
    const modelId = options.model || TTS_PROVIDERS.elevenlabs.defaultModel;
    const body: Record<string, unknown> = {
      text,
      model_id: modelId
    };

    // Accept both 'en' and Google-style 'en-US' codes
    const languageCode = options.language?.split('-')[0].toLowerCase();
    if (!MODELS_WITHOUT_LANGUAGE_CODE.has(modelId) && languageCode?.length === 2) {
      body.language_code = languageCode;
    }

    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(options.voice)}?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'xi-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await this.readError(response);
      throw new Error(`ElevenLabs TTS API error: ${response.status} - ${error.message}`);
    }

    return response.arrayBuffer();
  }

  // ElevenLabs voices are multilingual, so every voice is returned regardless of language
  async getAvailableVoices(_languageCode?: string): Promise<Voice[]> {
    if (this.voicesCache && Date.now() - this.voicesCache.fetchedAt < VOICES_CACHE_TTL_MS) {
      return this.voicesCache.voices;
    }

    const elevenLabsVoices: ElevenLabsVoice[] = [];
    let pageToken: string | null | undefined;
    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (pageToken) {
        params.set('next_page_token', pageToken);
      }

      const response = await fetch(`${this.baseUrl}/v2/voices?${params}`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        const error = await this.readError(response);
        throw new Error(`ElevenLabs TTS API error: ${response.status} - ${error.message}`);
      }

      const data: ElevenLabsVoicesResponse = await response.json();
      elevenLabsVoices.push(...data.voices);
      pageToken = data.has_more ? data.next_page_token : null;
    } while (pageToken);

    const voices = elevenLabsVoices
      .map(voice => this.toVoice(voice))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.voicesCache = { voices, fetchedAt: Date.now() };
    return voices;
  }

  async getSupportedLanguages(): Promise<string[]> {
    return [...SUPPORTED_LANGUAGES];
  }

  async validateApiKey(key: string): Promise<ApiKeyValidationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/voices?page_size=1`, {
        headers: {
          'xi-api-key': key
        }
      });

      if (response.ok) {
        return { valid: true };
      }

      const error = await this.readError(response);
      console.error('ElevenLabs API validation failed:', {
        status: response.status,
        statusText: response.statusText,
        error
      });

      if (error.status === 'invalid_api_key' || (response.status === 401 && !error.status)) {
        return { valid: false, message: error.message };
      }

      // The key authenticated but can't list voices, e.g. a restricted key without
      // "Voices: read" access. It can still synthesize, so accept it with a warning.
      return { valid: true, message: error.message };
    } catch (error) {
      console.error('API key validation network error:', error);
      return { valid: false, message: error instanceof Error ? error.message : undefined };
    }
  }

  // Errors look like {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}
  private async readError(response: Response): Promise<ElevenLabsError> {
    const text = await response.text();
    try {
      const detail = JSON.parse(text).detail;
      if (typeof detail === 'string') {
        return { message: detail };
      }
      if (detail?.message) {
        return { status: detail.status, message: detail.message };
      }
    } catch {
      // Not JSON, fall through to the raw body
    }
    return { message: text || response.statusText };
  }

  estimateCost(text: string): number {
    // Rough figure: ElevenLabs bills plan credits (~1 per character), not a flat per-character price
    const characterCount = text.length;
    const costPerMillionChars = 150.0;
    return (characterCount / 1_000_000) * costPerMillionChars;
  }

  // The same voice sounds different across models, so the model is part of the cache key
  getCacheKey(options: TTSOptions): string {
    const modelId = options.model || TTS_PROVIDERS.elevenlabs.defaultModel;
    return `${super.getCacheKey(options)}|${modelId}`;
  }

  private toVoice(voice: ElevenLabsVoice): Voice {
    const labels = voice.labels || {};
    const gender = labels.gender?.toLowerCase();
    const traits = [labels.accent, labels.gender].filter(Boolean).join(', ');

    return {
      id: voice.voice_id,
      name: traits ? `${voice.name} (${traits})` : voice.name,
      language: labels.language || '',
      languageCode: labels.language || '',
      gender: gender === 'male' || gender === 'female' || gender === 'neutral' ? gender : undefined,
      description: voice.description || undefined
    };
  }
}
