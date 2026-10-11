import { supabase } from "../lib/supabase";
import { CONFIG } from "../config";

export interface MemoryRecord {
  id: string;
  text: string;
  kind: string;
  basis: string;
  sources: { conversation_id?: string; message_id?: string }[];
}
export interface MemoryStatus {
  entitled: boolean;
  enabled: boolean;
  setting_enabled: boolean;
  forget_on_chat_delete: boolean;
  count: number;
  last_saved_at: string | null;
  jobs: { id: string; state: string; error_code: string | null }[];
}
export async function memoryRequest<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to manage memory.");
  if (!CONFIG.MEMORY_ENDPOINT) throw new Error("Memory is unavailable.");
  const response = await fetch(CONFIG.MEMORY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
    },
    body: JSON.stringify({ action, ...args }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("Memory could not be updated. Please try again.");
  }
  return await response.json() as T;
}
