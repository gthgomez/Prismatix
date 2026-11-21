import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResponseCheckpoint, readResponseRecoveries, removeResponseRecovery, saveResponseRecovery } from './responseRecovery';

const response = { id: 'execution-1', conversationId: 'conversation-1', model: 'model-a', content: 'Partial answer', updatedAt: 1 };

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('tab response recovery', () => {
  it('isolates accounts and removes only the acknowledged execution', () => {
    expect(saveResponseRecovery('account-a', response)).toBe(true);
    expect(saveResponseRecovery('account-a', { ...response, id: 'execution-2', content: 'Another answer' })).toBe(true);
    expect(saveResponseRecovery('account-b', { ...response, content: 'Private to B' })).toBe(true);

    removeResponseRecovery('account-a', 'execution-1');
    expect(readResponseRecoveries('account-a').map((item) => item.content)).toEqual(['Another answer']);
    expect(readResponseRecoveries('account-b').map((item) => item.content)).toEqual(['Private to B']);
    expect(Object.values(localStorage).join(' ')).not.toContain('Partial answer');
  });

  it('reports blocked browser storage rather than claiming a backup exists', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveResponseRecovery('account-a', response)).toBe(false);
    expect(readResponseRecoveries('account-a')).toEqual([]);
  });

  it('flushes the latest throttled content to the original account', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(1100).mockReturnValueOnce(1100);
    const checkpoint = createResponseCheckpoint('account-a', response);
    checkpoint.update('First chunk');
    checkpoint.update('First chunk and final tail');
    expect(readResponseRecoveries('account-a')[0]?.content).toBe('First chunk');
    checkpoint.flush();
    expect(readResponseRecoveries('account-a')[0]?.content).toBe('First chunk and final tail');
    expect(readResponseRecoveries('account-b')).toEqual([]);
  });
});
