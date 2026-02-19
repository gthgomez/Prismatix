# PRISMATIX Video Pipeline Integration Plan (2026-02-16)

## 1) Problem Statement
Current router flow only supports text and image payloads. Raw video requests are not supported and can overload the request path if handled as text/binary in the chat payload.

Observed failure mode:
- Frontend allowed video selection.
- Video data path did not have a proper video-specific pipeline.
- Router function returned `546 WORKER_LIMIT` under oversized/expensive request handling.

## 2) Goals
- Add production-grade video support for chat analysis.
- Keep router request bodies small and deterministic.
- Preserve streaming chat UX and current model-routing behavior.
- Enforce strict limits, quotas, and ownership controls.

## 3) Non-Goals
- Sending raw video bytes/base64 directly through `functions/v1/router`.
- Running heavy ffmpeg transcoding inside Supabase Edge Functions.
- Supporting unlimited-duration videos in v1.

## 4) Target Architecture

```text
Client -> video-intake (create upload session)
      -> direct upload to Supabase Storage (private bucket)
      -> video-intake/complete (finalize + enqueue job)
      -> video-worker (async processing)
          - probe metadata
          - extract keyframes
          - transcribe audio
          - store artifacts
      -> router request with videoAssetIds
          - router loads compact artifacts
          - router sends selected frames + transcript summary to provider
          - stream response back to client
```

Key design rule:
- Router receives references (`videoAssetIds`), not raw video.

## 5) Data Model (Supabase)
Add migration for these tables and enums.

### 5.1 Enums
- `video_asset_status`: `pending_upload`, `uploaded`, `processing`, `ready`, `failed`, `expired`
- `video_job_status`: `queued`, `running`, `succeeded`, `failed`
- `video_artifact_kind`: `thumbnail`, `frame`, `transcript`, `summary`

