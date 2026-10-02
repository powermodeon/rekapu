import { TTSProvider, TTSProviderConfig, TTSProviderId } from './TTSProvider';
import { GoogleTTSProvider } from './providers/GoogleTTSProvider';
import { ElevenLabsTTSProvider } from './providers/ElevenLabsTTSProvider';
import { TTS_PROVIDER_IDS } from './providerCatalog';

export class TTSProviderFactory {
  private static instance: TTSProviderFactory;
  private providers: Map<string, TTSProvider> = new Map();

  private constructor() {}

  static getInstance(): TTSProviderFactory {
    if (!TTSProviderFactory.instance) {
      TTSProviderFactory.instance = new TTSProviderFactory();
    }
    return TTSProviderFactory.instance;
  }

  createProvider(config: TTSProviderConfig): TTSProvider {
    const cacheKey = `${config.provider}:${config.apiKey}`;

    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!;
    }

    let provider: TTSProvider;

    switch (config.provider) {
      case 'google':
        provider = new GoogleTTSProvider(config.apiKey);
        break;

      case 'elevenlabs':
        provider = new ElevenLabsTTSProvider(config.apiKey);
        break;

      default:
        throw new Error(`Unknown TTS provider: ${config.provider}`);
    }

    this.providers.set(cacheKey, provider);
    return provider;
  }

  clearCache(): void {
    this.providers.clear();
  }

  getSupportedProviders(): TTSProviderId[] {
    return TTS_PROVIDER_IDS;
  }
}
