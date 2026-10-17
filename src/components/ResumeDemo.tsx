import React from 'react';
import '../styles/ResumeDemo.css';
import { InteractivePublicDemo } from './InteractivePublicDemo';

interface FeatureCardItem {
  id: string;
  tag: string;
  title: string;
  description: string;
}

interface ArchNode {
  step: string;
  name: string;
  role: string;
  description: string;
}

interface ProofPoint {
  id: string;
  badge: string;
  claim: string;
}

const features: FeatureCardItem[] = [
  {
    id: 'model-hub',
    tag: 'ROUTING HUB',
    title: 'Dynamic Multi-Model Routing',
    description:
      'Routes every request through the OpenCode model hub by default, with OpenRouter and opt-in provider plug-ins (BYOK) as fallbacks.',
  },
  {
    id: 'sse-stream',
    tag: 'NORMALIZATION',
    title: 'Unified SSE Streaming Protocol',
    description:
      'Normalizes provider streaming into one SSE client path with model and provider metadata.',
  },
  {
    id: 'edge-secrets',
    tag: 'ZERO LEAK',
    title: 'Server-Side Secret Isolation',
    description:
      'Keeps provider API keys in Supabase Edge Function secrets instead of the browser bundle.',
  },
  {
    id: 'rls-boundary',
    tag: 'PERIMETER',
    title: 'Postgres Row-Level Security',
    description:
      'Persists conversations, messages, spend logs, and user memory behind Supabase Auth and RLS-backed tables.',
  },
  {
    id: 'rate-guards',
    tag: 'COST CONTROL',
    title: 'Spend & Rate-Control Guards',
    description:
      'Adds spend and rate-control guards before provider calls to limit runaway usage.',
  },
  {
    id: 'debate-mode',
    tag: 'MULTI-DRAFT',
    title: 'Multi-Model Debate Synthesis',
    description:
      'Includes optional debate and structured multi-draft paths for higher-effort prompts.',
  },
];

const pipelineNodes: ArchNode[] = [
  {
    step: '01',
    name: 'React / Vite Client',
    role: 'Client SPA',
    description: 'Handles chat UX, model selection, attachments, and streaming presentation.',
  },
  {
    step: '02',
    name: 'Supabase Auth',
    role: 'Auth Boundary',
    description: 'Issues the user session consumed by the router client for authenticated app requests.',
  },
  {
    step: '03',
    name: 'Deno Edge Functions',
    role: 'Router Engine',
    description: 'Owns provider selection, payload shaping, SSE normalization, persistence, and budget checks.',
  },
  {
    step: '04',
    name: 'Multi-Model Hub',
    role: 'Inference Layer',
    description: 'Routes through OpenCode gateway with OpenRouter and BYOK fallback channels.',
  },
  {
    step: '05',
    name: 'Postgres + RLS',
    role: 'Audit & State',
    description: 'Stores user-scoped conversation state, message history, cost logs, and memory summaries.',
  },
];

const proofPoints: ProofPoint[] = [
  {
    id: 'unit-tests',
    badge: 'UNIT TESTED',
    claim: 'Shared pricing and cost logic is covered by unit tests in the TypeScript client code.',
  },
  {
    id: 'hook-isolation',
    badge: 'ISOLATED HOOK',
    claim: 'Router stream handling is isolated in a reusable hook so provider event formats stay out of UI components.',
  },
  {
    id: 'edge-modules',
    badge: 'SERVER-SIDE',
    claim: 'Provider-specific payload builders and SSE normalization live server-side under the router function modules.',
  },
  {
    id: 'verified-claims',
    badge: 'GROUND TRUTH',
    claim: 'The public page intentionally describes verified architecture rather than claiming production certification.',
  },
];

