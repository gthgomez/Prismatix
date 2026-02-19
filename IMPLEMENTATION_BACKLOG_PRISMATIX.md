# Prismatix Production Implementation Backlog

Last updated: 2026-02-12
Project root: `C:\Users\icbag\Desktop\Project_SaaS\Prismatix`
Owner: Engineering
Status: Ready for execution

## 1. Execution Rules

- Work in order: `P0 -> P1 -> P2`.
- No P1 rollout before P0 checks are green.
- Router contract changes must update frontend header parsing in same PR.

## 2. P0 (Critical: CI + Routing Reliability)

### PRI-P0-01: Make lint actionable and enforce in CI

- Priority: P0
- Estimate: 1 day
- Dependencies: none
- Target files:
- `prismatix-frontend/eslint.config.mjs` (new)
- `prismatix-frontend/package.json`
- `.github/workflows/ci.yml` (new)
- Scope:
- Add ESLint config for React 18 + TS.
- Add CI workflow with frontend build/typecheck/lint and router tests/typecheck.
- Acceptance criteria:
- `npm run lint` passes locally and in CI.
- `deno check` and `deno test` are included in CI.
- Verification commands:
```bash
cd prismatix-frontend
npm run lint
npm run build
cd ..
deno check supabase/functions/router/index.ts
deno test Tests/Router_test_v2.ts
```

### PRI-P0-02: Extract and test model resolver contract

- Priority: P0
- Estimate: 2 days
- Dependencies: PRI-P0-01
- Target files:
- `supabase/functions/router/model_resolver.ts` (new)
- `supabase/functions/router/index.ts`
- `Tests/Resolver_test.ts` (new)
- Scope:
- Move `listGoogleModels`, `googleAliasScore`, `resolveGoogleModelAlias` into module with test seams.
- Unit-test ranking, unsupported models, empty list, and cache expiration behavior.
- Acceptance criteria:
- Resolver tests pass and cover failure/error branches.
- Router behavior unchanged for current known aliases.
- Verification commands:
```bash
deno test Tests/Resolver_test.ts
```

### PRI-P0-03: Add explicit routing/fallback headers

- Priority: P0
- Estimate: 1 day
- Dependencies: PRI-P0-02
- Target files:
- `supabase/functions/router/index.ts`
- `prismatix-frontend/src/smartFetch.ts`
- Scope:
- Add headers:
- `X-Router-Policy-Version`
- `X-Fallback-Used` (`true|false`)
- `X-Fallback-Reason` (`provider_unavailable|provider_error|none`)
- Parse and display these values in frontend diagnostics.
- Acceptance criteria:
- Header contract present on all successful responses.
- Fallback decision is transparent to UI/logs.
- Verification commands:
```bash
# Run local router and verify headers with curl/postman request
```

### PRI-P0-04: Harden streaming completion behavior

- Priority: P0
- Estimate: 1.5 days
- Dependencies: PRI-P0-02
- Target files:
- `supabase/functions/router/index.ts`
- Scope:
- Add inactivity watchdog for upstream streaming (idle timeout, structured termination).
- Persist assistant response only when stream completed successfully; mark partial otherwise.
- Acceptance criteria:
- No hanging requests on silent upstream stalls.
- Partial streams do not appear as complete assistant messages.
- Verification commands:
```bash
deno check supabase/functions/router/index.ts
```

## 3. P1 (Important: Auth Resilience + Observability)

### PRI-P1-01: Auth edge-case integration tests

- Priority: P1
- Estimate: 1.5 days
- Dependencies: PRI-P0-01
- Target files:
- `Tests/Auth_flow_test.ts` (new)
- `prismatix-frontend/src/smartFetch.ts`
- `prismatix-frontend/src/hooks/useAuth.ts`
- Scope:
- Add test scenarios for 401 retry-once, stale refresh token, and issuer mismatch handling.
- Acceptance criteria:
- One-retry policy is deterministic.
- Re-auth path does not loop.
- Verification commands:
```bash
deno test Tests/Auth_flow_test.ts
```

### PRI-P1-02: Single-flight refresh lock in frontend auth path

- Priority: P1
- Estimate: 1 day
- Dependencies: PRI-P1-01
- Target files:
- `prismatix-frontend/src/smartFetch.ts`
- `prismatix-frontend/src/hooks/useAuth.ts`
- Scope:
- Prevent concurrent token refresh storms from multi-tab or rapid parallel requests.
- Acceptance criteria:
- Parallel 401 responses produce one refresh attempt.
- No double sign-out race.

### PRI-P1-03: Router diagnostics endpoint/log bundle

- Priority: P1
- Estimate: 1 day
- Dependencies: PRI-P0-03
- Target files:
- `supabase/functions/router/index.ts`
- Scope:
- Add structured log record for routing inputs and selected model/fallback reason.
- Acceptance criteria:
- Support can explain model selection post-hoc using logs.

## 4. P2 (Optimization + Cost Controls)

### PRI-P2-01: Budget and cost guardrails

- Priority: P2
- Estimate: 2 days
- Dependencies: PRI-P0-03
- Target files:
- `supabase/functions/router/router_logic.ts`
- `supabase/functions/router/index.ts`
- Scope:
- Add configurable caps by user tier or environment budget mode.
- Clamp unsafe token budgets before provider requests.
- Acceptance criteria:
- Per-request token budgets are bounded and auditable.

### PRI-P2-02: Provider health status exposure

- Priority: P2
- Estimate: 1 day
- Dependencies: PRI-P0-03
- Target files:
- `supabase/functions/router/index.ts`
- `prismatix-frontend/src/components/ModelIndicator.tsx`
- Scope:
- Surface provider degraded/disabled status in UI.
- Acceptance criteria:
- UI reflects fallback/degraded provider state from response metadata.

## 5. Release Gates

- Gate A: Lint + build + router tests pass in CI.
- Gate B: Resolver test suite added and green.
- Gate C: Routing/fallback headers live and frontend-aware.
- Gate D: Stream watchdog + partial persistence behavior verified.

Production readiness requires all four gates.

## 6. Command Bundle

```bash
cd "C:\Users\icbag\Desktop\Project_SaaS\Prismatix\prismatix-frontend"
npm run lint
npm run type-check
npm run build
cd "C:\Users\icbag\Desktop\Project_SaaS\Prismatix"
deno check supabase/functions/router/index.ts
deno test Tests/Router_test_v2.ts
# after implementation:
deno test Tests/Resolver_test.ts
```

## 7. Rollback Plan (Global)

- Keep new headers additive and backward-compatible in first deployment.
- Guard stream watchdog behind env flag for first rollout.
- If resolver rollout causes routing regressions, fallback to previous in-file resolver path via feature flag and redeploy router.
