# Router preflight and live model verification

**Goal:** Restore browser chat requests and verify every added OpenCode model with a short synthetic message, then test Anthropic, OpenAI, and Google through OpenRouter when its key is available.

**Architecture:** Keep the existing authenticated router, idempotent request IDs, provider resolution, streaming, pricing, and spending gates. Extend the explicit CORS request-header list to match the existing client contract.

**Constraints:** Never retrieve credential values. Keep JWT verification enabled. Run paid tests sequentially within the owner's confirmed total budget. Preserve unrelated work. No schema changes.

## Task 1: Browser preflight fix

- [ ] Add a handler regression test in `tests/integration/deployment-contract.test.ts`: production-origin OPTIONS with authorization, apikey, content-type, and x-client-request-id must allow every requested header; OPTIONS must not authenticate or dispatch providers.
- [ ] Run the test before the fix and confirm failure on x-client-request-id.
- [ ] Add x-client-request-id and the already-supported x-request-id alias to the explicit header allowlist in `supabase/functions/router/index.ts`.
- [ ] Run deployment-contract tests, relevant router/security tests, and `deno check supabase/functions/router/index.ts`.
- [ ] Inspect the diff and obtain independent review if host capacity permits; publish the task branch/PR with exact verification evidence.

## Task 2: Deploy and verify live routing

- [ ] Deploy the reviewed router to Prismatix project `sqjfbqjogylkfwzsyprd` with JWT verification retained.
- [ ] Confirm the production OPTIONS response allows the full client header set.
- [ ] Use the existing authenticated app session for a minimal automatic-routing request.
- [ ] Enumerate every OpenCode model in the app/curated catalog; test each with a distinct short synthetic prompt and record selected model, served provider/model, response, and cost/error. Do not count a fallback as the selected model passing.
- [ ] Once OpenRouter is configured, test at least one Anthropic, OpenAI, and Google model through that gateway. Record missing configuration as blocked rather than a successful test.
- [ ] Save sanitized results and report actual coverage, failures, total spend, and any remaining blockers.

## Review focus

Fixed CORS allowlist, unauthenticated preflight only, unchanged POST authentication, request-ID replay safety, exact served-model identity, and no secrets in artifacts.
