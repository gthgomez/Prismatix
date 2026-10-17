import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SpendTracker } from './SpendTracker';
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());
it('reports a failed sync truthfully and closes with Escape', async () => {
  mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<SpendTracker refreshKey={0} />));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  act(() => container.querySelector<HTMLButtonElement>('.spend-pill')!.click());
  expect(container.querySelector('.sync-indicator')?.textContent).toContain('Sync issue');
  expect(container.querySelector('.sync-indicator')?.textContent).not.toContain('Connected');
  expect(container.querySelector('[aria-label="Close spend analytics"]')).not.toBeNull();
  act(() => container.querySelector('.spend-widget')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('.spend-popover')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.spend-pill'));
  act(() => root.unmount());
  container.remove();
});

it('guards against out-of-order race conditions so stale responses do not overwrite fresher stats', async () => {
  const { CONFIG } = await import('../config');
  (CONFIG as { SUPABASE_URL: string }).SUPABASE_URL = 'https://test.supabase.co';

  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });

  vi.useFakeTimers();

  let resolveFirstFetch!: (val: unknown) => void;
  const firstPromise = new Promise((resolve) => {
    resolveFirstFetch = resolve;
  });

  let fetchCallCount = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    fetchCallCount++;
    if (fetchCallCount === 1) {
      return firstPromise;
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        today: 5.5,
        thisWeek: 15.0,
        thisMonth: 30.0,
        allTime: 100.0,
        lastMessageCost: 0.25,
        messageCount: 42,
      }),
    });
  }));

  try {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    // Initial mount triggers fetch 1 (scheduled via setTimeout 0)
    await act(async () => {
      root.render(<SpendTracker refreshKey={0} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCallCount).toBe(1);

    // Refresh trigger triggers fetch 2 (scheduled via setTimeout 0, resolves with $5.50 immediately)
    await act(async () => {
      root.render(<SpendTracker refreshKey={1} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCallCount).toBe(2);

    // Open popover to see stats
    act(() => container.querySelector<HTMLButtonElement>('.spend-pill')!.click());
    expect(container.textContent).toContain('$5.50');

    // Now resolve fetch 1 with stale data ($1.20)
    await act(async () => {
      resolveFirstFetch({
        ok: true,
        json: async () => ({
          today: 1.2,
          thisWeek: 3.0,
          thisMonth: 6.0,
          allTime: 10.0,
          lastMessageCost: 0.1,
          messageCount: 5,
        }),
      });
      await Promise.resolve();
    });

    // Stale fetch 1 MUST be discarded by the sequence guard; stats remain at fresher $5.50
    expect(container.textContent).toContain('$5.50');
    expect(container.textContent).not.toContain('$1.20');

    act(() => root.unmount());
    container.remove();
  } finally {
    vi.unstubAllGlobals();
  }
});
