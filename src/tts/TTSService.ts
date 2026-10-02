import { ApiKeyValidationResult, TTSProvider, TTSOptions, TTSProviderId, Voice } from './TTSProvider';
import { TTSProviderFactory } from './TTSProviderFactory';
import { TTSCacheManager } from './TTSCacheManager';
import { TTSKeyStorage, TTSSettings } from './TTSKeyStorage';

export interface SynthesizeRequest {
  text: string;
  language: string;
  voice?: string;
  model?: string;
  speed?: number;
  pitch?: number;
}

export interface TTSServiceResult {
  success: boolean;
  audio?: ArrayBuffer;
  cached?: boolean;
  error?: string;
  costEstimate?: number;
}

export class TTSService {
  private static instance: TTSService;
  private factory: TTSProviderFactory;
  private cacheManager: TTSCacheManager;
  private keyStorage: TTSKeyStorage;
  private initialized: boolean = false;

  private constructor() {
    this.factory = TTSProviderFactory.getInstance();
    this.cacheManager = TTSCacheManager.getInstance();
    this.keyStorage = TTSKeyStorage.getInstance();
  }

  static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService();
    }
    return TTSService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.cacheManager.initialize();
    this.initialized = true;
  }

  async synthesize(request: SynthesizeRequest): Promise<TTSServiceResult> {
    try {
      await this.initialize();

      const active = await this.getActiveProvider();
      if ('error' in active) {
        return { success: false, error: active.error };
      }
      const { provider, settings } = active;

      const voice = request.voice || settings.selectedVoices[request.language];
      if (!voice) {
        return {
          success: false,
          error: `No voice selected for language: ${request.language}`
        };
      }

      const options: TTSOptions = {
        text: request.text,
        language: request.language,
        voice,
        model: request.model,
        speed: request.speed,
        pitch: request.pitch
      };

      const hash = await this.generateHash(provider.getCacheKey(options));

      const cachedAudio = await this.cacheManager.get(hash);
      if (cachedAudio) {
        return {
          success: true,
          audio: cachedAudio,
          cached: true
        };
      }

      const audio = await provider.synthesize(request.text, options);

      await this.cacheManager.set(
        hash,
        audio,
        request.text,
        request.language,
        voice,
        settings.provider
      );

      const costEstimate = provider.estimateCost(request.text);

      return {
        success: true,
        audio,
        cached: false,
        costEstimate
      };

    } catch (error) {
      console.error('TTS synthesis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getAvailableVoices(languageCode?: string): Promise<Voice[]> {
    try {
      return await (await this.requireActiveProvider()).getAvailableVoices(languageCode);
    } catch (error) {
      console.error('Failed to get available voices:', error);
      throw error;
    }
  }

  async getSupportedLanguages(): Promise<string[]> {
    try {
      return await (await this.requireActiveProvider()).getSupportedLanguages();
    } catch (error) {
      console.error('Failed to get supported languages:', error);
      throw error;
    }
  }

  async validateApiKey(provider: TTSProviderId, apiKey: string): Promise<ApiKeyValidationResult> {
    try {
      const ttsProvider = this.factory.createProvider({
        provider,
        apiKey
      });

      return await ttsProvider.validateApiKey(apiKey);
    } catch (error) {
      console.error('API key validation failed:', error);
      return { valid: false, message: error instanceof Error ? error.message : undefined };
    }
  }

  async getCacheStatistics() {
    return await this.cacheManager.getStatistics();
  }

  async clearCache(): Promise<void> {
    await this.cacheManager.clear();
  }

  async clearCacheByProvider(provider: string): Promise<number> {
    return await this.cacheManager.clearByProvider(provider);
  }

  async updateCacheLimit(sizeBytes: number): Promise<void> {
    await this.cacheManager.setMaxSize(sizeBytes);
    await this.keyStorage.updateCacheSizeLimit(sizeBytes);
  }

  private async getActiveProvider(): Promise<
    { provider: TTSProvider; settings: TTSSettings } | { error: string }
  > {
    const settings = await this.keyStorage.getSettings();
    if (!settings) {
      return { error: 'TTS not configured. Please set up TTS in settings.' };
    }

    const apiKey = settings.keys[settings.provider];
    if (!apiKey) {
      return { error: `API key not found for provider: ${settings.provider}` };
    }

    const provider = this.factory.createProvider({
      provider: settings.provider,
      apiKey
    });

    return { provider, settings };
  }

  private async requireActiveProvider(): Promise<TTSProvider> {
    const active = await this.getActiveProvider();
    if ('error' in active) {
      throw new Error(active.error);
    }
    return active.provider;
  }

  private async generateHash(cacheKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(cacheKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
