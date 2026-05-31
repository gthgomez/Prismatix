import '../styles/ResumeDemo.css';

const featureBullets = [
  'Routes chat requests across Anthropic, OpenAI, Google Gemini, NVIDIA, and DeepInfra providers.',
  'Normalizes provider streaming into one SSE client path with model and provider metadata.',
  'Keeps provider API keys in Supabase Edge Function secrets instead of the browser bundle.',
  'Persists conversations, messages, spend logs, and user memory behind Supabase Auth and RLS-backed tables.',
  'Adds spend and rate-control guards before provider calls to limit runaway usage.',
  'Includes optional debate and structured multi-draft paths for higher-effort prompts.',
];

const architecturePoints = [
  'React/Vite client handles chat UX, model selection, attachments, and streaming presentation.',
  'Supabase Auth issues the user session consumed by the router client for authenticated app requests.',
  'Deno Edge Functions own provider selection, payload shaping, SSE normalization, persistence, and budget checks.',
  'Postgres tables store user-scoped conversation state, message history, cost logs, and memory summaries.',
];

const proofPoints = [
  'Shared pricing and cost logic is covered by unit tests in the TypeScript client code.',
  'Router stream handling is isolated in a reusable hook so provider event formats stay out of UI components.',
  'Provider-specific payload builders and SSE normalization live server-side under the router function modules.',
  'The public page intentionally describes verified architecture rather than claiming production certification.',
];

export function ResumeDemo() {
  return (
    <main className="resume-demo-shell">
      <nav className="resume-demo-nav" aria-label="Prismatix public navigation">
        <a className="resume-demo-brand" href="/">
          Prismatix
        </a>
        <div className="resume-demo-nav-links">
          <a href="https://github.com/gthgomez/Prismatix">GitHub</a>
          <a href="/">Live app</a>
        </div>
      </nav>

      <section className="resume-demo-hero" aria-labelledby="resume-demo-title">
        <p className="resume-demo-kicker">Recruiter demo surface</p>
        <h1 id="resume-demo-title">Supabase-backed multi-provider AI router prototype</h1>
        <p className="resume-demo-summary">
          Prismatix is a TypeScript and Supabase application that routes chat requests across multiple AI
          providers, streams normalized responses to the client, and keeps persistence, provider secrets,
          and usage controls on the server side.
        </p>
        <div className="resume-demo-actions" aria-label="Project links">
          <a className="resume-demo-button resume-demo-button-primary" href="/">
            Open live app
          </a>
          <a className="resume-demo-button" href="https://github.com/gthgomez/Prismatix">
            View source
          </a>
        </div>
      </section>

      <section className="resume-demo-grid" aria-label="Prismatix highlights">
        <article className="resume-demo-panel">
          <h2>Feature Slice</h2>
          <ul>
            {featureBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="resume-demo-panel">
          <h2>Architecture</h2>
          <ul>
            {architecturePoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="resume-demo-panel">
          <h2>Proof Points</h2>
          <ul>
            {proofPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="resume-demo-panel resume-demo-safety">
          <h2>Demo Safety</h2>
          <p>
            This page is public and informational only. The chat application remains behind the existing
            Supabase authentication flow. Public copy avoids production-readiness claims and does not assert
            unverified deployment, RLS/storage isolation, or JWT coverage beyond the architecture visible in
            this repository.
          </p>
        </article>
      </section>
    </main>
  );
}
