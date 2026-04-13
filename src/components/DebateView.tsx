// DebateView.tsx - Collapsible side-by-side view of debate participant responses

import React, { useState } from 'react';
import type { DebateParticipant } from '../types';

interface DebateViewProps {
  participants: DebateParticipant[];
}

const ROLE_LABEL: Record<string, string> = {
  proposer: 'Proposer',
  contrarian: 'Contrarian',
};

const ROLE_COLOR: Record<string, string> = {
  proposer: '#4ECDC4',
  contrarian: '#FF6B6B',
};

const TRUNCATE_LENGTH = 400;

export const DebateView: React.FC<DebateViewProps> = ({ participants }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Record<number, boolean>>({});

  if (participants.length === 0) return null;

  const togglePanel = (idx: number) => {
    setExpandedPanels((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className='debate-view'>
      <button
        type='button'
        className='debate-view-toggle'
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <svg
          className={`debate-chevron ${isExpanded ? 'open' : ''}`}
          width='10'
          height='10'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='3'
        >
          <polyline points='6 9 12 15 18 9' />
        </svg>
        <span className='debate-view-label'>
          Debate View
        </span>
        <span className='debate-view-count'>
          {participants.length} participants
        </span>
      </button>

      {isExpanded && (
        <div className='debate-panels'>
          {participants.map((participant, idx) => {
            const isPanelExpanded = !!expandedPanels[idx];
            const isLong = participant.response.length > TRUNCATE_LENGTH;
            const displayText = isLong && !isPanelExpanded
              ? participant.response.slice(0, TRUNCATE_LENGTH) + '…'
              : participant.response;
            const color = ROLE_COLOR[participant.role] ?? '#aaa';
            const label = ROLE_LABEL[participant.role] ?? participant.role;

            return (
              <div
                key={idx}
                className='debate-panel'
                style={{ '--panel-color': color } as React.CSSProperties}
              >
                <div className='debate-panel-header'>
                  <span className='debate-role-badge' style={{ background: color }}>
                    {label}
                  </span>
                  <span className='debate-panel-model'>{participant.model}</span>
                </div>

                {participant.keyPoints && participant.keyPoints.length > 0 && (
                  <ul className='debate-key-points'>
                    {participant.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                )}

                <p className='debate-panel-text'>{displayText}</p>

                {isLong && (
                  <button
                    type='button'
                    className='debate-panel-expand'
                    onClick={() => togglePanel(idx)}
                  >
                    {isPanelExpanded ? 'Show less' : 'Show full response'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
