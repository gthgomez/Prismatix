// Best-effort, tab-scoped copies of streamed text until the server confirms
// that its transcript was saved. These are never sent or added to history.
export interface RecoveredResponse {
  id: string;
  conversationId: string;
  model: string;
  content: string;
  updatedAt: number;
}

function prefix(userId: string): string {
  return `prismatix.response-recovery.${encodeURIComponent(userId)}.`;
}

function key(userId: string, id: string): string {
  return `${prefix(userId)}${encodeURIComponent(id)}`;
}

export function saveResponseRecovery(userId: string, response: RecoveredResponse): boolean {
  if (!response.content.trim()) return false;
  try {
    sessionStorage.setItem(key(userId, response.id), JSON.stringify(response));
    return true;
  } catch {
    return false;
  }
}

export function readResponseRecoveries(userId?: string): RecoveredResponse[] {
  if (!userId) return [];
  const responses: RecoveredResponse[] = [];
  try {
    const ownedPrefix = prefix(userId);
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const storageKey = sessionStorage.key(index);
      if (!storageKey?.startsWith(ownedPrefix)) continue;
      try {
        const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as RecoveredResponse | null;
        if (value && typeof value.id === 'string' && storageKey === key(userId, value.id)
          && typeof value.conversationId === 'string' && typeof value.model === 'string'
          && typeof value.content === 'string' && value.content.trim()
          && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) {
          responses.push(value);
        }
      } catch {
        // Ignore a malformed entry without hiding other recoverable responses.
      }
    }
  } catch {
    return [];
  }
  return responses.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeResponseRecovery(userId: string, id: string): void {
  try {
    sessionStorage.removeItem(key(userId, id));
  } catch {
    // Storage may be unavailable; the current response remains in the UI.
  }
}

/** Bound synchronous storage work while retaining the latest text for pagehide. */
export function createResponseCheckpoint(
  userId: string | undefined,
  identity: Pick<RecoveredResponse, 'id' | 'conversationId' | 'model'>,
) {
  let content = '';
  let lastWrite = 0;
  const flush = () => {
    if (!userId || !content.trim()) return;
    const now = Date.now();
    if (saveResponseRecovery(userId, { ...identity, content, updatedAt: now })) lastWrite = now;
  };
  return {
    update(next: string) {
      content = next;
      if (Date.now() - lastWrite >= 250) flush();
    },
    flush,
    clear() {
      content = '';
      if (userId) removeResponseRecovery(userId, identity.id);
    },
  };
}
