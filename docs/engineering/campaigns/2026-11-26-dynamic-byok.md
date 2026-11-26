# Dynamic BYOK campaign

Production frontend baseline `6a5c4cb0ad364490a1a0d959dcc60f68f63d7314`, Vercel `dpl_17qK2FFxyNdWjXbd9LsDMRvG3XGw`. Integration base is draft PR #73 at `74d009beb44f5fbbab4d8042769f5a43f8a21333`.

## Acceptance cases defined before repair

| Case | Observable acceptance |
| --- | --- |
| Fresh, saved-unverified, or all disabled | No enabled route, no preference by default, no upstream inference or reservation |
| OpenAI-only | Authenticated list containing a GPT route makes the exact route immediately selectable. Manual and all Auto policies dispatch the appropriate OpenAI protocol and settle against its recorded tariff |
| Distinct serving routes | A gateway and a native route for the same model remain distinguishable and a manual selection cannot change providers or models |
| Connect, refresh, replace, disable, remove | Visible state reflects the current credential. In-flight discovery cannot reactivate or attach inventory to a replaced key |
| Restricted or stale inventory, unknown price, unsupported protocol | No dispatch, with a recoverable settings or picker state |
| Verified inventory with newly published compatible model | Exact new identifier can be selected and sent without a source change when the catalog supplies a compatible protocol, capabilities and tariff |
| Provider-specific qualification | OpenAI, OpenRouter, Console, Go, Command Code, Anthropic, Google, NVIDIA, and DeepInfra each exercise documented metadata and inference contracts with a positive and a forbidden-call control |
| Accounting | Reservation and settlement use the selected route tariff and version. A tariff change cannot mutate prior receipts. Interruption does not duplicate inference |
| Mobile and multi-model | The browser exercises connection, selection, chat and recovery at narrow and desktop widths. Compare and debate stage requests respect the same credential and inventory gates |
| Hosted release | Staging isolation guard stays in force. Production merge, migrations, deployment and billable qualification require explicit authorization |

## Integration sequence

1. Add credential-bound authenticated inventory to the existing provider configuration RPC and expose safe routes through Provider Settings. Normalize native metadata and retain last-known-good snapshots with explicit status and freshness.
2. Use exact route identifiers in settings, both pickers, and the existing request override field. Keep display compatibility for historical conversations and their upstream IDs.
3. Select only authorized routes before spend admission. Use the selected product adapter and tariff for dispatch, normalization, and accounting. Refresh credential authorization at dispatch.
4. Run deterministic Edge and browser scenarios, migration replay, static and unit gates, and independent review. Keep live and hosted qualification explicitly open wherever credentials, spending authority or staging isolation are unavailable.

## Baseline and decisions

The production router advertised release `81d13a9159e0c938aaae0842e99914a90fdbc768` and catalog and tariff version `2026-10-10-v11`. The frontend and router had different deployment identities. At the PR #73 head, a deterministic baseline reproduced a valid OpenAI metadata check, a picker that concealed the OpenAI route, and a production routing branch that picked an unavailable Gemini route. Native credential resolution and fallback policy did not use the same account-scoped inventory as the picker. The existing PR #73 remains the integration base. Exact-head Actions run `45439405064` passed on that base.

The provider key row owns authenticated inventory and its revision. User opt-in, credential health, inventory freshness, eligible routes, and recent upstream failures are distinct. Router dispatch checks the exact route, revision and current authorization before reading encrypted key material. Public Models.dev enriches compatible exact IDs. Account metadata is an eligibility signal and actual service behavior requires a qualified inference test. The system uses fixed service destinations and preserves the actual serving provider, route and tariff in execution receipts. The ranking policy uses existing benchmark bands where applicable and estimated request cost. It has no learned ranking or measured provider quality and latency feedback yet.

Go is restricted to compatible coding requests with an active allowance and the documented Console overage rate reserved as an upper-bound estimate. OpenRouter funding is recorded as credits. Unsupported billing tiers or a model without a qualified tariff remain excluded. Command Code discovery and protocol translation are wired to its Provider API. Its public models endpoint alone supplies neither account entitlement nor a verified tariff, so no Command Code route is ready for execution. The existing DeepInfra operator gate is retained.

