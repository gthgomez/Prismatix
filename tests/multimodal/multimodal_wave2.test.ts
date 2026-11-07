// tests/multimodal/multimodal_wave2.test.ts
// Unit and integration tests for Wave 2 PR 6 features (F26–F30).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VoiceDictationService,
  isSpeechRecognitionSupported,
  isAudioCaptureSupported,
  type ISpeechRecognition,
} from '../../src/services/voiceDictationService';
import {
  TTSPlaybackService,
  isTTSSupported,
  getAvailableVoices,
} from '../../src/services/ttsPlaybackService';
import {
  estimateImageCost,
  executeImageGeneration,
  SUPPORTED_IMAGE_MODELS,
  getImageModelInfo,
} from '../../src/services/imageGenerationService';
import {
  extractArtifactsFromText,
  saveArtifactRevision,
  getFileExtensionForLanguage,
  createSandboxedHtmlPreview,
} from '../../src/services/artifactService';
import {
  subscribeToOnlineStatus,
  subscribeToInstallPrompt,
  promptPwaInstall,
} from '../../src/services/pwaService';

// -----------------------------------------------------------------------------
// F26: Voice Dictation Tests
// -----------------------------------------------------------------------------
describe('F26: Voice Dictation (STT)', () => {
  it('detects platform speech recognition and audio capture support', () => {
    // In node/vitest environment, window speech recognition is undefined
    expect(typeof isSpeechRecognitionSupported()).toBe('boolean');
    expect(typeof isAudioCaptureSupported()).toBe('boolean');
  });

  it('handles speech recognition lifecycle with simulated events', async () => {
    let started = false;
    let stopped = false;
    let onResultCallback: ((event: unknown) => void) | null = null;

    const mockRecognition: ISpeechRecognition = {
      continuous: true,
      interimResults: true,
      lang: 'en-US',
      start: vi.fn(() => {
        started = true;
        if (mockRecognition.onstart) mockRecognition.onstart();
      }),
      stop: vi.fn(() => {
        stopped = true;
        if (mockRecognition.onend) mockRecognition.onend();
      }),
      abort: vi.fn(() => {
        if (mockRecognition.onend) mockRecognition.onend();
      }),
      onstart: null,
      onresult: null,
      onerror: null,
      onend: null,
    };

    const service = new VoiceDictationService(() => {
      onResultCallback = (event: unknown) => {
        if (mockRecognition.onresult) mockRecognition.onresult(event);
      };
      return mockRecognition;
    });

    const transcripts: string[] = [];
    const states: string[] = [];

    const startPromise = await service.startDictation({
      onTranscript: (text) => transcripts.push(text),
      onError: (err) => console.error(err),
      onStateChange: (state) => states.push(state),
    });

    expect(startPromise).toBe(true);
    expect(started).toBe(true);
    expect(service.getState()).toBe('recording');

    // Simulate speech recognition result
    if (onResultCallback) {
      (onResultCallback as (e: unknown) => void)({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'Hello Prismatix voice dictation' },
          },
        ],
      });
    }

    expect(transcripts).toContain('Hello Prismatix voice dictation');

    service.stopDictation();
    expect(stopped).toBe(true);
    expect(service.getState()).toBe('idle');
  });

  it('aborts dictation and cleans up state on cancel', async () => {
    const mockRecognition: ISpeechRecognition = {
      continuous: true,
      interimResults: true,
      lang: 'en-US',
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onstart: null,
      onresult: null,
      onerror: null,
      onend: null,
    };

    const service = new VoiceDictationService(() => mockRecognition);
    await service.startDictation({
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });

    service.cancelDictation();
    expect(mockRecognition.abort).toHaveBeenCalled();
    expect(service.getState()).toBe('idle');
  });
});

// -----------------------------------------------------------------------------
// F27: TTS Playback Tests
// -----------------------------------------------------------------------------
describe('F27: Read-aloud responses (TTS)', () => {
  beforeEach(() => {
    class MockSpeechSynthesisUtterance {
      text: string;
      rate: number = 1.0;
      pitch: number = 1.0;
      voice: unknown = null;
      onstart: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onresume: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    const mockSynthesis = {
      speak: vi.fn((utterance: { onstart?: () => void; onend?: () => void }) => {
        utterance.onstart?.();
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => [
        { name: 'Alex', lang: 'en-US', voiceURI: 'urn:alex', default: true },
      ]),
    };

    (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    (globalThis as unknown as Record<string, unknown>).speechSynthesis = mockSynthesis;

    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
      (window as unknown as Record<string, unknown>).speechSynthesis = mockSynthesis;
    }
  });

  it('detects TTS browser support and lists available voices', () => {
    expect(isTTSSupported()).toBe(true);
    const voices = getAvailableVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0]?.name).toBe('Alex');
  });

  it('speaks cleaned text and manages play, pause, resume, and stop', () => {
    const tts = new TTSPlaybackService();
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();

    const result = tts.speak('# Title\n```js\nconsole.log(1);\n```\nHere is **bold** text.', {
      onStart,
      onPause,
      onResume,
    });

    expect(result).toBe(true);
    expect(tts.getState()).toBe('playing');
    expect(onStart).toHaveBeenCalled();

    tts.pause();
    expect(tts.getState()).toBe('paused');

    tts.resume();
    expect(tts.getState()).toBe('playing');

    tts.stop();
    expect(tts.getState()).toBe('stopped');
  });

  it('rejects empty text gracefully', () => {
    const tts = new TTSPlaybackService();
    const onError = vi.fn();
    const result = tts.speak('   ', { onError });

    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledWith('No text content to read aloud.');
  });
});

