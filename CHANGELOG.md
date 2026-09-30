# Changelog

All notable changes to Prismatix are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed
- **Explicit version reset (migration note).** The `2.0.0` version that has
  appeared in `package.json` since the initial public commit is a historical
  internal application marker, not a published release: no stable `2.0.0`
  artifact was ever published to npm (the package is a private application,
  now marked `"private": true` to make that explicit), and the only release
  tag in this repository is the `v0.1.0` prerelease. That tag is retained
  unchanged and history has not been retagged. Application/package/release
  metadata now adopts the next unpublished prerelease line, `0.2.0-pre.1`,
  which will be the basis for the next tagged release. Consumers of release
  metadata should expect version numbers to move from `2.0.0` to the
  `0.2.x-pre` line; no runtime interface changes accompany this reset.
- Added `engines` (`node ^20.19.0 || >=22.12.0`, `npm >=10`) matching the
  actual Vite 7 dependency floor, and an `.nvmrc` pinning Node 22.12.0 for
  local development. The previous README claim of a plain `node >=20` floor
  was incorrect for Node 20.0–20.18.

### Added
- Explainable route contract: every Auto-routed decision now carries a UI-safe
  `RouteExplanation` (selection, role, model, gateway, reason, fallback status,
  attempted candidates, price-known flag), exposed via the `X-Route-Decision`
  response header and rendered in the message info popover
- Fail-closed cost-safety gate (`evaluateAutoSendSafety`): unknown model
  pricing blocks the request with a deterministic `unknown_model_pricing`
  (409) error before dispatch; free-tier models are rejected for Auto but
  remain available as explicit manual picks
- Frontend `routeInfo` on assistant messages with a "why Auto picked this"
  popover section (role, reason, gateway, fallback status, cost basis)
- Pricing freshness audit in CI (`tests/routing/pricing_freshness.test.ts`):
  auto-routable OpenCode rates older than 60 days fail the build; stale legacy
  provider rates are surfaced as a visible warning; frontend/backend pricing
  divergence is guarded by test; `npm run audit:models` inventories stale model
  coupling

### Changed
- Auto routing now fails closed when OpenCode is primary and curated role
  resolution fails (discovery unavailable, empty, or no priced candidate):
  the request returns `auto_route_unavailable` (409) instead of silently
  re-routing to a legacy direct provider (previously a `max` role could land
  on direct Anthropic opus at $15/$75 per 1M tokens)
- Provider-unavailable fallback re-routing is cost-guarded: a fallback may
  only be cheaper than the originally decided model, and the re-route is now
  explained (`fallbackUsed`, attempted models) instead of silent
- Cost engine unknown-rate handling is real (previously dead code): unknown
  rates report `hasUnknownRate: true` and a $0 estimate instead of silently
  assuming the fail-closed placeholder's zero rates
- Frontend cost estimator mirrors backend fail-closed semantics: unknown
  pricing is displayed as unknown instead of $0.00

## [2.0.0] - 2026 (historical internal application marker — never published as a stable release)

> Note (2026-09-29): this version number was an internal application marker
> carried in `package.json` since the initial public commit. It was never
> published to npm and no `v2.0.0` tag exists; the only release tag is the
> `v0.1.0` prerelease. See the version-reset migration note under
> [Unreleased].

### Added
- Multi-provider AI routing: Anthropic, OpenAI, Google Gemini, NVIDIA NIM, DeepInfra
- Heuristic complexity scorer for automatic model tier selection
- Normalised SSE streaming across all providers
- Debate mode: parallel challenger models + synthesis pass
- SMD pipeline: Structured Multi-Draft (Draft → Skeptic → SynthDecision → Formatter)
- Video pipeline: upload, process, and query video assets via Supabase Storage
- Server-side cost tracking: pre-flight estimates, live token counting, daily budget guard
- Long-term memory: conversation summarisation injected as future context
- Supabase email/password auth with JWT verification on all edge functions
- `spend_stats` edge function for spend aggregation
- `video-intake`, `video-status`, `video-worker` edge functions
- Supabase Postgres schema with migrations for conversations, messages, cost_logs, user_memories, video_assets
- GitHub Actions CI: typecheck, lint, and test on every push and PR