Official documentation consulted includes [OpenAI Models](https://platform.openai.com/docs/models), [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses), [OpenRouter authorization](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key), [OpenRouter account inventory](https://openrouter.ai/docs/api/api-reference/models/list-models-for-user), [OpenCode Console](https://opencode.ai/docs/console/api/models.md), [OpenCode Go](https://opencode.ai/docs/go/), [Command Code Provider API](https://commandcode.ai/docs/provider), [Anthropic Models](https://platform.claude.com/docs/en/api/models/list), [Google Models](https://ai.google.dev/api/models), [NVIDIA API Catalog](https://build.nvidia.com/), [DeepInfra](https://deepinfra.com/docs), and [Models.dev](https://models.dev/api.json).

## Release and rollback

1. Apply `20261126000000_dynamic_provider_inventory.sql` in an authorized non-production project with separate data, keys and spending authority. Confirm that its internal catalog and dispatch RPCs are service-role only. Smoke-test signup, the signup grant, provider revision invalidation, exact routes, and ledger reads for the previous and current release.
2. Deploy the provider-settings, router, memory, video-worker and catalog-reconcile functions at the same candidate revision, then publish its web build. Keep inference entry points closed during the switch if isolation or parity cannot be demonstrated. Confirm browser and function release identities, then refresh existing enabled connections. Fresh accounts must return zero routes and no preference.
3. Invoke `catalog-reconcile` with the existing server-side job infrastructure on a six-hour cadence. Verify service authentication and the last successful snapshot timestamp. The implementation also reconciles on demand with coalescing, bounded fetches and retry backoff. Hosted scheduling is pending release authorization.
4. Execute the remaining matrix with authorized provider accounts and spending. Keep fixture endpoints and the staging isolation guard in place for their respective environments. The loopback fixture override belongs only in the local stack.
5. For rollback, pause affected inference entry points, then roll back the web and Edge releases as a coordinated set. Preserve the additive migration, encrypted credentials, versions and accounting history. Use an authorization-safe rollback build or leave inference paused. The previous production router can reintroduce the defect documented here. Do not restore the old default-provider behavior or the old unrestricted dispatch path.

## Acceptance evidence

| Provider or integration | Evidence on the local application candidate | Live qualification |
| --- | --- | --- |
| OpenAI direct | Authenticated inventory exposed GPT-6.2 Sol and excluded the unpriced item. Exact manual and all three Auto policies used Responses with matched fixture authorization. Each API fixture turn settled at $0.000200 from 40 input, 8 output and 4 reasoning tokens. The browser also sent both manual and Auto from a newly configured account. | Awaiting an authorized account and spend cap |
| OpenRouter | Matched account key, exact chat route, persisted transcript and settled receipt. The base fixture produced $0.000075 from 40 input and 12 output tokens. The browser compared this route with OpenAI under the account execution lease. | Awaiting an authorized account and spend cap |
| OpenCode Console (Zen) | Separate key, inventory, protocol and credit-based tariff exercised through the connection and router functions. The fixture settled at $0.000064. | Awaiting an authorized account and spend cap |
| OpenCode Go | Separate Go inventory and coding route, stable session header and allowance checks. The fixture logged a $0.000064 tariff estimate. General chat and exhausted allowance controls made zero inference calls. | Awaiting an authorized subscription, allowance and spend cap |
| Command Code | Public discovery and native protocol translation covered by code and contract tests. No account-entitled, priced route can be admitted with the available evidence. | Open, requires account entitlement and price evidence |
| Anthropic and Google | Native protocol contracts, usage parsers and eligibility covered by automated tests. | Awaiting authorized credentials and native execution |
| NVIDIA and DeepInfra | Adapter paths support exact compatible inventory and require verified pricing. NVIDIA public free offers do not establish the account's rate. DeepInfra retains its operator gate. | Awaiting qualified tariffs, enabled environments and authorized accounts |
| Brave Search | Retained as a separate search integration. | Inference is outside its scope |

The real browser served the compiled app and current handlers against local GoTrue, PostgREST and PostgreSQL. Provider responses and charges were deterministic fixtures. The cloud Docker host could not run the Edge container’s normal network path with its file-descriptor limit and proxy restrictions, so a local Deno listener hosted the same function sources for these runs. GitHub Actions runs the Supabase CLI and Edge container separately. Acceptance review inspected the browser artifacts, sanitized provider call metadata and the PostgreSQL authorization checks independently.

- A fresh identity reported no key, route, enabled provider or preference. Unavailable manual routes, a too-low cap, exhausted Go quota and an invalidated restricted model had zero subsequent upstream inference. Cross-account checks passed 14 protected boundaries.
- The local PostgreSQL test returned a credential for a verified fixture route, then rejected its old revision after disabling the connection in the same transaction. The authenticated role could not execute the dispatch RPC. The transaction was rolled back.
- Catalog reconciliation rejected an unauthenticated call with HTTP 403 and stored Models.dev snapshot `6b27120a3324b6f9f84d2f511758d036a477319d0a042e7c45c4871d4175c1b4` locally at 2026-11-26 23:19:21 UTC. The new-model fixture admitted an exact ID that does not exist in the source catalog. Repricing moved its next receipt from $0.000065 to $0.000105 while the prior persisted receipt kept its original amount and tariff. A fixture retirement invalidated the route and the historical receipt remained readable.
- On the same greeting with two eligible fixture providers, the explicit OpenAI baseline settled at $0.000200 and Economy chose OpenRouter at $0.000075. Disabling OpenRouter caused Economy to select OpenAI at $0.000200, with zero calls to the disabled route. These measurements are from synthetic usage. Actual quality, latency and bill reductions are unmeasured.

See [stacked PR #76](https://github.com/gthgomez/Prismatix/pull/76) for the integration revision and Actions checks.

## Open acceptance

Hosted staging availability and deployment parity are unverified. The production project is inaccessible to the provisioned connector and the historical staging capacity limit could not be rechecked. The user has not authorized paid provider calls, a production merge, production migrations or deployment. No production action was taken.

Command Code executability, full provider qualification, handset and tablet qualification across providers, an activated recurring hosted schedule, and measured routing outcomes are open. Public metadata and layout emulation provide a narrower level of evidence. The reviewed GPT-6.2 direct rates are a dated exact-ID override. Automatic refresh of those particular source rates and provider-specific long-context and ancillary charge assurance remain open. Inference attempts with uncertain provider billing are settled from the ledger without replaying them. Dynamic fallback after an upstream error and evidence-based tuning from live outcomes remain open.

## Verification commands and owner decisions

- `NODE_ENV=test npm test` ran 110 suites and 1,132 tests successfully. `npm run type-check`, `npm run lint`, `deno check` for the four changed dispatch and catalog entry points, `node scripts/audit-stale-models.mjs --check`, and `git diff --check` also completed. Lint reported 135 warnings and zero errors.
- The isolated local runs of `npm run qual:env`, `npm run qual:smoke`, `npm run qual:isolation`, `npm run qual:rate`, and the OpenAI, OpenCode and catalog scripts in `scripts/qualification` passed. Rate admission accepted ten turns, rejected the eleventh with HTTP 429 and no provider call, and admitted a turn after the published retry window.
- `VITE_PX08_COMPARE_DURABILITY=true npm run qual:e2e` passed all six local journeys. The narrow first-run test used 412 × 915, connected OpenAI, exercised exact and automatic routes, then used two explicitly chosen provider routes in Compare. After removal the picker omitted the OpenAI route, Send was disabled, and no inference reached the fixture. Desktop tests covered saving, reload, cancellation and cross-account history.
- Vercel preview `dpl_GNbs695SqrLX5wHRegdsvezw4WkM` failed as designed because both its Supabase URL and router endpoint targeted production. To proceed with hosted qualification, the owner needs to supply an authorized isolated Supabase project and grant access to configure the preview environment. The guard remains active. [Preview build](https://vercel.com/jonathan-gomez-aguilars-projects/prismatix/GNbs695SqrLX5wHRegdsvezw4WkM)
- Each real provider run needs an authorized disposable account, its applicable product or subscription, and an explicit spend cap. Release requires separate approval for the reviewed migration and coordinated web and Edge deployments.
