import React, { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config';
import { supabase } from '../lib/supabase';
import {
  downloadSpendCsv,
  fetchAuthoritativeCostLogs,
  filterAndGroupSpend,
  getFinanceStore,
  type DateRangeFilter,
  type GroupByFilter,
  type SpendStats,
} from '../services/financeTracker';

interface SpendTrackerProps {
  refreshKey: number;
  userId?: string;
}

const EMPTY_STATS: SpendStats = {
  today: 0,
  thisWeek: 0,
  thisMonth: 0,
  allTime: 0,
  lastMessageCost: 0,
  messageCount: 0,
};

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type SpendPeriod = 'today' | 'thisWeek' | 'thisMonth' | 'allTime';
type SpendQualification = { settled: number; pending: number; estimatedLegacy: number };
type QualifiedSpend = Record<SpendPeriod, SpendQualification>;

function parseQualifiedSpend(value: unknown): QualifiedSpend | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const result = {} as QualifiedSpend;
  for (const period of ['today', 'thisWeek', 'thisMonth', 'allTime'] as const) {
    const bucket = input[period];
    if (!bucket || typeof bucket !== 'object') return null;
    const fields = bucket as Record<string, unknown>;
    const settled = nonNegativeNumber(fields.settled);
    const pending = nonNegativeNumber(fields.pending);
    const estimatedLegacy = nonNegativeNumber(fields.estimatedLegacy);
    if (settled === null || pending === null || estimatedLegacy === null) return null;
    result[period] = { settled, pending, estimatedLegacy };
  }
  return result;
}

const SpendCard: React.FC<{ label: string; value: number | null; qualified?: SpendQualification }> = ({ label, value, qualified }) => (
  <div className='spend-card'>
    <div className='spend-label'>{label}</div>
    <div className='spend-value'>{value === null ? '—' : `$${value.toFixed(4)}`}</div>
    {qualified && <div className='spend-card-breakdown'>
      <span>Recorded as settled ${qualified.settled.toFixed(4)}</span>
      <span>Pending ${qualified.pending.toFixed(4)}</span>
      <span>Legacy estimate ${qualified.estimatedLegacy.toFixed(4)}</span>
    </div>}
  </div>
);

