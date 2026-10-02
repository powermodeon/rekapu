import { TTSProviderId } from './TTSProvider';

export type TTSKeys = Partial<Record<TTSProviderId, string>>;

export interface TTSTagConfig {
  language: string;
  model: string;
  voice: string;
  cardSide: 'front' | 'back' | 'both';
}

export type TTSTagConfigMap = {
  [tagName: string]: TTSTagConfig;
};

export interface TTSSettings {
  provider: TTSProviderId;
  keys: TTSKeys;
  selectedVoices: {
    [languageCode: string]: string;
  };
  cacheSizeLimit: number;
  enabledTags: string[];
  // Voices and models are provider-specific, so each provider keeps its own tag configs
  tagConfigsByProvider: Partial<Record<TTSProviderId, TTSTagConfigMap>>;
}

// Settings saved before multi-provider support kept Google tag configs in `tagConfigs`
type StoredTTSSettings = Partial<TTSSettings> & {
  tagConfigs?: TTSTagConfigMap;
};

function createDefaultSettings(): TTSSettings {
  return {
    provider: 'google',
    keys: {},
    selectedVoices: {},
    cacheSizeLimit: 100 * 1024 * 1024,
    enabledTags: [],
    tagConfigsByProvider: {}
  };
}

export class TTSKeyStorage {
  private static instance: TTSKeyStorage;
  private readonly storageKey = 'tts_settings';

  private constructor() {}

  static getInstance(): TTSKeyStorage {
    if (!TTSKeyStorage.instance) {
      TTSKeyStorage.instance = new TTSKeyStorage();
    }
    return TTSKeyStorage.instance;
  }

  async saveSettings(settings: TTSSettings): Promise<void> {
    // chrome.storage.local is already isolated from web pages and provides
    // OS-level encryption at rest. Additional app-level encryption would be
    // security theater since we have no secure place to store the encryption key.
    await chrome.storage.local.set({
      [this.storageKey]: settings
    });
  }

  async getSettings(): Promise<TTSSettings | null> {
    const result = await chrome.storage.local.get(this.storageKey);
    const stored: StoredTTSSettings | undefined = result[this.storageKey];
    if (!stored) {
      return null;
    }

    const { tagConfigs: legacyTagConfigs, ...rest } = stored;
    const settings: TTSSettings = { ...createDefaultSettings(), ...rest };

    if (!stored.tagConfigsByProvider && legacyTagConfigs) {
      settings.tagConfigsByProvider = { google: legacyTagConfigs };
    }

    return settings;
  }

  private async getSettingsOrDefault(): Promise<TTSSettings> {
    return (await this.getSettings()) || createDefaultSettings();
  }

  async getApiKey(provider: TTSProviderId): Promise<string | null> {
    const settings = await this.getSettings();
    if (!settings) {
      return null;
    }

    return settings.keys[provider] || null;
  }

  async saveApiKey(provider: TTSProviderId, apiKey: string): Promise<void> {
    const currentSettings = await this.getSettingsOrDefault();
    currentSettings.keys[provider] = apiKey;
    await this.saveSettings(currentSettings);
  }

  async deleteApiKey(provider: TTSProviderId): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) {
      return;
    }

    delete settings.keys[provider];
    await this.saveSettings(settings);
  }

  async clearAllKeys(): Promise<void> {
    await chrome.storage.local.remove(this.storageKey);
  }

  async updateProvider(provider: TTSProviderId): Promise<void> {
    const currentSettings = await this.getSettingsOrDefault();
    currentSettings.provider = provider;
    await this.saveSettings(currentSettings);
  }

  async updateSelectedVoice(languageCode: string, voiceId: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) {
      return;
    }

    settings.selectedVoices[languageCode] = voiceId;
    await this.saveSettings(settings);
  }

  async updateCacheSizeLimit(sizeBytes: number): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) {
      return;
    }

    settings.cacheSizeLimit = sizeBytes;
    await this.saveSettings(settings);
  }

  async setEnabledTags(tags: string[]): Promise<void> {
    const currentSettings = await this.getSettingsOrDefault();
    currentSettings.enabledTags = tags;
    await this.saveSettings(currentSettings);
  }

  async getEnabledTags(): Promise<string[]> {
    const settings = await this.getSettings();
    return settings?.enabledTags || [];
  }

  async isTagEnabled(tag: string): Promise<boolean> {
    const enabledTags = await this.getEnabledTags();
    return enabledTags.includes(tag);
  }

  /** Saves the tag config for the currently selected provider. */
  async setTagConfig(tag: string, config: TTSTagConfig): Promise<void> {
    const currentSettings = await this.getSettingsOrDefault();
    const provider = currentSettings.provider;

    currentSettings.tagConfigsByProvider[provider] = {
      ...currentSettings.tagConfigsByProvider[provider],
      [tag]: config
    };

    await this.saveSettings(currentSettings);
  }

  /** Returns the tag config for the currently selected provider. */
  async getTagConfig(tag: string): Promise<TTSTagConfig | null> {
    const configs = await this.getAllTagConfigs();
    return configs[tag] || null;
  }

  /** Returns all tag configs for the currently selected provider. */
  async getAllTagConfigs(): Promise<TTSTagConfigMap> {
    const settings = await this.getSettings();
    if (!settings) {
      return {};
    }

    return settings.tagConfigsByProvider[settings.provider] || {};
  }
}
