// PX07 conversation attachment references.
//
// The persisted JSONB element shape on `public.messages.attachments` is
// deliberately tiny and Deno-free so it can be shared by the router, the SQL
// write path (shape mirrored there), and the web client:
//
//   { ordinal, kind: 'image'|'video', storageRef, videoAssetId, available }
//
// Image refs are private `supabase://chat-uploads/<subject>/<path>` references
// (never base64, never a signed URL, never another subject's path). Video refs
// carry a `video_assets` id whose ownership is enforced by the write RPC.

export interface AttachmentRef {
  ordinal: number;
  kind: 'image' | 'video';
  storageRef: string | null;
  videoAssetId: string | null;
  available: boolean;
}

export interface ParsedStorageReference {
  bucket: string;
  path: string;
}

const STORAGE_SCHEME = 'supabase://';
export const CHAT_UPLOADS_BUCKET = 'chat-uploads';

/**
 * Parses a `supabase://<bucket>/<path>` private reference. Returns null for a
 * bare path, another scheme, or a reference missing a bucket or a path.
 */
export function parseStorageReference(ref: unknown): ParsedStorageReference | null {
  if (typeof ref !== 'string' || !ref.startsWith(STORAGE_SCHEME)) return null;
  const rest = ref.slice(STORAGE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (bucket.length === 0 || path.length === 0) return null;
  return { bucket, path };
}

/**
 * True when the reference is a private chat-uploads object under the subject's
 * own folder (images) or carries a video asset id (videos). Video asset
 * ownership is additionally enforced against `video_assets` by the write RPC.
 */
export function attachmentRefIsOwned(ref: AttachmentRef, subjectId: string): boolean {
  if (ref.kind === 'image') {
    const parsed = parseStorageReference(ref.storageRef);
    if (!parsed) return false;
    if (parsed.bucket !== CHAT_UPLOADS_BUCKET) return false;
    return parsed.path.startsWith(`${subjectId}/`);
  }
  if (ref.kind === 'video') {
    return typeof ref.videoAssetId === 'string' && ref.videoAssetId.length > 0;
  }
  return false;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Coerces untrusted persisted/JSONB input into the canonical element list.
 * Unknown kinds are dropped and ordinals are reset to the resulting array
 * position (0..n-1) so a corrupted ordinal can never reorder the display.
 */
export function normalizeAttachments(input: unknown): AttachmentRef[] {
  if (!Array.isArray(input)) return [];
  const normalized: AttachmentRef[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.kind !== 'image' && record.kind !== 'video') continue;
    normalized.push({
      ordinal: normalized.length,
      kind: record.kind,
      storageRef: asStringOrNull(record.storageRef),
      videoAssetId: asStringOrNull(record.videoAssetId),
      available: record.available === true,
    });
  }
  return normalized;
}
