// src/services/voiceDictationService.ts
// Voice dictation service supporting Web Speech API and BYOK transcription.

export type DictationState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';

export interface VoiceDictationOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (errorMsg: string) => void;
  onStateChange: (state: DictationState) => void;
  language?: string;
}

export interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function isAudioCaptureSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
  return typeof navigator.mediaDevices.getUserMedia === 'function';
}

export class VoiceDictationService {
  private recognition: ISpeechRecognition | null = null;
  private state: DictationState = 'idle';
  private mediaStream: MediaStream | null = null;
  private options: VoiceDictationOptions | null = null;
  private customRecognitionFactory?: () => ISpeechRecognition;

  constructor(customFactory?: () => ISpeechRecognition) {
    this.customRecognitionFactory = customFactory;
  }

  public getState(): DictationState {
    return this.state;
  }

  private setState(newState: DictationState) {
    this.state = newState;
    this.options?.onStateChange(newState);
  }

  public async startDictation(options: VoiceDictationOptions): Promise<boolean> {
    this.options = options;

    if (!this.customRecognitionFactory && !isSpeechRecognitionSupported()) {
      this.setState('error');
      options.onError('Speech recognition is not supported in this browser. Please type your message.');
      return false;
    }

    try {
      this.setState('requesting');

      // Explicit microphone permission check if mediaDevices is available
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (permErr) {
          const errMsg = permErr instanceof Error ? permErr.message : 'Microphone permission denied';
          this.setState('error');
          options.onError(`Microphone access denied: ${errMsg}`);
          return false;
        }
      }

      // Initialize recognition
      if (this.customRecognitionFactory) {
        this.recognition = this.customRecognitionFactory();
      } else {
        const SpeechRec = (window as unknown as { SpeechRecognition?: new () => ISpeechRecognition; webkitSpeechRecognition?: new () => ISpeechRecognition }).SpeechRecognition ||
                          (window as unknown as { webkitSpeechRecognition?: new () => ISpeechRecognition }).webkitSpeechRecognition;
        if (!SpeechRec) {
          throw new Error('SpeechRecognition constructor not available');
        }
        this.recognition = new SpeechRec();
      }

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = options.language || 'en-US';

      this.recognition.onstart = () => {
        this.setState('recording');
      };

      this.recognition.onresult = (event: unknown) => {
        const speechEvent = event as {
          resultIndex?: number;
          results?: {
            length: number;
            [index: number]: {
              isFinal: boolean;
              [subIndex: number]: { transcript: string };
            };
          };
        };

        if (!speechEvent.results) return;

        let interimTranscript = '';
        let finalTranscript = '';

        const startIndex = speechEvent.resultIndex ?? 0;
        for (let i = startIndex; i < speechEvent.results.length; i++) {
          const res = speechEvent.results[i];
          if (!res || !res[0]) continue;
          if (res.isFinal) {
            finalTranscript += res[0].transcript;
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        const combined = finalTranscript || interimTranscript;
        if (combined.trim()) {
          this.options?.onTranscript(combined, Boolean(finalTranscript));
        }
      };

      this.recognition.onerror = (event: unknown) => {
        const errEvent = event as { error?: string };
        const code = errEvent.error || 'speech_recognition_error';
        this.setState('error');
        this.options?.onError(`Dictation error: ${code}`);
        this.cleanup();
      };

      this.recognition.onend = () => {
        if (this.state === 'recording') {
          this.setState('idle');
        }
        this.cleanup();
      };

      this.recognition.start();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice dictation';
      this.setState('error');
      options.onError(msg);
      this.cleanup();
      return false;
    }
  }

  public stopDictation(): void {
    if (this.recognition && (this.state === 'recording' || this.state === 'requesting')) {
      try {
        this.recognition.stop();
      } catch {
        // Recognition might already have stopped
      }
    }
    this.cleanup();
    this.setState('idle');
  }

  public cancelDictation(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Recognition might already have aborted
      }
    }
    this.cleanup();
    this.setState('idle');
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}

export const defaultVoiceDictationService = new VoiceDictationService();
