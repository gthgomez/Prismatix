# Security Policy

## Scope

`Prismatix` is a personal AI chat client with a cost-aware multi-provider router. It holds
credentials and user records that are valuable to an attacker, and it enforces access control on
its backend.

In scope:

- The Supabase edge functions under `supabase/functions/` — authorization and JWT verification,
  Row Level Security coverage in the migrations, and any path where one user can read or write
  another user's conversations, messages, `cost_logs`, `user_memories`, or `video_assets`.
- The routing and cost guardrails: a bypass that lets a request proceed without a known price, or
  that re-routes to a more expensive or non-eligible model than the documented policy allows.
- Any path by which a provider API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`,
  `NVIDIA_API_KEY`, `DEEPINFRA_API_KEY`) is exposed to the browser, logged, echoed in a response, or
  sent to an unintended host.
- The Supabase anon key handling, the `ALLOWED_ORIGIN` check on edge functions, and video upload
  and retrieval in Supabase Storage.
- Streaming, spend, rate, and concurrent-stream guards, where a bypass produces unbounded upstream
  spend.

Out of scope: vulnerabilities in third-party services (Anthropic, OpenAI, Google, NVIDIA,
DeepInfra, Supabase, Vercel) that are reproducible without this codebase's involvement, and
weaknesses that require a leaked or attacker-controlled Supabase service-role key.

## Supported Versions

This project is pre-1.0 and is not API-stable.

| Version | Supported |
| --- | --- |
| `main` (latest commit) | Yes |
| Latest tagged release | Yes |
| Any earlier commit, branch, or release | No |

Only the current tip of `main` and the most recent release receive security fixes. Because deployed
edge functions and database migrations are stateful, a report that only reproduces on a
previously deployed migration should say which migration was live when it was observed.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab and click
**Report a vulnerability**. This opens a private advisory visible only to the maintainer.

If private reporting is unavailable to your account, open a
[security advisory](https://github.com/gthgomez/Prismatix/security/advisories/new) directly.
There is no published email address for this project, so the advisory channel is the supported
route.

Please do not open a public issue for an unfixed defect, and never include a real API key, JWT, or
user identifier in a report. Redact them.

## What to Include

- Type of defect, mapped to the categories above: cross-user data access, RLS or JWT verification
  gap, credential exposure, cost-guardrail bypass, origin-check bypass, or unauthenticated storage
  access.
- Affected commit SHA, release tag, and the edge function or migration revision involved.
- The request or sequence of requests that reproduces it, with all tokens and keys redacted.
- The two user accounts or roles involved, described generically (for example "user A" and "user B")
  rather than by email address.
- What data was accessible or what spend was permitted, and how you confirmed it.

## Maintainer Response

The maintainer commits to the following:

- Acknowledge a report within 7 days.
- Provide a severity assessment and a remediation or mitigation plan within 30 days of
  acknowledgement.
- Credit reporters in the advisory and release notes unless anonymity is requested.

For a report that indicates live credential exposure, the maintainer will treat rotation of the
affected key as the first step and will say so in the acknowledgement.

## Coordinated Disclosure

Fixes land before public disclosure. A reporter should allow up to 90 days from first contact for
a fix or a documented mitigation before publishing, and the maintainer will not cut that period
short without agreeing with the reporter. Cross-user data access and credential exposure are
treated as urgent and are prioritized ahead of the 90-day window.

## No Bug Bounty

There is no bug bounty program for this project, and no payment is offered for reports. Credit and
a public advisory are the entire compensation.
