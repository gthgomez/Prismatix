# Changelog

All notable changes to Prismatix are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] - 2026

### Added
- Multi-provider AI routing: Anthropic, OpenAI, Google Gemini, NVIDIA NIM, DeepInfra
- Heuristic complexity scorer for automatic model tier selection
- Normalised SSE streaming across all providers
- Debate mode: parallel challenger models + synthesis pass
- SMD pipeline: Structured Multi-Draft (Draft → Skeptic → SynthDecision → Formatter)
- Video pipeline: upload, process, and query video assets via Supabase Storage
- Server-side cost tracking: pre-flight estimates, live token counting, daily budget guard
- Long-term memory: conversation summarisation injected as future context
- Supabase email/password auth with JWT verification on all edge functions
- `spend_stats` edge function for spend aggregation
- `video-intake`, `video-status`, `video-worker` edge functions
- Supabase Postgres schema with migrations for conversations, messages, cost_logs, user_memories, video_assets
- GitHub Actions CI: typecheck, lint, and test on every push and PR
