# Read-only release evidence checklist

Use this checklist before promoting a release. Keep captures sanitized: no access
tokens, API keys, secret names/values, signup submissions, or live provider requests.
The parity checker is local and read-only; it compares sanitized JSON captures and
fails closed on drift or secret-shaped values.

## Evidence status for this audit

| Area | Status | Evidence / next owner action |
| --- | --- | --- |
| Repository source | Verified | `gthgomez/Prismatix`, `main` at `0011d3f419ef9fe508716543762b08a9689e38ea` was independently verified before this patch. |
| Vercel frontend | Production SHA reported verified | The independent audit reported the production Vercel SHA verified. This workspace's Vercel connector returned no project for `gthgomez/Prismatix`, so this packet cannot independently capture the SHA or compare it with the reported value. Record the exact SHA and deployment URL from Vercel metadata in the release record. |
| Supabase project access | Not available | The authorized Supabase project listing exposed `Global Privacy Control`, not Prismatix. No Prismatix auth settings, edge functions, migrations, or schema were queried. |
| Supabase beta signup policy | Unknown / unverified | Beta signup is intentional. Owner must inspect the Prismatix project's signup toggle and document the intended behavior; do not infer server posture from frontend copy. |
| Supabase auth hardening | Unknown / unverified | Owner must inspect email confirmation, CAPTCHA provider/enforcement, and leaked-password protection in the Prismatix Auth settings. Do not change settings as part of evidence capture. |
| Supabase functions and migrations | Unknown / unverified | No project-matching connector access was available. Owner must capture function inventory/version/JWT posture and applied migration identifiers through authorized read-only project metadata. Compare function hashes only where both values are known. |
| Vercel security headers | Not reviewed here | Vercel routing/config is owned by the concurrent startup/service-worker patch. |

## Capture and compare

1. Start from the expected baseline in `docs/engineering/deployment-manifest.md` and
   the corresponding fixtures in `tests/deployment/check-deployment-parity.test.ts`.
   That baseline is historical (June 2026); reconcile it with the release under
   review before treating a comparison as current.
2. Capture an `expected.json` and `observed.json` using the checker contract documented
   in `scripts/check-deployment-parity.mjs`. Preserve unknown fields as `null` or omit
   them; never fill gaps with guesses. The observed capture is scanned for secret-shaped
   values and is not safe for credentials.
3. Run `npm run check:parity -- expected.json observed.json`. Save the sanitized output
   with the release record. Exit `0` means no error-severity drift was found in the
   fields compared; `UNKNOWN_FRONTEND` is informational and means the frontend identity
   is not verified by that capture. Exit `1` means a parity error; exit `2` means an
   invalid/missing input.
4. Record the precise source, capture time, and SHA for each observed value. A Vercel
   SHA alone does not establish Supabase function or migration parity.

This checklist is an evidence workflow, not a claim that production Supabase auth,
functions, or migrations have been verified.

## Built logged-out network check for this patch

The Playwright `auth_bundle_boundary.spec.ts` check ran against the real Vite production
build in local Chromium. Before and after builds used the same dummy Supabase URL
(`http://127.0.0.1:54321`) and dummy anon value; the only measured traffic was to local
Vite preview. This is a client asset measurement, not a production deployment check.

| Logged-out browser response content | Before (`0011d3f`) | After patch | Change |
| --- | ---: | ---: | ---: |
| JavaScript bytes | 788,480 | 399,036 | −389,444 (49.4%) |
| Stylesheet bytes | 184,469 | 32,479 | −151,990 (82.4%) |
| JS + CSS bytes | 972,949 | 431,515 | −541,434 (55.6%) |

The local preview served uncompressed assets, so these are response content lengths,
not gzip estimates. Before the change, the logged-out page fetched the 615,666-byte
`AuthenticatedApp` JS and 159,305-byte stylesheet containing the chat UI. After the
change those combined assets are absent from the logged-out waterfall; the authenticated
journey loads the deferred chat assets after mocked sign-in. The test also covers the
reset deep link, which stays on reset UI without loading chat code.
