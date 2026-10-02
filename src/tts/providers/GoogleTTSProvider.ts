import { ApiKeyValidationResult, BaseTTSProvider, TTSOptions, Voice } from '../TTSProvider';

interface GoogleTTSRequest {
  input: {
    text: string;
  };
  voice: {
    languageCode: string;
    name: string;
    model?: string;
    modelName?: string;
  };
  audioConfig: {
    audioEncoding: string;
    speakingRate?: number;
    pitch?: number;
  };
}

interface GoogleTTSResponse {
  audioContent: string;
}

interface GoogleVoice {
  name: string;
  languageCodes: string[];
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  naturalSampleRateHertz: number;
}

interface GoogleVoicesResponse {
  voices: GoogleVoice[];
}

type VoiceModelType = 'Standard' | 'WaveNet' | 'Neural2' | 'Studio' | 'Polyglot' | 'Journey' | 'News' | 'Chirp3';

export class GoogleTTSProvider extends BaseTTSProvider {
  private readonly baseUrl = 'https://texttospeech.googleapis.com/v1';

  constructor(apiKey: string) {
    super(apiKey, 'google');
  }

  async synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer> {
    const request: any = {
      input: {
        text
      },
      voice: {
        languageCode: options.language,
        name: options.voice
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: options.speed || 1.0,
        pitch: options.pitch || 0.0
      }
    };

    // Add modelName field if model is specified
    if (options.model) {
      request.voice.modelName = options.model.toLowerCase();
    }

    const response = await fetch(`${this.baseUrl}/text:synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google TTS API error: ${response.status} - ${error}`);
    }

    const data: GoogleTTSResponse = await response.json();
    return this.decodeBase64Audio(data.audioContent);
  }

  private decodeBase64Audio(base64Audio: string): ArrayBuffer {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async getAvailableVoices(languageCode?: string): Promise<Voice[]> {
    const url = languageCode
      ? `${this.baseUrl}/voices?languageCode=${languageCode}`
      : `${this.baseUrl}/voices`;

    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google TTS API error: ${response.status} - ${error}`);
    }

    const data: GoogleVoicesResponse = await response.json();

    return data.voices.map(voice => {
      const model = this.extractModelFromVoiceName(voice.name);
      return {
        id: voice.name,
        name: voice.name,
        language: voice.languageCodes[0],
        languageCode: voice.languageCodes[0],
        gender: voice.ssmlGender.toLowerCase() as 'male' | 'female' | 'neutral',
        model: model || 'Standard',
        description: `${voice.name} (${model || 'Standard'}, ${voice.naturalSampleRateHertz}Hz)`
      };
    });
  }

  async validateApiKey(key: string): Promise<ApiKeyValidationResult> {
    try {
      const testUrl = `${this.baseUrl}/voices`;
      const response = await fetch(testUrl, {
        headers: {
          'X-Goog-Api-Key': key
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google TTS API validation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        return { valid: false, message: this.extractErrorMessage(errorText) };
      }
      
      return { valid: true };
    } catch (error) {
      console.error('API key validation network error:', error);
      return { valid: false, message: error instanceof Error ? error.message : undefined };
    }
  }

  private extractErrorMessage(errorText: string): string {
    try {
      return JSON.parse(errorText).error?.message || errorText;
    } catch {
      return errorText;
    }
  }

  estimateCost(text: string): number {
    const characterCount = text.length;
    const costPerMillionChars = 4.0;
    return (characterCount / 1_000_000) * costPerMillionChars;
  }

  private extractModelFromVoiceName(voiceName: string): VoiceModelType | null {
    const modelPatterns: { pattern: RegExp; model: VoiceModelType }[] = [
      { pattern: /Neural2/i, model: 'Neural2' },
      { pattern: /WaveNet/i, model: 'WaveNet' },
      { pattern: /Studio/i, model: 'Studio' },
      { pattern: /Polyglot/i, model: 'Polyglot' },
      { pattern: /Journey/i, model: 'Journey' },
      { pattern: /News/i, model: 'News' },
      { pattern: /Chirp/i, model: 'Chirp3' },
      { pattern: /Standard/i, model: 'Standard' },
    ];

    for (const { pattern, model } of modelPatterns) {
      if (pattern.test(voiceName)) {
        return model;
      }
    }

    return null;
  }
}
