import React, { useEffect, useRef, useState } from 'react';
import '../styles/InteractivePublicDemo.css';

export interface DemoScenario {
  id: string;
  tabLabel: string;
  role: string;
  modelName: string;
  gateway: string;
  complexityScore: number;
  reason: string;
  userPrompt: string;
  assistantStreamText: string;
  syntheticCost: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    finalUsd: number;
    pricingNote: string;
  };
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'architecture',
    tabLabel: '1. Architecture & Code',
    role: 'Strong (high reasoning)',
    modelName: 'DeepSeek V4 Pro',
    gateway: 'OpenCode gateway',
    complexityScore: 84,
    reason: 'Detected complex system design requirements with backpressure and durability contracts.',
    userPrompt: 'Design a high-throughput event processing architecture in TypeScript with backpressure handling.',
    assistantStreamText: `### Resilient Event Processor Architecture

Here is a high-throughput event queue design using bounded channels and asynchronous backpressure:

\`\`\`typescript
export interface QueueConfig {
  highWatermark: number;
  lowWatermark: number;
  batchSize: number;
}

export class BackpressureEventBuffer<T> {
  private queue: T[] = [];
  private paused = false;

  constructor(private config: QueueConfig) {}

  push(item: T): boolean {
    this.queue.push(item);
    if (this.queue.length >= this.config.highWatermark && !this.paused) {
      this.paused = true;
      // Signal upstream producer to pause emission
      return false;
    }
    return true;
  }

  drain(): T[] {
    const batch = this.queue.splice(0, this.config.batchSize);
    if (this.paused && this.queue.length <= this.config.lowWatermark) {
      this.paused = false;
      // Signal upstream producer to resume
    }
    return batch;
  }
}
\`\`\`

#### Key System Invariants
1. **Bounded Memory**: High-watermark prevents runaway heap consumption under bursty traffic.
2. **Explicit Hysteresis**: Low-watermark threshold prevents rapid resume/pause oscillations.
3. **Fail-Closed Ledger**: Critical events are written to durable storage before acknowledgment.`,
    syntheticCost: {
      inputTokens: 1240,
      outputTokens: 520,
      estimatedUsd: 0.00034,
      finalUsd: 0.00031,
      pricingNote: 'Calibrated OpenCode Tariff',
    },
  },
  {
    id: 'fast-explainer',
    tabLabel: '2. Fast Concept Path',
    role: 'Economy (fast path)',
    modelName: 'Gemini 3.8 Flash',
    gateway: 'OpenCode gateway',
    complexityScore: 24,
    reason: 'Classified as conceptual explanation without deep code generation or tool chaining.',
    userPrompt: 'Summarize the core difference between optimistic and pessimistic locking.',
    assistantStreamText: `### Optimistic vs. Pessimistic Locking

| Property | Optimistic Locking | Pessimistic Locking |
|---|---|---|
| **Strategy** | Validates records at commit time via version/timestamp check | Acquires row-level or table-level locks before mutation |
| **Best For** | Low contention workloads (reads vastly outnumber writes) | High contention workloads (concurrent conflicting updates frequent) |
| **Overhead** | Minimal lock overhead; requires conflict retry logic | High lock overhead; potential deadlock hazards |
| **Recovery** | Abort and retry application transaction | Block until lock released or timeout trips |

**Prismatix Recommendation:** Use optimistic concurrency with an incremental \`version\` column for user sessions and state transitions; reserve pessimistic \`SELECT ... FOR UPDATE\` for ledger credit balance admissions.`,
    syntheticCost: {
      inputTokens: 480,
      outputTokens: 290,
      estimatedUsd: 0.000045,
      finalUsd: 0.000041,
      pricingNote: 'Economy Tier Tariff',
    },
  },
  {
    id: 'debate-mode',
    tabLabel: '3. Multi-Model Debate',
    role: 'Debate Cross-Examination',
    modelName: 'Claude Sonnet 5.5 vs. GPT-6 Sol',
    gateway: 'Dual Provider Orchestration',
    complexityScore: 92,
    reason: 'Multi-draft debate mode enabled for controversial architectural tradeoff evaluation.',
    userPrompt: 'Debate: Single Monolith vs. Early Microservices for a 5-person startup.',
    assistantStreamText: `### Multi-Model Debate Transcript

#### Proposer (Claude Sonnet 5.5 — Pragmatic Monolith)
> *"For a 5-person team, network boundaries are premature friction. A modular monolith provides single-deployment velocity, unified database transactions, and zero distributed-tracing overhead while boundaries are still discovering product-market fit."*

#### Contrarian (GPT-6 Sol — Independent Deployability)
> *"While monoliths optimize for day-one velocity, unseparated schemas cause tight coupling that makes future database migrations exponentially more difficult. Clear API contracts from the beginning enforce team ownership and isolate memory-heavy background workers."*

#### Reconciled Synthesis
Start with a **single deployable binary with strict boundary modules** (e.g., domain folders with no direct cross-boundary database imports). Extract workers only when CPU/memory pressure dictates independent scaling.`,
    syntheticCost: {
      inputTokens: 2100,
      outputTokens: 760,
      estimatedUsd: 0.00185,
      finalUsd: 0.00178,
      pricingNote: 'Dual Frontier Tariff',
    },
  },
];