### 5.2 Tables
- `video_assets`
  - `id uuid pk`
  - `user_id uuid not null`
  - `conversation_id uuid null`
  - `storage_bucket text not null default 'video-uploads'`
  - `storage_path text not null`
  - `mime_type text not null`
  - `file_size_bytes bigint not null`
  - `duration_ms int null`
  - `width int null`
  - `height int null`
  - `status video_asset_status not null`
  - `checksum_sha256 text null`
  - `error_code text null`
  - `error_message text null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

- `video_jobs`
  - `id uuid pk`
  - `asset_id uuid not null references video_assets(id) on delete cascade`
  - `status video_job_status not null default 'queued'`
  - `attempt int not null default 0`
  - `started_at timestamptz null`
  - `finished_at timestamptz null`
  - `error_code text null`
  - `error_message text null`
  - `created_at timestamptz not null default now()`

- `video_artifacts`
  - `id uuid pk`
  - `asset_id uuid not null references video_assets(id) on delete cascade`
  - `kind video_artifact_kind not null`
  - `seq int null`
  - `storage_bucket text null`
  - `storage_path text null`
  - `text_content text null`
  - `metadata jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`

Optional (recommended):
- `message_video_attachments` join table if you need message-level traceability.

### 5.3 RLS Policies
- User can select/update only their own `video_assets` and related rows via `user_id` ownership.
- Service role can bypass for worker processing.

## 6) Storage Layout
Create private buckets:
- `video-uploads` for source files
- `video-artifacts` for extracted thumbnails/frames

Path pattern:
- `video-uploads/{user_id}/{asset_id}/source.mp4`
- `video-artifacts/{user_id}/{asset_id}/frame_{seq}.jpg`
- `video-artifacts/{user_id}/{asset_id}/thumbnail.jpg`

## 7) API and Function Contracts

### 7.1 `functions/v1/video-intake` (new)
`POST /init`
- Input: `fileName`, `mimeType`, `fileSizeBytes`, `conversationId`
- Validate: mime, extension, size quota, auth
- Output: `assetId`, `bucket`, `path`, `signedUploadUrl`, `expiresAt`

`POST /complete`
- Input: `assetId`
- Validate: object exists in storage
- Update: `video_assets.status = 'uploaded'`
- Insert: `video_jobs(status='queued')`

### 7.2 `functions/v1/video-status` (new)
`GET ?assetId=...`
- Output: `status`, `progress`, `durationMs`, `error`, `artifactsReady`

### 7.3 `functions/v1/video-worker` (new async worker)
- Poll queued jobs.
- Lock one job (`queued -> running`).
- Process and generate artifacts.
- Mark `video_assets.status` and `video_jobs.status`.

Run model:
- Trigger via pg_cron every minute, or scheduled HTTP trigger from Vercel Cron.

### 7.4 `functions/v1/router` (existing)
Add optional field:
- `videoAssetIds?: string[]`

Behavior:
- For each `videoAssetId`, require `status='ready'` and ownership.
- Load compact artifacts:
  - frame set (for multimodal context)
  - transcript summary chunk
- Inject artifacts into existing multimodal prompt path.

## 8) Processing Strategy

Recommended v1 strategy:
- Keyframes: sample at fixed interval (for example every 8-10s, max 8 frames).
- Transcript: run speech-to-text and store transcript text artifact.
- Summary: create concise transcript summary capped by char/token budget.

Why this fits current code:
- Router already handles image+text multimodal prompts.
- Video becomes "derived images + transcript text" without raw video in router payload.

## 9) Limits and Quotas (v1)
- Max upload size: 100MB (or keep 50MB until infra budget is confirmed).
- Max duration: 180s.
- Max frames sent to router per request: 8.
- Max transcript chars injected: 12,000.
- Max concurrent active jobs per user: 2.
- Max request body to router: keep existing guard, no raw video fields.

## 10) Frontend Integration Plan

## 10.1 Types
Update `prismatix-frontend/src/types.ts`:
- Add attachment kind: `image | text | video`.
- Add video metadata fields (`videoAssetId`, `durationMs`, `status`, `thumbnailUrl`).

## 10.2 Upload UX
Update `prismatix-frontend/src/components/FileUpload.tsx`:
- Allow video selection behind feature flag.
- Do not read video file into memory as text/base64.
- Call `video-intake/init`, then direct-upload to storage URL, then `video-intake/complete`.

## 10.3 Chat UX
Update `prismatix-frontend/src/components/ChatInterface.tsx`:
- Show video chip with processing state.
- Disable send for pending video, or allow send with "waiting for processing" state.
- Send `videoAssetIds` in `askPrismatix` payload once ready.

## 10.4 Fetch Layer
Update `prismatix-frontend/src/smartFetch.ts`:
- Include `videoAssetIds` in router payload.
- Keep query length guard.
- Add explicit handling for `video_not_ready` errors.

## 10.5 Storage Service
Update `prismatix-frontend/src/services/storageService.ts`:
- Keep image upload helper.
- Add video upload helper for signed URL flow and progress events.

## 11) Router Integration Plan

### 11.1 Request Schema
Update `supabase/functions/router/index.ts` request body type with `videoAssetIds?: string[]`.

### 11.2 Artifact Loading
- Resolve and validate ownership of each asset.
- Fetch frame artifacts (small subset) and transcript summary.
- Convert selected frame artifacts to the existing image attachment structure if needed.

### 11.3 Cost and Routing
Update:
- `supabase/functions/router/router_logic.ts`
- `supabase/functions/router/cost_engine.ts`

Add:
- video token heuristic (`frame_count * image_token_estimate + transcript_token_estimate`)
- processing surcharge tracking if desired.

## 12) Rollout Plan

### Phase 0: Foundations (1 day)
- [ ] Add feature flag `ENABLE_VIDEO_PIPELINE` frontend/backend.
- [ ] Add DB schema + RLS.
- [ ] Add storage buckets.

### Phase 1: Ingestion (1-2 days)
- [ ] Implement `video-intake/init` and `video-intake/complete`.
- [ ] Implement frontend signed-upload flow and progress UI.
- [ ] Implement `video-status` endpoint.

### Phase 2: Processing (2-3 days)
- [ ] Implement `video-worker` with retries and failure states.
- [ ] Keyframe extraction + transcript generation.
- [ ] Persist artifacts and mark asset `ready`.

### Phase 3: Router (1-2 days)
- [ ] Add `videoAssetIds` to router payload contract.
- [ ] Inject selected artifacts into existing multimodal provider calls.
- [ ] Add token/cost estimation updates.

### Phase 4: Hardening (1-2 days)
- [ ] Add telemetry and dashboards.
- [ ] Add quotas and abuse protections.
- [ ] Add cleanup job for orphaned uploads and expired assets.

### Phase 5: Progressive Launch (1 day)
- [ ] Internal users only.
- [ ] 10% rollout.
- [ ] 100% rollout after error/cost targets hold.

## 13) Observability and Error Codes
Standardize client-facing errors:
- `video_not_ready`
- `video_unsupported_mime`
- `video_too_large`
- `video_duration_exceeded`
- `video_processing_failed`
- `video_quota_exceeded`

Log fields:
- `asset_id`, `job_id`, `user_id`, `stage`, `latency_ms`, `provider`, `frame_count`, `transcript_chars`, `total_cost_usd`.

## 14) Security Checklist
- [ ] Private buckets only.
- [ ] Signed upload URLs short TTL.
- [ ] Ownership checks in every function.
- [ ] MIME and extension validation.
- [ ] Optional file-signature sniffing in worker.
- [ ] Size/duration limits enforced server-side.

## 15) Test Plan

Unit tests:
- MIME/size validation
- state transitions (`queued -> running -> succeeded/failed`)
- router artifact assembly logic

Integration tests:
- upload -> process -> analyze happy path
- expired URL
- processing failure and retry
- unauthorized access attempt

E2E tests:
- short MP4 upload, status polling, streamed answer
- multi-attachment request (video + image + text)
- quota exceeded path

## 16) Immediate First Implementation Slice (Recommended)
Implement this slice first to reduce risk quickly:
1. DB schema + RLS + buckets.
2. `video-intake` + `video-status`.
3. Frontend upload/status UI (no router usage yet).
4. `video-worker` keyframe-only artifacts.
5. Router consumes only keyframes (transcript in next slice).

This yields fast value while keeping complexity contained.