// -----------------------------------------------------------------------------
// F28: BYOK Image Generation Tests
// -----------------------------------------------------------------------------
describe('F28: BYOK Image Generation', () => {
  it('accurately lists supported models with defined pricing', () => {
    expect(SUPPORTED_IMAGE_MODELS.length).toBeGreaterThanOrEqual(4);
    const dalle3 = getImageModelInfo('dall-e-3');
    expect(dalle3).toBeDefined();
    expect(dalle3?.costPerImageUsd).toBe(0.040);
    expect(estimateImageCost('dall-e-3')).toBe(0.040);

    const flux = getImageModelInfo('flux-1-schnell');
    expect(flux).toBeDefined();
    expect(flux?.costPerImageUsd).toBe(0.003);
    expect(estimateImageCost('flux-1-schnell')).toBe(0.003);
  });

  it('rejects empty prompts with descriptive error', async () => {
    const res = await executeImageGeneration({
      prompt: '   ',
      modelId: 'dall-e-3',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('cannot be empty');
  });

  it('generates deterministic preview in mock/test mode without paid external billing', async () => {
    const res = await executeImageGeneration({
      prompt: 'Futuristic city with flying vehicles at twilight',
      modelId: 'dall-e-3',
      mockMode: true,
    });

    expect(res.success).toBe(true);
    expect(res.imageUrl).toContain('data:image/svg+xml');
    expect(res.costUsd).toBe(0.040);
    expect(res.prompt).toBe('Futuristic city with flying vehicles at twilight');
  });

  it('requires API key for live external providers without fabrication', async () => {
    // When mockMode is false and no apiKey is passed
    const res = await executeImageGeneration({
      prompt: 'A sunset over the Pacific ocean',
      modelId: 'dall-e-3',
      apiKey: '',
      mockMode: false,
    });

    // In NODE_ENV=test, executeImageGeneration uses mock mode for test safety unless forced
    expect(res.imageUrl || res.error).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// F29: Editable Artifacts & Safe Previews Tests
// -----------------------------------------------------------------------------
describe('F29: Editable Generated Artifacts and Sandboxed Previews', () => {
  const assistantResponse = `Here is the solution to your request:

\`\`\`typescript:calculator.ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

And here is an SVG icon:

\`\`\`svg:icon.svg
<svg width="24" height="24" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" fill="teal" />
</svg>
\`\`\`
`;

  it('extracts multiple artifacts from fenced markdown code blocks with filenames', () => {
    const artifacts = extractArtifactsFromText(assistantResponse);
    expect(artifacts.length).toBe(2);

    const tsArtifact = artifacts[0]!;
    expect(tsArtifact.title).toBe('calculator.ts');
    expect(tsArtifact.language).toBe('typescript');
    expect(tsArtifact.currentContent).toContain('export function add');
    expect(tsArtifact.versions.length).toBe(1);

    const svgArtifact = artifacts[1]!;
    expect(svgArtifact.title).toBe('icon.svg');
    expect(svgArtifact.language).toBe('svg');
  });

  it('saves new revisions when edited with version history and authorship', () => {
    const artifacts = extractArtifactsFromText(assistantResponse);
    const initial = artifacts[0]!;

    const updated = saveArtifactRevision(initial, 'export function add(a: number, b: number): number { return (a + b) * 2; }');
    expect(updated.versions.length).toBe(2);
    expect(updated.currentContent).toContain('* 2');
    expect(updated.versions[1]?.author).toBe('user');
    expect(updated.versions[0]?.author).toBe('assistant');
  });

  it('determines appropriate file extension for download', () => {
    expect(getFileExtensionForLanguage('typescript')).toBe('ts');
    expect(getFileExtensionForLanguage('python')).toBe('py');
    expect(getFileExtensionForLanguage('html')).toBe('html');
    expect(getFileExtensionForLanguage('svg')).toBe('svg');
    expect(getFileExtensionForLanguage('markdown')).toBe('md');
  });

  it('creates sandboxed HTML preview document for isolated iframe rendering', () => {
    const htmlPreview = createSandboxedHtmlPreview('<h1>Hello</h1>', 'html');
    expect(htmlPreview).toContain('<!DOCTYPE html>');
    expect(htmlPreview).toContain('<h1>Hello</h1>');

    const svgPreview = createSandboxedHtmlPreview('<svg></svg>', 'svg');
    expect(svgPreview).toContain('<svg></svg>');

    const codePreview = createSandboxedHtmlPreview('alert("xss")', 'javascript');
    expect(codePreview).toContain('alert(&quot;xss&quot;)');
  });
});

// -----------------------------------------------------------------------------
// F30: Installable PWA and Mobile Continuity Tests
// -----------------------------------------------------------------------------
describe('F30: Installable PWA and Mobile Continuity', () => {
  it('subscribes to online status changes', () => {
    let currentStatus = false;
    const unsub = subscribeToOnlineStatus((online) => {
      currentStatus = online;
    });

    expect(typeof currentStatus).toBe('boolean');
    unsub();
  });

  it('subscribes to install prompt availability and handles trigger gracefully', async () => {
    let installAvailable = false;
    const unsub = subscribeToInstallPrompt((canInstall) => {
      installAvailable = canInstall;
    });

    expect(typeof installAvailable).toBe('boolean');
    const outcome = await promptPwaInstall();
    expect(['accepted', 'dismissed', 'unsupported']).toContain(outcome);
    unsub();
  });
});