export const SpendTracker: React.FC<SpendTrackerProps> = ({ refreshKey, userId }) => {
  const [stats, setStats] = useState<SpendStats>(EMPTY_STATS);
  const [qualifiedStats, setQualifiedStats] = useState<QualifiedSpend | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'breakdown'>('overview');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [groupBy, setGroupBy] = useState<GroupByFilter>('model');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('syncing');
  const [syncMessage, setSyncMessage] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [exportError, setExportError] = useState('');
  const refreshCycleRef = useRef(0);
  const refreshTimersRef = useRef<number[]>([]);
  const activeRequestIdRef = useRef(0);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const fetchServerStats = async (): Promise<{ stats: SpendStats; qualified: QualifiedSpend | null } | null> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token || !CONFIG.SUPABASE_URL || (userId && session.user?.id !== userId)) {
      return null;
    }

    const base = CONFIG.SUPABASE_URL.replace(/\/$/, '');
    const endpoint = `${base}/functions/v1/spend_stats`;

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
        },
      });

      if (!response.ok) return null;

      const data = await response.json() as Record<string, unknown>;
      const today = nonNegativeNumber(data.today);
      const thisWeek = nonNegativeNumber(data.thisWeek);
      const thisMonth = nonNegativeNumber(data.thisMonth);
      const allTime = nonNegativeNumber(data.allTime);
      const lastMessageCost = nonNegativeNumber(data.lastMessageCost);
      const messageCount = nonNegativeNumber(data.messageCount);
      if (today === null || thisWeek === null || thisMonth === null || allTime === null
        || lastMessageCost === null || messageCount === null || !Number.isSafeInteger(messageCount)) return null;
      return {
        stats: { today, thisWeek, thisMonth, allTime, lastMessageCost, messageCount },
        qualified: parseQualifiedSpend(data.qualified),
      };
    } catch {
      return null;
    }
  };

  const refreshStats = async () => {
    const requestId = ++activeRequestIdRef.current;
    setSyncState('syncing');
    setSyncMessage('');

    const serverStats = await fetchServerStats();
    if (activeRequestIdRef.current !== requestId) {
      return;
    }

    if (serverStats) {
      setStats(serverStats.stats);
      setQualifiedStats(serverStats.qualified);
      setSyncState('idle');
      setLastSyncAt(Date.now());
      return;
    }

    setSyncState('error');
    setSyncMessage('Unable to sync spend right now.');
  };

  useEffect(() => {
    refreshCycleRef.current += 1;
    const cycleId = refreshCycleRef.current;

    for (const timeoutId of refreshTimersRef.current) {
      window.clearTimeout(timeoutId);
    }
    refreshTimersRef.current = [];

    // Poll a few times after refresh requests to absorb eventual DB consistency.
    const retryDelaysMs = [0, 450, 1200, 2500];
    for (const delay of retryDelaysMs) {
      const timeoutId = window.setTimeout(() => {
        if (refreshCycleRef.current !== cycleId) return;
        void refreshStats();
      }, delay);
      refreshTimersRef.current.push(timeoutId);
    }

    return () => {
      for (const timeoutId of refreshTimersRef.current) {
        window.clearTimeout(timeoutId);
      }
      refreshTimersRef.current = [];
    };
  }, [refreshKey, userId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!widgetRef.current) return;
      if (!widgetRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const stateLabel = syncState === 'syncing'
    ? 'Syncing'
    : syncState === 'error'
      ? (lastSyncAt ? 'Stale' : 'Unavailable')
      : 'Server';
  const popoverStatus =
    syncState === 'syncing' ? 'Syncing' : syncState === 'error' ? 'Sync issue' : 'Server data';
  // Zero spend is secondary information: keep it readable but visually quiet so
  // the routing mode (the thing that actually changes behaviour) leads.
  const isQuiet = stats.today === 0 && syncState !== 'error';

  return (
    <div className='spend-widget' ref={widgetRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen && !event.defaultPrevented) {
        event.stopPropagation();
        close();
      }
    }}>
      <button
        type='button'
        className={`spend-pill${isQuiet ? ' is-quiet' : ''}`}
        ref={triggerRef}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        title='View spend analytics; server totals can include pending and estimated costs'
      >
        <span className='spend-pill-value'>
          {lastSyncAt ? `$${stats.today.toFixed(2)}` : '—'}
        </span>
        <span className='spend-pill-label'>Today</span>
        <span
          className={`spend-pill-state ${
            syncState === 'syncing' ? 'syncing' : syncState === 'error' ? 'error' : 'idle'
          }`}
        >
          {stateLabel}
        </span>
      </button>

      {isOpen && (
        <aside className='spend-popover'>
          <div className="spend-popover-header">
            <h3>Spend Analytics</h3>
            <div className={`sync-indicator ${syncState}`}>
              {syncState === 'syncing' && <div className="sync-spinner" />}
              <span>{popoverStatus}</span>
            </div>
            <button type='button' className='popover-close' aria-label='Close spend analytics' onClick={close}>×</button>
          </div>
          <p className='spend-qualification-note'>Server totals include pending and estimated costs where present. {qualifiedStats ? 'Older recorded costs may include estimates; records may be incomplete or briefly out of sync.' : 'Confirmed spending is not separated in this view.'}</p>

          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.85rem' }}>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              style={{
                flex: 1,
                padding: '0.3rem 0.5rem',
                minHeight: '44px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: activeTab === 'overview' ? 'var(--color-primary)' : 'var(--color-border-strong)',
                background: activeTab === 'overview' ? 'var(--color-primary-dim)' : 'transparent',
                color: activeTab === 'overview' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                cursor: 'pointer',
              }}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('breakdown')}
              style={{
                flex: 1,
                padding: '0.3rem 0.5rem',
                minHeight: '44px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: activeTab === 'breakdown' ? 'var(--color-primary)' : 'var(--color-border-strong)',
                background: activeTab === 'breakdown' ? 'var(--color-primary-dim)' : 'transparent',
                color: activeTab === 'breakdown' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                cursor: 'pointer',
              }}
            >
              Breakdown
            </button>
          </div>

          {activeTab === 'overview' ? (
            <>
              <div className='spend-grid'>
                <SpendCard label='Today' value={lastSyncAt ? stats.today : null} qualified={qualifiedStats?.today} />
                <SpendCard label='This Week' value={lastSyncAt ? stats.thisWeek : null} qualified={qualifiedStats?.thisWeek} />
                <SpendCard label='This Month' value={lastSyncAt ? stats.thisMonth : null} qualified={qualifiedStats?.thisMonth} />
                <SpendCard label='All Time' value={lastSyncAt ? stats.allTime : null} qualified={qualifiedStats?.allTime} />
              </div>

              <div className="spend-divider" />

              <div className='spend-last'>
                <div className="last-msg-row">
                  <span className="label">Last message</span>
                  <span className="value">{lastSyncAt ? `$${stats.lastMessageCost.toFixed(6)}` : '—'}</span>
                </div>
                <div className="msg-count-row">
                  <span className="label">Total messages</span>
                  <span className="value">{lastSyncAt ? stats.messageCount : '—'}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="spend-breakdown-section" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <select
                  aria-label="Filter date range"
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-field-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    minHeight: '44px',
                    minWidth: 0,
                    padding: '0.25rem 0.4rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>

                <select
                  aria-label="Group spend by"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupByFilter)}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-field-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    minHeight: '44px',
                    minWidth: 0,
                    padding: '0.25rem 0.4rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <option value="model">By Model</option>
                  <option value="provider">By Provider</option>
                  <option value="conversation">By Conversation</option>
                </select>
              </div>

              {(() => {
                const store = getFinanceStore(userId);
                const grouped = filterAndGroupSpend(store.history, dateRange, groupBy);
                if (grouped.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '1rem 0' }}>
                      No spend records for this selection.
                    </div>
                  );
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto' }}>
                    {grouped.map((g) => (
                      <div
                        key={g.groupKey}
                        style={{
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '0.4rem 0.6rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{g.groupKey}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {g.count} turn{g.count > 1 ? 's' : ''} • Locally marked settled: ${g.settledCost.toFixed(4)}
                            {g.estimatedCost > 0 && ` • Est: $${g.estimatedCost.toFixed(4)}`}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: 'var(--color-primary, #4ecdc4)' }}>
                          ${g.totalCost.toFixed(4)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div style={{ marginTop: '0.5rem', fontSize: '0.65rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Breakdown uses a local browser cache and may be incomplete or stale. Server totals include pending and estimated costs where present.
              </div>

              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                * Local settled labels reflect client receipts and can be stale or incomplete. Provider invoices may differ.
              </div>
            </div>
          )}

          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              className="spend-csv-btn"
              onClick={async () => {
                setExportError('');
                try {
                  const logs = await fetchAuthoritativeCostLogs(supabase);
                  downloadSpendCsv(logs);
                } catch {
                  setExportError('Server cost records could not be loaded. Retry when connected.');
                }
              }}
              style={{
                background: 'rgba(78, 205, 196, 0.1)',
                border: '1px solid rgba(78, 205, 196, 0.3)',
                color: 'var(--color-primary, #4ecdc4)',
                padding: '0.4rem 0.85rem',
                minHeight: '44px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
              }}
            >
              📥 Export Spend CSV
            </button>
          </div>

          <div className='spend-sync-note'>
            {exportError ? <span className="error-text">{exportError}</span> : null}
            {syncState === 'error' ? (
              <span className="error-text">
                ⚠️ {syncMessage} {lastSyncAt && `Showing server data from ${new Date(lastSyncAt).toLocaleTimeString()}.`}
                <button
                  type="button"
                  className="spend-retry-btn"
                  onClick={() => void refreshStats()}
                  style={{ marginLeft: '0.5rem', background: 'none', border: 'none', color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}
                >
                  Retry
                </button>
              </span>
            ) : (
              lastSyncAt && `Last synced at ${new Date(lastSyncAt).toLocaleTimeString()}`
            )}
          </div>
        </aside>
      )}

      <style>{`
        .spend-widget {
          position: relative;
          font-family: 'Berkeley Mono', 'JetBrains Mono', 'Fira Code', monospace;
        }

        .spend-pill {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.4rem 0.65rem;
          background: var(--color-border-subtle);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text);
          cursor: pointer;
          transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1),
            border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .spend-pill:hover {
          background: var(--color-border);
          border-color: var(--color-primary);
        }

        .spend-pill-value {
          font-weight: 700;
          color: var(--color-primary);
          font-size: 0.85rem;
        }

        /* Zero-value status is secondary: muted tokens, no accent fill. */
        .spend-pill.is-quiet .spend-pill-value {
          color: var(--color-text-dim);
        }

        .spend-pill-label {
          font-size: 0.65rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .spend-pill-state {
          font-size: 0.6rem;
          padding: 1px 5px;
          border-radius: 4px;
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-muted);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .spend-pill-state.syncing {
          background: rgba(255, 196, 70, 0.1);
          border-color: rgba(255, 196, 70, 0.45);
          color: var(--color-warning);
          animation: pulse 1.5s infinite;
        }

        .spend-pill-state.error {
          background: rgba(255, 107, 107, 0.1);
          border-color: rgba(255, 107, 107, 0.45);
          color: var(--color-danger);
        }

        @media (prefers-reduced-motion: reduce) {
          .spend-pill-state.syncing { animation: none; }
        }

        .spend-popover {
          position: absolute;
          top: calc(100% + 12px);
          right: 0;
          width: 300px;
          background: var(--color-surface-elevated);
          border: 1px solid var(--color-border);
          border-radius: 1rem;
          padding: 1.25rem;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          backdrop-filter: blur(20px);
          animation: dropdownIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @media (max-width: 480px) {
          .spend-popover {
            position: fixed;
            top: calc(var(--prismatix-chat-header-h, 4rem) + 0.5rem);
            left: 0.5rem;
            right: 0.5rem;
            box-sizing: border-box;
            width: auto;
            max-height: calc(100dvh - var(--prismatix-chat-header-h, 4rem) - 1rem);
            overflow-y: auto;
          }
        }

        .spend-popover-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 1.25rem;
        }

        .spend-popover .popover-close {
          flex-shrink: 0;
          width: 44px;
          height: 44px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--color-text-dim);
          cursor: pointer;
          font-size: 1.2rem;
        }

        .sync-indicator.error { color: var(--color-danger); }

        .spend-qualification-note {
          margin: 0 0 0.85rem;
          color: var(--color-text-dim);
          font-size: 0.75rem;
          line-height: 1.4;
        }

        .spend-popover h3 {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--color-text);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sync-indicator {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.6rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sync-spinner {
          width: 8px;
          height: 8px;
          border: 1.5px solid rgba(78, 205, 196, 0.2);
          border-top-color: #4ECDC4;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .spend-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
          margin-bottom: 1.25rem;
        }

        .spend-card {
          padding: 0.75rem;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 0.75rem;
          transition: border-color 0.2s;
        }

        .spend-card:hover {
          border-color: rgba(78, 205, 196, 0.3);
        }

        .spend-card-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          margin-top: 0.45rem;
          color: var(--color-text-dim);
          font-size: 0.75rem;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .spend-label {
          font-size: 0.6rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
        }

        .spend-value {
          font-size: 1rem;
          font-weight: 700;
          color: var(--color-text);
        }

        .spend-divider {
          height: 1px;
          background: var(--color-border);
          margin: 1.25rem 0;
        }

        .spend-last {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .last-msg-row, .msg-count-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
        }

        .last-msg-row .label, .msg-count-row .label {
          color: var(--color-text-muted);
        }

        .last-msg-row .value {
          color: var(--color-danger);
          font-weight: 600;
        }

        .msg-count-row .value {
          color: var(--color-text);
          font-weight: 600;
        }

        .spend-sync-note {
          font-size: 0.65rem;
          color: var(--color-text-muted);
          text-align: center;
          font-style: italic;
        }

        .error-text {
          color: var(--color-danger);
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
