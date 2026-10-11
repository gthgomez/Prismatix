# Router, OpenCode Go, and current model rollout

## Authorized scope

Restore browser chat, integrate the owner's OpenCode Go subscription, refresh the current model catalog, retain older models in a collapsed manual-only Historic catalog, merge PR #30, deploy, and run sequential synthetic inference tests within a $1 total limit. Preserve JWT verification, ownership checks, entitlement gates, and server-side credentials. No schema changes. Independent review was explicitly waived by the owner.

## Implemented

- [x] Browser preflight permits the existing client request-ID headers; regression observed failing before the fix.
- [x] Correct physical DeepSeek, Qwen, and MiMo model IDs; preserve application IDs for routing and pricing.
- [x] Dispatch through the configured OpenCode base URL, identify Prismatix honestly, and send stable conversation sessions across protocols.
- [x] Use documented conservative peak Go rates when the official Go endpoint is configured.
- [x] Add GPT-6 Astra, GPT-6.1 Sol, Claude Haiku 5.5, and Grok 4.7 alongside existing current models; map requested OpenAI, Anthropic, and Google models through OpenRouter.
- [x] Exclude historic models from automatic routing and the default picker; allow explicit manual selection from the collapsed Historic catalog.
- [x] Require memory entitlement before retrieval or auxiliary summarization so chat-only tests do not invoke those workflows.
- [x] Inspect source and test diffs. Retain the stale-model audit; its documented budget records deliberate current-ID references, official Qwen wire IDs, and reduced older-model coupling counts. Its substring matches also count newer Claude IDs under older prefixes.

## Verification before merge

- Full Vitest: 562 tests / 54 files passed.
- Latest frontend edit: ChatInterface end-to-end and model selector tests, 8 tests / 2 files passed.
- TypeScript typecheck and Vite production build passed.
- ESLint: zero errors, 44 existing warnings.
- Deno checks: router and provider-settings passed.
- Stale-model budget check passed.

## Deployment and live verification

- [x] Initial CORS-only router deployment retained JWT verification; production OPTIONS returned 200 with the requested headers.
- [x] Confirmed OpenRouter credentials available by metadata, without retrieving any key.
- [x] Existing OpenRouter Haiku 4.5 and Gemini 2.5 Flash returned OK. These superseded probes do not establish current-model coverage.
- [ ] Merge the exact passing PR candidate and deploy its router with the Go endpoint and current catalog/tariff versions.
- [ ] Verify production frontend deployment and the collapsed Historic catalog.
- [ ] Test every configured model advertised by Go, including manually selected historic entries. Record unsupported catalog entries separately and do not count fallback success as selected-model success.
- [ ] Test Haiku/Sonnet/Opus 5.5, GPT-6 Astra/Sol/Luna, GPT-6.1 Sol, and Gemini 3.8 Flash through OpenRouter.
- [ ] Record exact served identities, outcome, settled cost, pending accounting, and coverage limitations. Restore the original default gateway after tests.

## Official evidence

OpenCode third-party endpoint, identification/session requirements, coverage, and rates: https://opencode.ai/docs/go/

Provider model discovery: https://opencode.ai/zen/go/v1/models and https://openrouter.ai/api/v1/models
