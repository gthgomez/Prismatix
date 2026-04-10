// video_helpers.ts - Video asset validation and context block building

import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_VIDEO_ASSETS_PER_REQUEST = 4;
const VIDEO_CONTEXT_MAX_ARTIFACT_ROWS = 36;

// ============================================================================
// TYPES
// ============================================================================

interface VideoAssetReadyRecord {
  id: string;
  user_id: string;
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'expired';
}

interface VideoArtifactRecord {
  asset_id: string;
  kind: 'thumbnail' | 'frame' | 'transcript' | 'summary';
  seq: number | null;
  text_content: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface VideoAssetContextRecord {
  id: string;
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'expired';
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  updated_at: string | null;
}

// ============================================================================
// VALIDATION
// ============================================================================

export async function validateReadyVideoAssets(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  videoAssetIds: string[],
  enableVideoPipeline: boolean,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (videoAssetIds.length === 0) {
    return { ok: true, ids: [] };
  }

  const uniqueIds = [...new Set(videoAssetIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (uniqueIds.length === 0) {
    return { ok: true, ids: [] };
  }

  if (!enableVideoPipeline) {
    return { ok: false, error: 'video_pipeline_disabled' };
  }

  if (uniqueIds.length > MAX_VIDEO_ASSETS_PER_REQUEST) {
    return { ok: false, error: 'video_too_many_assets' };
  }

  const { data, error } = await supabase
    .from('video_assets')
    .select('id, user_id, status')
    .in('id', uniqueIds);

  if (error) {
    console.error('[Video] validate assets query failed:', error);
    return { ok: false, error: 'video_validation_failed' };
  }

  const rows = (data || []) as VideoAssetReadyRecord[];
  if (rows.length !== uniqueIds.length) {
    return { ok: false, error: 'video_not_ready' };
  }

  const allReady = rows.every((row) => row.user_id === userId && row.status === 'ready');
  if (!allReady) {
    return { ok: false, error: 'video_not_ready' };
  }

  return { ok: true, ids: uniqueIds };
}

// ============================================================================
// CONTEXT BLOCK BUILDING
// ============================================================================

function resolveArtifactTimestampSec(
  metadata: Record<string, unknown> | null,
  seq: number | null,
): number | null {
  const fromSec = metadata?.timestamp_sec ?? metadata?.timestamp_s ?? metadata?.time_sec;
  if (typeof fromSec === 'number' && Number.isFinite(fromSec) && fromSec >= 0) return fromSec;

  const fromMs = metadata?.timestamp_ms ?? metadata?.time_ms;
  if (typeof fromMs === 'number' && Number.isFinite(fromMs) && fromMs >= 0) return fromMs / 1000;

  if (typeof seq === 'number' && Number.isFinite(seq) && seq >= 0) {
    return seq * 5;
  }
  return null;
}

function clampText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}...`;
}

function truncateWithEllipsis(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function compactVideoStatusLine(asset: VideoAssetContextRecord): string {
  const durationSec = typeof asset.duration_ms === 'number' && Number.isFinite(asset.duration_ms)
    ? Math.max(0, Math.round(asset.duration_ms / 1000))
    : null;
  const dim = asset.width && asset.height ? `${asset.width}x${asset.height}` : 'unknown-dimensions';
  const durationLabel = durationSec !== null ? `${durationSec}s` : 'unknown-duration';
  return `asset=${asset.id} status=${asset.status} duration=${durationLabel} dimensions=${dim}`;
}

function compactArtifactLine(row: VideoArtifactRecord): string | null {
  const textFromMetadata = typeof row.metadata?.caption === 'string'
    ? row.metadata.caption
    : typeof row.metadata?.summary === 'string'
    ? row.metadata.summary
    : '';
  const rawText = (row.text_content || textFromMetadata || '').trim();
  if (!rawText) return null;
  const timestampSec = resolveArtifactTimestampSec(row.metadata, row.seq);
  const tsLabel = typeof timestampSec === 'number' ? `t=${timestampSec.toFixed(1)}s ` : '';
  return `[${row.asset_id}] ${row.kind} ${tsLabel}${clampText(rawText, 240)}`;
}

export async function buildVideoContextBlock(
  supabase: ReturnType<typeof createClient>,
  videoAssetIds: string[],
  maxChars: number,
): Promise<string> {
  if (videoAssetIds.length === 0) return '';

  const lines: string[] = [];

  const { data: assetsData, error: assetsError } = await supabase
    .from('video_assets')
    .select('id, status, duration_ms, width, height, updated_at')
    .in('id', videoAssetIds)
    .order('updated_at', { ascending: false });

  if (assetsError) {
    console.warn('[Video] asset context lookup failed:', assetsError);
  } else {
    const assets = (assetsData || []) as VideoAssetContextRecord[];
    for (const asset of assets) {
      lines.push(compactVideoStatusLine(asset));
    }
  }

  const { data: artifactsData, error: artifactsError } = await supabase
    .from('video_artifacts')
    .select('asset_id, kind, seq, text_content, metadata, created_at')
    .in('asset_id', videoAssetIds)
    .order('asset_id', { ascending: true })
    .order('seq', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(VIDEO_CONTEXT_MAX_ARTIFACT_ROWS);

  if (artifactsError) {
    console.warn('[Video] artifact context lookup failed:', artifactsError);
  } else {
    const rows = (artifactsData || []) as VideoArtifactRecord[];
    for (const row of rows) {
      const line = compactArtifactLine(row);
      if (line) lines.push(line);
    }
  }

  if (lines.length === 0) return '';

  const block = [
    '### Video Context',
    'Use these extracted video artifacts as ground truth context.',
    ...lines,
    '### End Video Context',
  ].join('\n');

  return truncateWithEllipsis(block, maxChars);
}

export async function buildVideoUiNotesJson(
  supabase: ReturnType<typeof createClient>,
  videoAssetIds: string[],
  maxChars: number,
): Promise<string | null> {
  if (videoAssetIds.length === 0) return null;

  const { data, error } = await supabase
    .from('video_artifacts')
    .select('asset_id, kind, seq, text_content, metadata, created_at')
    .in('asset_id', videoAssetIds)
    .order('asset_id', { ascending: true })
    .order('seq', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[Debate][video_ui] artifact lookup failed:', error);
    return null;
  }

  const rows = (data || []) as VideoArtifactRecord[];
  const artifacts = rows.slice(0, 48).map((row) => {
    const textFromMetadata = typeof row.metadata?.caption === 'string'
      ? row.metadata.caption
      : typeof row.metadata?.summary === 'string'
      ? row.metadata.summary
      : '';
    const text = clampText((row.text_content || textFromMetadata || '').trim(), 260);
    return {
      asset_id: row.asset_id,
      kind: row.kind,
      seq: row.seq,
      timestamp_sec: resolveArtifactTimestampSec(row.metadata, row.seq),
      created_at: row.created_at,
      text,
    };
  }).filter((a) => a.text.length > 0);

  const payload = {
    schema_version: 'video_ui_notes_v1',
    video_asset_ids: videoAssetIds,
    artifacts,
    note: 'Use only these extracted notes. Unseen footage should be marked unknown.',
  };

  let json = JSON.stringify(payload);
  if (json.length <= maxChars) return json;

  const compact = {
    schema_version: 'video_ui_notes_v1',
    video_asset_ids: videoAssetIds,
    artifacts: artifacts.slice(0, 12).map((a) => ({ ...a, text: clampText(a.text, 120) })),
    truncated: true,
  };
  json = JSON.stringify(compact);
  if (json.length <= maxChars) return json;

  return JSON.stringify({
    schema_version: 'video_ui_notes_v1',
    video_asset_ids: videoAssetIds,
    artifacts: [],
    truncated: true,
  });
}
