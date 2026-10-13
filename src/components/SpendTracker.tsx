import React, { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config';
import { supabase } from '../lib/supabase';
import type { SpendStats } from '../services/financeTracker';

interface SpendTrackerProps {
  refreshKey: number;
}

const EMPTY_STATS: SpendStats = {
  today: 0,
  thisWeek: 0,
  thisMonth: 0,
  allTime: 0,
  lastMessageCost: 0,
  messageCount: 0,
};

export const SpendTracker: React.FC<SpendTrackerProps> = ({ refreshKey }) => {
  const [stats, setStats] = useState<SpendStats>(EMPTY_STATS);
  const [isOpen, setIsOpen] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const refreshCycleRef = useRef(0);
  const refreshTimersRef = useRef<number[]>([]);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  const fetchServerStats = async (): Promise<SpendStats | null> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token || !CONFIG.SUPABASE_URL) {
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

      const data = await response.json() as SpendStats;
      return {
        today: Number(data.today) || 0,
        thisWeek: Number(data.thisWeek) || 0,
        thisMonth: Number(data.thisMonth) || 0,
        allTime: Number(data.allTime) || 0,
        lastMessageCost: Number(data.lastMessageCost) || 0,
        messageCount: Number(data.messageCount) || 0,
      };
    } catch {
      return null;
    }
  };

  const refreshStats = async () => {
    setSyncState('syncing');
    setSyncMessage('');

    const serverStats = await fetchServerStats();
    if (serverStats) {
      setStats(serverStats);
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
  }, [refreshKey]);

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

  const stateLabel =
    syncState === 'syncing' ? 'Syncing' : syncState === 'error' ? 'Sync issue' : 'Live';
  // Zero spend is secondary information: keep it readable but visually quiet so
  // the routing mode (the thing that actually changes behaviour) leads.
  const isQuiet = stats.today === 0 && syncState !== 'error';

  return (
    <div className='spend-widget' ref={widgetRef}>
      <button
        type='button'
        className={`spend-pill${isQuiet ? ' is-quiet' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={`Spend analytics — $${stats.today.toFixed(2)} today, ${stateLabel.toLowerCase()}`}
        title='View spend analytics'
      >
        <span className='spend-pill-value'>${stats.today.toFixed(2)}</span>
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
              <span>{syncState === 'syncing' ? 'Syncing' : 'Connected'}</span>
            </div>
          </div>
          
          <div className='spend-grid'>
            <div className='spend-card'>
              <div className='spend-label'>Today</div>
              <div className='spend-value'>${stats.today.toFixed(4)}</div>
            </div>
            <div className='spend-card'>
              <div className='spend-label'>This Week</div>
              <div className='spend-value'>${stats.thisWeek.toFixed(4)}</div>
            </div>
            <div className='spend-card'>
              <div className='spend-label'>This Month</div>
              <div className='spend-value'>${stats.thisMonth.toFixed(4)}</div>
            </div>
            <div className='spend-card'>
              <div className='spend-label'>All Time</div>
              <div className='spend-value'>${stats.allTime.toFixed(4)}</div>
            </div>
          </div>

          <div className="spend-divider" />

          <div className='spend-last'>
            <div className="last-msg-row">
              <span className="label">Last message</span>
              <span className="value">${stats.lastMessageCost.toFixed(6)}</span>
            </div>
            <div className="msg-count-row">
              <span className="label">Total messages</span>
              <span className="value">{stats.messageCount}</span>
            </div>
          </div>

          <div className='spend-sync-note'>
            {syncState === 'error' ? (
              <span className="error-text">⚠️ {syncMessage}</span>
            ) : (
              lastSyncAt && `Verified at ${new Date(lastSyncAt).toLocaleTimeString()}`
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
          background: #141414;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 1rem;
          padding: 1.25rem;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          backdrop-filter: blur(20px);
          animation: dropdownIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .spend-popover-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.25rem;
        }

        .spend-popover h3 {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 700;
          background: linear-gradient(135deg, #4ECDC4, #FF6B6B);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sync-indicator {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.6rem;
          color: rgba(255, 255, 255, 0.4);
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
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 0.75rem;
          transition: border-color 0.2s;
        }

        .spend-card:hover {
          border-color: rgba(78, 205, 196, 0.3);
        }

        .spend-label {
          font-size: 0.6rem;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
        }

        .spend-value {
          font-size: 1rem;
          font-weight: 700;
          color: #fff;
        }

        .spend-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.06);
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
          color: rgba(255, 255, 255, 0.4);
        }

        .last-msg-row .value {
          color: #FF6B6B;
          font-weight: 600;
        }

        .msg-count-row .value {
          color: #fff;
          font-weight: 600;
        }

        .spend-sync-note {
          font-size: 0.65rem;
          color: rgba(255, 255, 255, 0.3);
          text-align: center;
          font-style: italic;
        }

        .error-text {
          color: #FF6B6B;
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