export interface InteractivePublicDemoProps {
  autoplay?: boolean;
}

export function InteractivePublicDemo({ autoplay = false }: InteractivePublicDemoProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState('architecture');
  const scenario = DEMO_SCENARIOS.find((s) => s.id === selectedScenarioId) ?? DEMO_SCENARIOS[0]!;
  const [displayedText, setDisplayedText] = useState(autoplay ? '' : scenario.assistantStreamText);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCompleted, setIsCompleted] = useState(!autoplay);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startStreaming = (textToStream: string) => {
    clearTimer();
    setDisplayedText('');
    setIsPlaying(true);
    setIsCompleted(false);

    let charIndex = 0;
    const chunkSize = 4; // realistic SSE delta token chunks
    const intervalMs = 24;

    timerRef.current = setInterval(() => {
      if (typeof window === 'undefined') {
        clearTimer();
        return;
      }
      charIndex += chunkSize;
      if (charIndex >= textToStream.length) {
        setDisplayedText(textToStream);
        setIsPlaying(false);
        setIsCompleted(true);
        clearTimer();
      } else {
        setDisplayedText(textToStream.slice(0, charIndex));
      }
    }, intervalMs);
  };

  const handleSelectScenario = (id: string) => {
    clearTimer();
    setSelectedScenarioId(id);
    const target = DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0]!;
    if (autoplay) {
      startStreaming(target.assistantStreamText);
    } else {
      setDisplayedText(target.assistantStreamText);
      setIsPlaying(false);
      setIsCompleted(true);
    }
  };

  const handleSkip = () => {
    clearTimer();
    setDisplayedText(scenario.assistantStreamText);
    setIsPlaying(false);
    setIsCompleted(true);
  };

  const handlePauseResume = () => {
    if (isPlaying) {
      clearTimer();
      setIsPlaying(false);
    } else {
      if (isCompleted || !displayedText) {
        startStreaming(scenario.assistantStreamText);
      } else {
        // Resume from current text length
        let charIndex = displayedText.length;
        const chunkSize = 4;
        const full = scenario.assistantStreamText;
        setIsPlaying(true);
        timerRef.current = setInterval(() => {
          if (typeof window === 'undefined') {
            clearTimer();
            return;
          }
          charIndex += chunkSize;
          if (charIndex >= full.length) {
            setDisplayedText(full);
            setIsPlaying(false);
            setIsCompleted(true);
            clearTimer();
          } else {
            setDisplayedText(full.slice(0, charIndex));
          }
        }, 24);
      }
    }
  };

  const handleReset = () => {
    clearTimer();
    setDisplayedText('');
    setIsPlaying(false);
    setIsCompleted(false);
  };

  useEffect(() => {
    if (autoplay) {
      startStreaming(scenario.assistantStreamText);
    }
    return () => clearTimer();
  }, [autoplay]);

  return (
    <section className="interactive-demo-card" aria-label="Interactive Prismatix Demo">
      <div className="demo-header">
        <div className="demo-title-group">
          <span className="demo-badge-synthetic">Prerecorded Interactive Preview · Synthetic Data</span>
          <h2 className="demo-title">Experience Adaptive Routing Live</h2>
          <p className="demo-subtitle">
            See how Prismatix evaluates prompt complexity, selects the optimal model, and provides transparent cost receipts without incurring real API charges.
          </p>
        </div>

        <div className="demo-tabs" role="tablist" aria-label="Demo scenarios">
          {DEMO_SCENARIOS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === selectedScenarioId}
              className={`demo-tab ${item.id === selectedScenarioId ? 'active' : ''}`}
              onClick={() => handleSelectScenario(item.id)}
            >
              {item.tabLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-workspace">
        {/* Router Explanation Bar */}
        <div className="demo-router-panel" aria-label="Route Decision Facts">
          <div className="demo-route-pill">
            <span className="route-indicator-dot" aria-hidden="true" />
            <span className="route-model-name">{scenario.modelName}</span>
            <span className="route-role-tag">{scenario.role}</span>
          </div>

          <div className="demo-route-meta">
            <span className="meta-item">
              <strong>Gateway:</strong> {scenario.gateway}
            </span>
            <span className="meta-item">
              <strong>Complexity Score:</strong> {scenario.complexityScore}/100
            </span>
          </div>
          <p className="demo-route-reason">
            <strong>Routing Reason:</strong> {scenario.reason}
          </p>
        </div>

        {/* Chat Transcript Container */}
        <div className="demo-chat-transcript" aria-live="polite">
          {/* User Turn */}
          <div className="demo-message user">
            <div className="demo-message-sender">User Prompt</div>
            <div className="demo-message-content">{scenario.userPrompt}</div>
          </div>

          {/* Assistant Turn */}
          <div className="demo-message assistant">
            <div className="demo-message-sender">
              <span>{scenario.modelName}</span>
              <span className="synthetic-cost-pill">
                ${scenario.syntheticCost.finalUsd.toFixed(5)} synthetic
              </span>
            </div>

            <div className="demo-message-content demo-formatted-output">
              <pre className="demo-stream-pre">{displayedText || '(Click play to stream response...)'}</pre>
              {isPlaying && <span className="demo-cursor" aria-hidden="true">▍</span>}
            </div>

            {/* Performance & Cost Breakdown */}
            <div className="demo-cost-breakdown">
              <div className="breakdown-item">
                <span className="lbl">Prompt Tokens:</span>
                <span className="val">{scenario.syntheticCost.inputTokens.toLocaleString()}</span>
              </div>
              <div className="breakdown-item">
                <span className="lbl">Output Tokens:</span>
                <span className="val">{scenario.syntheticCost.outputTokens.toLocaleString()}</span>
              </div>
              <div className="breakdown-item">
                <span className="lbl">Synthetic Cost:</span>
                <span className="val highlight">${scenario.syntheticCost.finalUsd.toFixed(5)}</span>
              </div>
              <div className="breakdown-item">
                <span className="lbl">Basis:</span>
                <span className="val">{scenario.syntheticCost.pricingNote}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="demo-controls" aria-label="Demo playback controls">
          <button
            type="button"
            className="demo-control-btn primary"
            onClick={handlePauseResume}
            aria-label={isPlaying ? 'Pause streaming' : isCompleted ? 'Replay scenario' : 'Play streaming'}
          >
            {isPlaying ? '⏸ Pause' : isCompleted ? '🔄 Replay' : '▶ Play'}
          </button>
          <button
            type="button"
            className="demo-control-btn"
            onClick={handleSkip}
            disabled={isCompleted}
            aria-label="Skip animation and display full response"
          >
            ⏩ Show Full Response
          </button>
          <button
            type="button"
            className="demo-control-btn"
            onClick={handleReset}
            aria-label="Reset demo state"
          >
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
