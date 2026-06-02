import type { ImageAttachment, Message } from './router_logic.ts';

export const REQUEST_LIMITS = {
  maxQueryChars: 50_000,
  maxHistoryMessages: 24,
  maxHistoryMessageChars: 12_000,
  maxHistoryTotalChars: 80_000,
  maxImageAttachments: 4,
  maxImageBase64Chars: 6 * 1024 * 1024,
  maxVideoAssetIds: 4,
  maxOptionalStringChars: 512,
  maxUrlChars: 2_048,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_PLATFORMS = new Set(['web', 'mobile']);
const ALLOWED_ROLES = new Set(['user', 'assistant']);

export type RouterPlatform = 'web' | 'mobile';

export interface NormalizedRouterRequest {
  conversationId: string;
  query: string;
  platform: RouterPlatform;
  history: Message[];
  images: ImageAttachment[];
  videoAssetIds: string[];
  imageStorageUrl?: string;
  modelOverride?: string;
  geminiFlashThinkingLevel?: string;
  mode?: string;
  debateProfile?: string;
}

export type GuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export interface SpendGateInput {
  dailyTotalUsd: number;
  estimatedRequestUsd: number;
  dailyLimitUsd: number;
  perRequestLimitUsd: number;
}

export interface SpendGateDecision {
  allowed: boolean;
  status: number;
  reason?: 'request_cost_limit_exceeded' | 'daily_spend_limit_exceeded';
  dailyTotalUsd: number;
  projectedTotalUsd: number;
  dailyLimitUsd: number;
  perRequestLimitUsd: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  timestamps: number[];
  retryAfterMs?: number;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normalizeRouterRequestBody(input: unknown): GuardResult<NormalizedRouterRequest> {
  if (!isRecord(input)) {
    return reject(400, 'Bad Request: JSON body must be an object');
  }

  const rawConversationId = input.conversationId;
  if (!isUuid(rawConversationId)) {
    return reject(400, 'Bad Request: conversationId must be a valid UUID');
  }

  const rawQuery = input.query;
  if (rawQuery !== undefined && rawQuery !== null && typeof rawQuery !== 'string') {
    return reject(400, 'Bad Request: query must be a string');
  }

  const query = (rawQuery ?? '').trim();
  if (query.length > REQUEST_LIMITS.maxQueryChars) {
    return reject(413, 'Payload Too Large: query exceeds maximum length');
  }

  const historyResult = normalizeHistory(input.history);
  if (!historyResult.ok) {
    return historyResult;
  }

  const imagesResult = normalizeImages(input);
  if (!imagesResult.ok) {
    return imagesResult;
  }

  const videoAssetIdsResult = normalizeVideoAssetIds(input.videoAssetIds);
  if (!videoAssetIdsResult.ok) {
    return videoAssetIdsResult;
  }

  const platformResult = normalizePlatform(input.platform);
  if (!platformResult.ok) {
    return platformResult;
  }

  const imageStorageUrlResult = optionalString(input.imageStorageUrl, 'imageStorageUrl', REQUEST_LIMITS.maxUrlChars);
  if (!imageStorageUrlResult.ok) {
    return imageStorageUrlResult;
  }

  const modelOverrideResult = optionalString(input.modelOverride, 'modelOverride');
  if (!modelOverrideResult.ok) {
    return modelOverrideResult;
  }

  const thinkingResult = optionalString(input.geminiFlashThinkingLevel, 'geminiFlashThinkingLevel');
  if (!thinkingResult.ok) {
    return thinkingResult;
  }

  const modeResult = optionalString(input.mode, 'mode');
  if (!modeResult.ok) {
    return modeResult;
  }

  const debateProfileResult = optionalString(input.debateProfile, 'debateProfile');
  if (!debateProfileResult.ok) {
    return debateProfileResult;
  }

  return {
    ok: true,
    value: {
      conversationId: rawConversationId,
      query,
      platform: platformResult.value,
      history: historyResult.value,
      images: imagesResult.value,
      videoAssetIds: videoAssetIdsResult.value,
      imageStorageUrl: imageStorageUrlResult.value,
      modelOverride: modelOverrideResult.value,
      geminiFlashThinkingLevel: thinkingResult.value,
      mode: modeResult.value,
      debateProfile: debateProfileResult.value,
    },
  };
}

export function evaluateSpendGate(input: SpendGateInput): SpendGateDecision {
  const dailyTotalUsd = sanitizeUsd(input.dailyTotalUsd);
  const estimatedRequestUsd = sanitizeUsd(input.estimatedRequestUsd);
  const dailyLimitUsd = sanitizeUsd(input.dailyLimitUsd);
  const perRequestLimitUsd = sanitizeUsd(input.perRequestLimitUsd);
  const projectedTotalUsd = dailyTotalUsd + estimatedRequestUsd;

  if (perRequestLimitUsd > 0 && estimatedRequestUsd > perRequestLimitUsd) {
    return {
      allowed: false,
      status: 402,
      reason: 'request_cost_limit_exceeded',
      dailyTotalUsd,
      projectedTotalUsd,
      dailyLimitUsd,
      perRequestLimitUsd,
    };
  }

  if (dailyLimitUsd > 0 && projectedTotalUsd > dailyLimitUsd) {
    return {
      allowed: false,
      status: 402,
      reason: 'daily_spend_limit_exceeded',
      dailyTotalUsd,
      projectedTotalUsd,
      dailyLimitUsd,
      perRequestLimitUsd,
    };
  }

  return {
    allowed: true,
    status: 200,
    dailyTotalUsd,
    projectedTotalUsd,
    dailyLimitUsd,
    perRequestLimitUsd,
  };
}

export function evaluateRateLimit(
  previousTimestamps: number[],
  nowMs: number,
  windowMs: number,
  maxRequests: number,
): RateLimitDecision {
  if (windowMs <= 0 || maxRequests <= 0) {
    return { allowed: true, timestamps: [] };
  }

  const windowStartMs = nowMs - windowMs;
  const timestamps = previousTimestamps.filter((timestamp) => timestamp > windowStartMs);

  if (timestamps.length >= maxRequests) {
    const oldest = Math.min(...timestamps);
    return {
      allowed: false,
      timestamps,
      retryAfterMs: Math.max(0, oldest + windowMs - nowMs),
    };
  }

  timestamps.push(nowMs);
  return { allowed: true, timestamps };
}

function normalizeHistory(input: unknown): GuardResult<Message[]> {
  if (input === undefined || input === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(input)) {
    return reject(400, 'Bad Request: history must be an array');
  }

  if (input.length > REQUEST_LIMITS.maxHistoryMessages) {
    return reject(413, 'Payload Too Large: history has too many messages');
  }

  let totalChars = 0;
  const history: Message[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      return reject(400, 'Bad Request: each history item must be an object');
    }

    if (typeof item.role !== 'string' || !ALLOWED_ROLES.has(item.role)) {
      return reject(400, 'Bad Request: history role must be user or assistant');
    }

    if (typeof item.content !== 'string') {
      return reject(400, 'Bad Request: history content must be a string');
    }

    if (item.content.length > REQUEST_LIMITS.maxHistoryMessageChars) {
      return reject(413, 'Payload Too Large: history message exceeds maximum length');
    }

    totalChars += item.content.length;
    if (totalChars > REQUEST_LIMITS.maxHistoryTotalChars) {
      return reject(413, 'Payload Too Large: history exceeds maximum length');
    }

    history.push({ role: item.role as Message['role'], content: item.content });
  }

  return { ok: true, value: history };
}

function normalizeImages(input: Record<string, unknown>): GuardResult<ImageAttachment[]> {
  if (input.images !== undefined && input.images !== null) {
    if (!Array.isArray(input.images)) {
      return reject(400, 'Bad Request: images must be an array');
    }

    if (input.images.length > REQUEST_LIMITS.maxImageAttachments) {
      return reject(413, 'Payload Too Large: too many image attachments');
    }

    const images: ImageAttachment[] = [];
    for (const image of input.images) {
      const imageResult = normalizeImageAttachment(image);
      if (!imageResult.ok) {
        return imageResult;
      }
      images.push(imageResult.value);
    }
    return { ok: true, value: images };
  }

  if (input.imageData === undefined || input.imageData === null) {
    return { ok: true, value: [] };
  }

  const legacyImageResult = normalizeImageAttachment({
    data: input.imageData,
    mediaType: input.imageMediaType ?? input.mediaType,
  });
  if (!legacyImageResult.ok) {
    return legacyImageResult;
  }

  return { ok: true, value: [legacyImageResult.value] };
}

function normalizeImageAttachment(input: unknown): GuardResult<ImageAttachment> {
  if (!isRecord(input)) {
    return reject(400, 'Bad Request: image attachment must be an object');
  }

  if (typeof input.data !== 'string') {
    return reject(400, 'Bad Request: image data must be a string');
  }

  if (input.data.length === 0) {
    return reject(400, 'Bad Request: image data must not be empty');
  }

  if (input.data.length > REQUEST_LIMITS.maxImageBase64Chars) {
    return reject(413, 'Payload Too Large: image attachment exceeds maximum length');
  }

  if (input.data.startsWith('data:') || !BASE64_RE.test(input.data)) {
    return reject(400, 'Bad Request: image data must be base64 content without a data URL prefix');
  }

  const mediaType = input.mediaType === undefined || input.mediaType === null ? 'image/png' : input.mediaType;
  if (typeof mediaType !== 'string' || !ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    return reject(400, 'Bad Request: unsupported image media type');
  }

  return { ok: true, value: { data: input.data, mediaType } };
}

function normalizeVideoAssetIds(input: unknown): GuardResult<string[]> {
  if (input === undefined || input === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(input)) {
    return reject(400, 'Bad Request: videoAssetIds must be an array');
  }

  if (input.length > REQUEST_LIMITS.maxVideoAssetIds) {
    return reject(413, 'Payload Too Large: too many video assets');
  }

  const videoAssetIds: string[] = [];
  for (const value of input) {
    if (!isUuid(value)) {
      return reject(400, 'Bad Request: videoAssetIds must contain valid UUIDs');
    }
    videoAssetIds.push(value);
  }

  return { ok: true, value: videoAssetIds };
}

function normalizePlatform(input: unknown): GuardResult<RouterPlatform> {
  if (input === undefined || input === null) {
    return { ok: true, value: 'web' };
  }

  if (typeof input !== 'string' || !ALLOWED_PLATFORMS.has(input)) {
    return reject(400, 'Bad Request: platform must be web or mobile');
  }

  return { ok: true, value: input as RouterPlatform };
}

function optionalString(
  input: unknown,
  fieldName: string,
  maxChars: number = REQUEST_LIMITS.maxOptionalStringChars,
): GuardResult<string | undefined> {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: undefined };
  }

  if (typeof input !== 'string') {
    return reject(400, `Bad Request: ${fieldName} must be a string`);
  }

  if (input.length > maxChars) {
    return reject(413, `Payload Too Large: ${fieldName} exceeds maximum length`);
  }

  return { ok: true, value: input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeUsd(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function reject(status: number, error: string): GuardResult<never> {
  return { ok: false, status, error };
}
