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
