export type TTSProviderId = 'google' | 'elevenlabs';

export interface TTSOptions {
  text: string;
  language: string;
  voice: string;
  model?: string;
  speed?: number;
  pitch?: number;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  languageCode: string;
  gender?: 'male' | 'female' | 'neutral';
  description?: string;
  // Voice model type (e.g., 'Neural2', 'WaveNet', 'Chirp3'). Left undefined when the
  // provider's voices work with every model (e.g., ElevenLabs).
  model?: string;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  // Provider error explaining why the key was rejected, or a warning when the key
  // is valid but limited (e.g., missing permissions)
  message?: string;
}

export interface TTSProvider {
  synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer>;

  getAvailableVoices(languageCode?: string): Promise<Voice[]>;

  getSupportedLanguages(): Promise<string[]>;

  validateApiKey(key: string): Promise<ApiKeyValidationResult>;

  getName(): string;

  estimateCost(text: string): number;

  // String identifying the audio produced for these options, used to build the cache hash
  getCacheKey(options: TTSOptions): string;
}

export interface TTSProviderConfig {
  apiKey: string;
  provider: TTSProviderId;
  customEndpoint?: string;
}

export abstract class BaseTTSProvider implements TTSProvider {
  protected apiKey: string;
  protected providerName: TTSProviderId;

  constructor(apiKey: string, providerName: TTSProviderId) {
    this.apiKey = apiKey;
    this.providerName = providerName;
  }

  abstract synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer>;

  abstract getAvailableVoices(languageCode?: string): Promise<Voice[]>;

  abstract validateApiKey(key: string): Promise<ApiKeyValidationResult>;

  getName(): string {
    return this.providerName;
  }

  abstract estimateCost(text: string): number;

  async getSupportedLanguages(): Promise<string[]> {
    const voices = await this.getAvailableVoices();
    const codes = voices.map(voice => voice.languageCode).filter(Boolean);
    return Array.from(new Set(codes));
  }

  getCacheKey(options: TTSOptions): string {
    return `${options.text}|${options.language}|${options.voice}|${this.providerName}`;
  }
}
