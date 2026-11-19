# Prismatix engineering campaign · 2026-11-19 UTC

| Source | Observed revision and state |
| --- | --- |
| GitHub `main` | `6a5c4cb0ad364490a1a0d959dcc60f68f63d7314` |
| Vercel production frontend | READY on the same SHA. Deployment identity only. [Production](https://prismatix-app.vercel.app/) |
| Arctic UI baseline | Draft #72 at `54b80e4f9ca00ea352ddd0518b761dc697b954e1` with mergeable source and passing CI. [PR #72](https://github.com/gthgomez/Prismatix/pull/72) · [READY preview](https://prismatix-jqbcvzq43-jonathan-gomez-aguilars-projects.vercel.app) |
| Overlapping onboarding work | Open #65 at `929284ac5bbe09a13b9b6b441b4153a0d30f7845`. Its source conflicted with main. [PR #65](https://github.com/gthgomez/Prismatix/pull/65) |
| Prismatix production Supabase | **UNVERIFIED**. The connected inventory returned an unrelated project. |
| Execution environment | Linux, five CPUs, 16 GiB available RAM and roughly 30 GiB free disk at start. Two isolated workers handled Compare and startup/spend. |

## Findings and disposition

| Severity | Lane and impact | Disposition |
| --- | --- | --- |
| P0 | B · The browser attempted to rewrite protected assistant content to save Compare. | The browser write was removed. The owner-scoped RPC and frontend opt-in passed isolated PostgreSQL and synthetic browser checks. Keep the flag off pending hosted qualification. With no saved assistant row, a failed pair has no history card. Compare preferences and Debate reload still need separate work. |
| P0 | G · A frontend deployment SHA cannot establish hosted backend parity. | **Blocked** pending authorized read-only Prismatix Supabase inventory. Capture migrations, functions, auth controls, RLS and grants before release. |
| P1 | A/F · Theme and onboarding changes overlap across #65 and #72. | Based the candidate on #72. Brought across coverage for alternate-provider/demo reachability, composer focus, and distinct history loading/error/empty states. Keep #65 available for maintainer housekeeping. |
| P1 | C · Failed prompt text disappeared on reload. | Added account-scoped text recovery in the current tab. A recovered draft requires a deliberate restore, and the user is prompted to inspect history before sending again. Attachments require re-selection. Uncertain settlement, concurrent tabs, and additional stream failures still need broader real-backend qualification. |
| P1 | D · Ledger failure silently substituted local entries. | Server export now surfaces errors, overview identifies stale data and absence of a sync, and per-message labels distinguish unavailable pricing and unmetered outcomes. Local breakdown and client budget advisory logic remain. Validate deployed spend policies and settle model-specific cost/receipt edge cases before changing admission UX. |
| P1 | E · History projection omitted lineage and the preview join was ambiguous after the branch migration. | Select lineage and explicitly name the messages foreign key. History pagination discards superseded requests. Browser coverage exercises loading, outage and retry. Full export/import round trips, large-history limits and storage reconciliation still require local integration. |
| P1 | F/G · Startup defaulted to a synthetic backend on real routes. | Require explicit configuration and render guidance on missing values. Browser automation builds with an explicit synthetic fixture. Local signup settings and hosted auth policy are described separately. Hosted provider/config and local full RLS qualification remain open. |
| P1 | H · First-run layout, keyboard and PWA evidence was narrow. | Added compact portrait and landscape dimensions and scoped axe checks for setup and the provider dialog. Existing Chromium tests exercise stale-worker recovery, themed auth and saved-chat startup. Physical-device keyboard, assistive tech and broader zoom coverage remain open. |
| P2 | E · Failed storage reference checks could fall through to removal. | Retain the object on failed checks and report incomplete cleanup. A durable owner-scoped reconciliation queue is still open. |
| P2 | I · Advanced workflows have mixed fixture and backend evidence. | Use existing synthetic suites for regression evidence. Live qualification for knowledge, attachments, image/video, Debate/SMD, voice, artifacts and memory remains open. No feature flags were enabled for production. |
| P2 | J · Chat and router remain large. | Startup configuration stays lightweight. The local production build and bundle-boundary browser test provide a baseline. Transcript rendering and navigation-waterfall profiling remain open. |
| P1 | K · Node runtime differed across local, CI and Vercel. | Full CI uses Node 24 with clean-install/build checks on Node 20 and 22. Browser artifact uploads contain only synthetic fixture evidence. Branch protection remains a maintainer decision. |
| P2 | L · Public docs contradicted the default provider. | README now documents OpenRouter BYOK and the scope of synthetic testing. |

## Evidence scope

- The Compare PostgreSQL 17 harness executes prerequisite repo migrations and
  the candidate migration against isolated Postgres. It supplies minimal local
  auth and storage objects, and verifies replay, page-filtered reads, one failed
  child, later stop and settlement state, owner isolation and write protection.
  It does not launch Supabase Auth, Storage, PostgREST or the Edge runtime.
- The opt-in Chromium fixture confirms two synthetic executions share one
  logical Compare ID, make no browser writes to message rows, and reload both
  saved answers. This is a browser contract check with synthetic responses.
- A browser run against a build with backend configuration removed showed the
  recovery screen for sign-in and reset, reached the scripted demo, and
  observed zero Supabase requests.
- The Web UI is qualified through synthetic browser fixtures. Paid provider
  usage for the campaign was zero.

## Release sequence

1. Confirm the intended Supabase project and inventory applied migrations, functions,
   storage policies, auth settings and current release identifiers with read-only access.
2. Require independent review and exact-head CI before release. Keep schema-sensitive
   Compare activation blocked until local database and Edge checks pass against an
   equivalent configuration and an operator authorizes deployment.
3. Apply additive backend changes first. Enable the Compare flag only in a candidate
   environment whose backend supports it. If UI or RPC smoke fails, disable the flag and
   retain the additive database objects and saved records. Any policy or schema removal
   requires separate review.
4. Require explicit authorization for a production-triggering merge and any paid provider
   canary. All browser tests for this campaign use scripted providers and storage fixtures.
