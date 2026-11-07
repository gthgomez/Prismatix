// src/services/ttsPlaybackService.ts
// Text-to-speech playback service with native zero-cost browser synthesis.

export type TTSPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped' | 'error';

export interface TTSPlaybackOptions {
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export function isTTSSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export interface VoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
}

export function getAvailableVoices(): VoiceOption[] {
  if (!isTTSSupported()) return [];
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      default: v.default,
    }));
  } catch {
    return [];
  }
}

export class TTSPlaybackService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private state: TTSPlaybackState = 'idle';
  private currentText: string = '';

  public getState(): TTSPlaybackState {
    return this.state;
  }

  public getCurrentText(): string {
    return this.currentText;
  }

  public speak(text: string, options: TTSPlaybackOptions = {}): boolean {
    if (!isTTSSupported()) {
      options.onError?.('Text-to-speech is not supported in this browser.');
      this.state = 'error';
      return false;
    }

    if (!text.trim()) {
      options.onError?.('No text content to read aloud.');
      return false;
    }

    try {
      // Cancel any ongoing playback first
      this.stop();

      this.currentText = text;
      // Strip markdown syntax for natural reading
      const cleanText = text
        .replace(/```[\s\S]*?```/g, 'Code block omitted.')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*_~>]/g, '')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = options.rate ?? 1.0;
      utterance.pitch = options.pitch ?? 1.0;

      if (options.voiceURI) {
        const voices = window.speechSynthesis.getVoices();
        const selected = voices.find((v) => v.voiceURI === options.voiceURI);
        if (selected) utterance.voice = selected;
      }

      utterance.onstart = () => {
        this.state = 'playing';
        options.onStart?.();
      };

      utterance.onpause = () => {
        this.state = 'paused';
        options.onPause?.();
      };

      utterance.onresume = () => {
        this.state = 'playing';
        options.onResume?.();
      };

      utterance.onend = () => {
        this.state = 'idle';
        this.currentUtterance = null;
        options.onEnd?.();
      };

      utterance.onerror = (e) => {
        this.state = 'error';
        this.currentUtterance = null;
        options.onError?.(`TTS playback error: ${(e as { error?: string }).error || 'playback_failed'}`);
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      this.state = 'error';
      options.onError?.(err instanceof Error ? err.message : 'Failed to start TTS playback');
      return false;
    }
  }

  public pause(): void {
    if (isTTSSupported() && this.state === 'playing') {
      window.speechSynthesis.pause();
      this.state = 'paused';
    }
  }

  public resume(): void {
    if (isTTSSupported() && this.state === 'paused') {
      window.speechSynthesis.resume();
      this.state = 'playing';
    }
  }

  public stop(): void {
    if (isTTSSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Synthesis might already be cancelled
      }
    }
    this.currentUtterance = null;
    this.state = 'stopped';
  }
}

export const defaultTTSPlaybackService = new TTSPlaybackService();
