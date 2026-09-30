# Pricing: effective-dated routing inputs (PX02)

Status: implemented on `audit/PX02-20260929`. Registry version: `2026-09-29-v8`.

Prices in Prismatix are **effective-dated routing inputs**, not decorative
display constants. Every price row carries provenance, a validity window, a
currency, and a context tier, and every cost decision consumes a typed lookup
result — never a bare optional number.

## Data model

Each `ModelPricing` row in `supabase/functions/router/pricing_registry.ts` has:

| Field | Meaning |
| --- | --- |
| `inputRatePer1M` / `outputRatePer1M` / cache + reasoning + tier rates | Recorded rates, USD per 1M tokens |
| `currency` | Always `'USD'` for this registry |
| `asOfDate` / `effectiveFrom` | Date the rate was verified and became valid |
| `effectiveUntil` | Optional inclusive end of the window (e.g. a promotional rate's advertised expiry) |
| `sourceRef` / `sourceUrl` | Concrete, citable source page (`PRICING_SOURCES`) |
| `isEstimated` / `isUnknown` / `isEligibleForAutoRouting` | Safety flags |

`lookupPrice(model, contextTokens, evaluationDate)` returns a typed
`PriceLookupResult`:

- `status`: `'known' | 'stale' | 'unknown'`
- `priceVersion`: registry version stamp
- `effectiveFrom` / `effectiveUntil`: the validity window
- `contextTier`: `'standard' | 'long'` plus the threshold token count
- `isEligibleForAutoRouting`: true only when `status === 'known'` and the row
  allows automatic routing
- `sourceRef` / `sourceUrl` / `currency`
- `pricing`: the recorded rates — **null when unknown** (never zero-faked)

## Status rules (fail-closed)

- **unknown** — no registry row. The record is null; an unknown rate can never
  be shown as a known cost and is never silently coerced to free.
- **stale** — `effectiveUntil` has passed, or the row is older than
  `STALE_AFTER_DAYS` (60 days). Recorded rates remain visible so estimates can
  be compared with reality, but the row is ineligible for Auto.
- **known** — within its window and freshly verified.

Gate behavior (`evaluateAutoSendSafety` in `cost_engine.ts`):

- unknown pricing → rejected for **Auto and manual** (`unknown_pricing`).
- stale pricing → rejected for **Auto before any provider call**
  (`stale_pricing`; surfaced by the edge function as HTTP 409
  `stale_model_pricing`). Manual selection of a stale-priced model stays
  possible as the explicit supported policy, but the decision carries a
  `staleRateWarning` naming the expiry/verification date.
- Auto additionally requires the model to be flagged auto-eligible.

Pricing receipts (spend ledger row and `X-Cost-*` response headers) record
`pricing_version`, `pricing_status`, `pricing_source_ref`,
`pricing_effective_from` and `pricing_effective_until`.

## Context tiers

Long-context tiers are modeled per row via `longContextThreshold` (GPT-5.6
family: 272,000 tokens; Grok 4.6: 200,000). The boundary is exclusive:
`contextTokens > threshold` selects the long tier — 272,000 tokens prices as
standard, 272,001 as long. Tier boundaries are pinned by
`tests/routing/pricing_effective_dating.test.ts`.

## Verification record (2026-09-29)

Sources observed on 2026-09-29:

- OpenCode Zen: https://opencode.ai/docs/zen (page updated 2026-09-29)
- OpenAI: https://developers.openai.com/api/docs/pricing
- Anthropic: https://platform.claude.com/docs/en/docs/about-claude/pricing
- Google: https://ai.google.dev/pricing
- DeepInfra: https://deepinfra.com/pricing

Corrected rows (recorded value → verified official value, per 1M USD):

| Row | Was | Verified | Source |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | 0.44 / 1.32 (peak), unverified "off-peak" schedule | 0.14 / 0.28 (cached read 0.028), single rate | Zen |
| `deepseek-v4-pro` | 1.32 / 3.96 (peak) | 1.74 / 3.48 (cached read 0.145), single rate | Zen |
| `gpt-5.6-sol` | 5.00 / 30.00 (long 10.00 / 45.00) | 4.00 / 20.00 (long 8.00 / 30.00); promo advertised through **2026-11-21**, recorded as `effectiveUntil` | Zen |
| `gemini-3.7-flash` | cached read 0.05 | 0.15 | Zen |
| `haiku-4.5` | 0.80 / 4.00 | 1.00 / 5.00 | Anthropic |
| `opus-4.6` | 15.00 / 75.00 | 5.00 / 25.00 | Anthropic |
| `gemini-2.5-flash` | 0.075 / 0.30 | 0.30 / 2.50 | Google |
| `gemini-2.5-pro` | 1.25 / 5.00 | 1.25 / 10.00 | Google |
| `gemini-3-flash` | 0.075 / 0.30 | 0.50 / 3.00 | Google |
| `gemini-3.1-pro` | 1.25 / 5.00 | 2.00 / 12.00 | Google |
| `gpt-5.4-mini` | 0.15 / 0.60 | 0.75 / 4.50 | OpenAI |
| `deepseek-r1` | 0.55 / 2.19 | 0.50 / 2.15 | DeepInfra |
| `deepseek-v3` | 0.20 / 0.77 | 0.32 / 0.89 | DeepInfra |
| `nemotron-3-super` | 0.10 / 0.16 | 0.085 / 0.40 | DeepInfra |
| `qwen3-235b` | 0.05 / 0.10 | 0.09 / 0.55 | DeepInfra |
| `llama-3.3-70b-turbo` | 0.02 / 0.03 | 0.10 / 0.32 | DeepInfra |
| `mistral-small-24b` | 0.03 / 0.08 | 0.05 / 0.08 | DeepInfra |
| `llama-3.1-8b-turbo` | 0.02 / 0.03 | 0.02 / 0.04 | DeepInfra |
| `mistral-nemo` | 0.02 / 0.04 | 0.019 / 0.03 | DeepInfra |
| `nemotron-nano-30b` | 0.10 / 0.16 | 0.05 / 0.20 | DeepInfra |

Re-verified unchanged on 2026-09-29 (date refreshed): `gpt-5.6-luna`,
`gpt-5.6-terra`, `grok-4.6`, `claude-sonnet-5`, `claude-opus-5`,
`claude-haiku-4-5`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `sonnet-4.6`,
`claude-3-5-haiku`, `llama-4-scout`, `qwen3-32b`, and the two free-tier rows.

**Could not be verified on 2026-09-29** (recorded 2026-04-13 rates kept; they
resolve to `stale` and are Auto-rejected, manual use shows a warning — never
silently current, never coerced to free): `gemini-2.0-flash`,
`claude-3-5-sonnet`, `claude-3-opus`, `glm-4.7-flash`, `qwen3.5-4b`,
`step-3.5-flash`. A future pricing review must either verify these against a
current official page or remove them.

## Negative controls

`tests/routing/pricing_effective_dating.test.ts` proves, before any provider
call: the 272K tier boundary on both sides, an expired promotional rate
reporting `stale` with recorded rates intact and Auto rejected, unknown
pricing returning a null record and rejecting both Auto and manual, and every
row resolving to a concrete source URL, currency and effective range.
