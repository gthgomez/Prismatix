// Single source of truth for SSE parsing lives in
// supabase/functions/_shared/sse_parser.ts. This module re-exports it for the
// browser client (same pattern as src/pricingRegistry.ts -> _shared/model_tariff).
// The client must never define a second parser.
export {
  createSseParser,
  encodeSseEvent,
  encodeSseComment,
  isDoneData,
  type SseEvent,
  type SseParser,
} from '../supabase/functions/_shared/sse_parser';
