import { TTSProviderId, Voice } from './TTSProvider';

export interface TTSModelOption {
  id: string;
  labelKey: string; // i18n message name
}

export interface TTSProviderInfo {
  id: TTSProviderId;
  displayName: string;
  models: TTSModelOption[];
  defaultModel: string;
  defaultLanguage: string;
}

// Static provider metadata, available to the UI before any API key is configured
export const TTS_PROVIDERS: Record<TTSProviderId, TTSProviderInfo> = {
  google: {
    id: 'google',
    displayName: 'Google Cloud TTS',
    models: [
      { id: 'Neural2', labelKey: 'neural2HighQuality' },
      { id: 'WaveNet', labelKey: 'wavenetNatural' },
      { id: 'Chirp3', labelKey: 'chirp3HDVoices' },
      { id: 'Studio', labelKey: 'studioPremium' },
      { id: 'Standard', labelKey: 'standardBasic' },
    ],
    defaultModel: 'Neural2',
    defaultLanguage: 'en-US',
  },
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    models: [
      { id: 'eleven_multilingual_v2', labelKey: 'elevenMultilingualV2' },
      { id: 'eleven_v4', labelKey: 'elevenV4' },
      { id: 'eleven_v4_turbo', labelKey: 'elevenV4Turbo' },
      { id: 'eleven_v3', labelKey: 'elevenV3' },
      { id: 'eleven_flash_v2_5', labelKey: 'elevenFlashV25' },
    ],
    defaultModel: 'eleven_multilingual_v2',
    defaultLanguage: 'en',
  },
};

export const TTS_PROVIDER_IDS = Object.keys(TTS_PROVIDERS) as TTSProviderId[];

export function isTTSProviderId(value: string): value is TTSProviderId {
  return value in TTS_PROVIDERS;
}

/**
 * Whether a voice can be used with the given model. Voices without a model
 * (e.g., ElevenLabs) work with any model.
 */
export function voiceMatchesModel(voice: Voice, model?: string): boolean {
  return !model || !voice.model || voice.model === model;
}
