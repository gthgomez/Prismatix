export interface ChatListPreferences {
  density: 'compact' | 'comfortable';
  width: number;
}

export const DEFAULT_CHAT_LIST_PREFERENCES: ChatListPreferences = { density: 'compact', width: 296 };
export const MIN_CHAT_LIST_WIDTH = 260;
export const MAX_CHAT_LIST_WIDTH = 360;

export function clampChatListWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.min(MAX_CHAT_LIST_WIDTH, Math.max(MIN_CHAT_LIST_WIDTH, Math.round(width)))
    : DEFAULT_CHAT_LIST_PREFERENCES.width;
}

export function readChatListPreferences(scope?: string | null): ChatListPreferences {
  if (!scope) return { ...DEFAULT_CHAT_LIST_PREFERENCES };
  try {
    const saved = JSON.parse(localStorage.getItem(`prismatix:chat-list:${scope}`) ?? 'null');
    return {
      density: saved?.density === 'comfortable' ? 'comfortable' : 'compact',
      width: typeof saved?.width === 'number' ? clampChatListWidth(saved.width) : DEFAULT_CHAT_LIST_PREFERENCES.width,
    };
  } catch {
    return { ...DEFAULT_CHAT_LIST_PREFERENCES };
  }
}

export function saveChatListPreferences(scope: string | null | undefined, preferences: ChatListPreferences): void {
  if (!scope) return;
  try {
    localStorage.setItem(`prismatix:chat-list:${scope}`, JSON.stringify(preferences));
  } catch {
    // Display preferences still work for this mount when storage is unavailable.
  }
}

/** Group and label use the same local calendar boundaries, including DST days. */
export function describeChatActivity(value: string, now = new Date()): { group: string; label: string; full: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { group: 'Earlier', label: '', full: 'Activity date unavailable' };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const recent = new Date(today); recent.setDate(recent.getDate() - 6);
  const full = date.toLocaleString();
  if (date >= today) {
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
    const label = minutes < 0 ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
    return { group: 'Today', label, full };
  }
  if (date >= yesterday) return { group: 'Yesterday', label: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), full };
  if (date >= recent) return { group: 'Last 7 days', label: date.toLocaleDateString([], { weekday: 'short' }), full };
  return { group: 'Earlier', label: date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }), full };
}