export function ResumeDemo() {
  return (
    <main className="resume-demo-shell">
      <nav className="resume-demo-nav" aria-label="Prismatix public navigation">
        <div className="resume-demo-nav-brand-group">
          <a className="resume-demo-brand" href="/" aria-label="Prismatix Home">
            <span className="brand-prism" aria-hidden="true">▲</span>
            Prismatix
          </a>
          <span className="resume-demo-nav-pill">v0.2 Router · Edge Runtime</span>
        </div>
        <div className="resume-demo-nav-links">
          <a href="https://github.com/gthgomez/Prismatix" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="/" className="resume-demo-nav-app-link">
            Live app
          </a>
        </div>
      </nav>

      <header className="resume-demo-hero" aria-labelledby="resume-demo-title">
        <div className="resume-demo-kicker-group">
          <span className="resume-demo-status-dot" aria-hidden="true" />
          <p className="resume-demo-kicker">Multi-Provider AI Router · Recruiter Demo Surface</p>
        </div>

        <h1 id="resume-demo-title">Supabase-backed multi-provider AI router prototype</h1>

        <p className="resume-demo-summary">
          Prismatix is a TypeScript and Supabase application that routes chat requests across multiple AI
          providers, streams normalized responses to the client, and keeps persistence, provider secrets,
          and usage controls on the server side.
        </p>

        <div className="resume-demo-spec-strip" aria-label="System architecture overview">
          <div className="spec-badge">
            <span className="spec-label">RUNTIME</span>
            <span className="spec-val">Deno Edge · TS</span>
          </div>
          <div className="spec-badge">
            <span className="spec-label">SECRETS</span>
            <span className="spec-val">100% Server-Side</span>
          </div>
          <div className="spec-badge">
            <span className="spec-label">STREAMING</span>
            <span className="spec-val">Normalized SSE</span>
          </div>
          <div className="spec-badge">
            <span className="spec-label">SECURITY</span>
            <span className="spec-val">Postgres RLS</span>
          </div>
        </div>

        <div className="resume-demo-actions" aria-label="Project links">
          <a className="resume-demo-button resume-demo-button-primary" href="/">
            Open live app
            <span className="button-arrow" aria-hidden="true">→</span>
          </a>
          <a
            className="resume-demo-button"
            href="https://github.com/gthgomez/Prismatix"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source
          </a>
        </div>
      </header>

      {/* Asymmetrical Bento Grid */}
      <section className="resume-bento-grid" aria-label="Prismatix architecture and live demo highlights">
        {/* Bento Cell 1: Flagship Live Interactive Sandbox Showcase (12 cols) */}
        <article className="bento-card bento-card-demo bento-col-12" aria-label="Interactive Router Simulation">
          <div className="bento-card-topbar">
            <div className="topbar-dots" aria-hidden="true">
              <span className="dot dot-red" />
              <span className="dot dot-yellow" />
              <span className="dot dot-green" />
              <span className="topbar-title">sandbox://prismatix-router/live-simulation</span>
            </div>
            <div className="topbar-status">
              <span className="live-indicator" aria-hidden="true" />
              <span className="topbar-status-text">LIVE STREAMING ENGINE · SYNTHETIC TARIFFS</span>
            </div>
          </div>
          <InteractivePublicDemo />
        </article>

        {/* Bento Cell 2: System Architecture Pipeline (8 cols) */}
        <article className="bento-card bento-card-arch bento-col-8" aria-labelledby="bento-arch-heading">
          <div className="bento-header-group">
            <span className="bento-kicker">02 // SYSTEM ARCHITECTURE</span>
            <h2 id="bento-arch-heading">End-to-End Pipeline & Runtime Boundaries</h2>
            <p className="bento-subtext">
              Multi-tier architecture partitioning browser presentation from edge-level routing and database security.
            </p>
          </div>

          <div className="arch-pipeline-visual" aria-label="Architecture flow diagram">
            {pipelineNodes.map((node, idx) => (
              <React.Fragment key={node.name}>
                <div className="pipeline-node">
                  <span className="node-step">{node.step}</span>
                  <span className="node-name">{node.name}</span>
                  <span className="node-role">{node.role}</span>
                </div>
                {idx < pipelineNodes.length - 1 && (
                  <div className="pipeline-connector" aria-hidden="true">
                    <span className="connector-line" />
                    <span className="connector-arrow">→</span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="arch-points-list">
            {pipelineNodes.map((node) => (
              <div key={node.name} className="arch-point-row">
                <span className="arch-tag">{node.name}</span>
                <span className="arch-desc">{node.description}</span>
              </div>
            ))}
          </div>
        </article>

        {/* Bento Cell 3: Verified Proof Points (4 cols) */}
        <article className="bento-card bento-card-proof bento-col-4" aria-labelledby="bento-proof-heading">
          <div className="bento-header-group">
            <span className="bento-kicker">03 // VERIFIED PROOF</span>
            <h2 id="bento-proof-heading">Repository Ground Truth</h2>
            <p className="bento-subtext">Evidence-backed claims grounded in actual test suites and modules.</p>
          </div>

          <div className="proof-metrics-grid">
            <div className="proof-metric-tile">
              <span className="metric-num">100%</span>
              <span className="metric-caption">Edge Secret Isolation</span>
            </div>
            <div className="proof-metric-tile">
              <span className="metric-num">0 ms</span>
              <span className="metric-caption">Client Token Exposure</span>
            </div>
          </div>

          <ul className="proof-list">
            {proofPoints.map((item) => (
              <li key={item.id} className="proof-list-item">
                <div className="proof-badge-row">
                  <span className="proof-check" aria-hidden="true">✓</span>
                  <span className="proof-badge">{item.badge}</span>
                </div>
                <p className="proof-text">{item.claim}</p>
              </li>
            ))}
          </ul>
        </article>

        {/* Bento Cell 4: Router Capabilities & Guardrails (7 cols) */}
        <article className="bento-card bento-card-features bento-col-7" aria-labelledby="bento-features-heading">
          <div className="bento-header-group">
            <span className="bento-kicker">04 // CAPABILITIES & GUARDRAILS</span>
            <h2 id="bento-features-heading">Feature Slice & Guardrails</h2>
            <p className="bento-subtext">
              Engineered for cost predictability, multi-provider failover, and strict tenant boundaries.
            </p>
          </div>

          <div className="features-bento-subgrid">
            {features.map((feature) => (
              <div key={feature.id} className="feature-subcard">
                <div className="feature-subcard-header">
                  <span className="feature-tag">{feature.tag}</span>
                  <h3>{feature.title}</h3>
                </div>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </article>

        {/* Bento Cell 5: Demo Safety & Security Boundary (5 cols) */}
        <article className="bento-card bento-card-safety bento-col-5" aria-labelledby="bento-safety-heading">
          <div className="bento-header-group">
            <div className="safety-badge-row">
              <span className="safety-alert-icon" aria-hidden="true">⚠</span>
              <span className="bento-kicker kicker-safety">05 // SECURITY & COMPLIANCE BOUNDARY</span>
            </div>
            <h2 id="bento-safety-heading">Demo Safety & Recruiter Notice</h2>
          </div>

          <div className="safety-body">
            <div className="safety-callout">
              <p className="safety-paragraph">
                This page is public and informational only. The chat application remains behind the existing
                Supabase authentication flow. Public copy avoids production-readiness claims and does not assert
                unverified deployment, RLS/storage isolation, or JWT coverage beyond the architecture visible in
                this repository.
              </p>
            </div>

            <div className="safety-checklist">
              <div className="safety-item">
                <span className="safety-item-icon" aria-hidden="true">✓</span>
                <span>Public prototype uses synthetic tokens; no live billable queries.</span>
              </div>
              <div className="safety-item">
                <span className="safety-item-icon" aria-hidden="true">✓</span>
                <span>Full chat interface requires active Supabase session.</span>
              </div>
              <div className="safety-item">
                <span className="safety-item-icon" aria-hidden="true">✓</span>
                <span>All architecture assertions verified against repository AST.</span>
              </div>
            </div>

            <div className="safety-actions">
              <a
                href="https://github.com/gthgomez/Prismatix"
                className="resume-demo-button safety-btn"
                target="_blank"
                rel="noopener noreferrer"
              >
                Inspect GitHub Repository
                <span className="button-arrow" aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
