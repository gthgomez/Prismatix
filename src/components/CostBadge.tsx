import React, { useEffect, useRef, useState } from 'react';
import type { MessageCost, RouterModel } from '../types';
import { computeCostSavings } from '../utils/costSavingsCalculator';

export interface CostBadgeProps {
  cost?: MessageCost;
  model?: RouterModel | string;
  durationMs?: number;
  content?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export const CostBadge: React.FC<CostBadgeProps> = ({
  cost,
  model,
  durationMs,
  content,
  promptTokens,
  completionTokens,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!cost) return null;

  const value = cost.finalUsd ?? cost.estimatedUsd;
  if (value === undefined) return null;

  const isFinal = cost.finalUsd !== undefined;
  const label = isFinal ? 'final' : 'est';

  const analysis = computeCostSavings({
    model,
    costUsd: value,
    promptTokens: promptTokens ?? cost.promptTokens,
    completionTokens: completionTokens ?? cost.completionTokens,
    durationMs: durationMs ?? cost.durationMs,
    content,
  });

  const togglePopover = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  return (
    <span ref={containerRef} className='cost-badge-container'>
      <button
        type='button'
        className={`message-model-override cost-badge-interactive ${isOpen ? 'popover-open' : ''}`}
        title={cost.pricingVersion || 'cost'}
        aria-haspopup='dialog'
        aria-expanded={isOpen}
        aria-label={`Cost: $${value.toFixed(4)} ${label}. Click for details`}
        onClick={togglePopover}
      >
        <span className='cost-badge-label'>
          ${value.toFixed(4)} {label}
        </span>
      </button>

      {isOpen && (
        <div
          className='cost-intelligence-popover'
          role='dialog'
          aria-label='Cost and performance intelligence'
          onClick={(e) => e.stopPropagation()}
        >
          <div className='popover-header'>
            <div className='popover-title'>
              <span className='popover-icon' aria-hidden='true'>⚡</span>
              <span>Cost & Performance</span>
            </div>
            <span className={`popover-status-badge ${isFinal ? 'settled' : 'estimated'}`}>
              {isFinal ? 'Final Ledger' : 'Pre-flight Estimate'}
            </span>
          </div>

          {analysis.savingsPercent > 0 && (
            <div className='cost-savings-banner'>
              <span className='savings-tag'>Auto-Route Savings</span>
              <div className='savings-metric'>
                <strong>{analysis.savingsPercent}% saved</strong> (${analysis.savingsUsd.toFixed(4)}) vs {analysis.baselineModel}
              </div>
            </div>
          )}

          <div className='popover-metrics-grid'>
            <div className='metric-box'>
              <span className='metric-label'>Prompt</span>
              <span className='metric-val'>{analysis.promptTokens.toLocaleString()} tok</span>
            </div>
            <div className='metric-box'>
              <span className='metric-label'>Output</span>
              <span className='metric-val'>{analysis.completionTokens.toLocaleString()} tok</span>
            </div>
            <div className='metric-box'>
              <span className='metric-label'>Speed</span>
              <span className='metric-val'>{analysis.tokensPerSec ? `${analysis.tokensPerSec} t/s` : '—'}</span>
            </div>
            <div className='metric-box'>
              <span className='metric-label'>Duration</span>
              <span className='metric-val'>{analysis.durationMs ? `${(analysis.durationMs / 1000).toFixed(1)}s` : '—'}</span>
            </div>
          </div>

          <div className='popover-tariffs'>
            <div className='tariff-row'>
              <span>Model Tier:</span>
              <code>{analysis.model}</code>
            </div>
            <div className='tariff-row'>
              <span>Tariff (In / Out):</span>
              <span>${analysis.modelPricing.inputRatePer1M.toFixed(2)} / ${analysis.modelPricing.outputRatePer1M.toFixed(2)} per 1M</span>
            </div>
            {cost.pricingVersion && (
              <div className='tariff-row pricing-ver'>
                <span>Tariff Ref:</span>
                <span>{cost.pricingVersion}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
};
