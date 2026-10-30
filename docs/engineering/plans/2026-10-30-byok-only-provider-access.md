# BYOK-only provider access

## Implementation plan

- Remove deployment provider secrets from credential readiness and resolution; only a user's enabled, encrypted key may authorize a paid provider call.
- Default new and legacy-default accounts to OpenRouter BYOK, and report server-only OpenCode as unavailable in provider settings.
- Apply the same user-key gate to router subcalls, memory extraction, and queued Google video processing. Fail closed on missing, revoked, invalid, lookup-failed, or undecryptable keys; never retry with a deployment key.
- Keep durable execution accounting, shared project/user limits, rate and concurrency checks, and safety controls intact. BYOK spend remains conservatively subject to the existing shared admission pool until accounting is separated.
- Add fake-key regression coverage for dispatch attempts, correct provider status, and background key resolution; update setup documentation. No billing, schema migration, deployment, or live Supabase setting changes.
