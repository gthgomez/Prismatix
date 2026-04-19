import React, { useEffect, useMemo, useState } from 'react';
import { calculateCostBreakdown, type UsageEstimate } from '../costEngine';
import { PRICING_VERSION } from '../pricingRegistry';
import type { RouterModel } from '../types';

const LS_DETAILS = 'prismatix.costEstimator.detailsExpanded';
const TOTAL_COMPARE_EPS = 1e-5;

function readDetailsExpanded(): boolean {
  try {
    return localStorage.getItem(LS_DETAILS) === '1';
  } catch {
    return false;
  }
}

interface CostEstimatorProps {
  model: RouterModel;
  usage: UsageEstimate | null;
  isVisible: boolean;
  isStreaming: boolean;
  totalCost: number;
  finalCostUsd: number | null;
  /** Pricing version from the router / stream headers when available. */
  routerPricingVersion?: string | null;
}

export const CostEstimator: React.FC<CostEstimatorProps> = ({
  model,
  usage,
  isVisible,
  isStreaming,
  totalCost,
  finalCostUsd,
  routerPricingVersion,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(readDetailsExpanded);

  useEffect(() => {
    try {
      localStorage.setItem(LS_DETAILS, detailsOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [detailsOpen]);

  const breakdown = useMemo(() => {
    if (!usage) {
      return {
        inputCost: 0,
        outputCost: 0,
        thinkingCost: 0,
        totalCost: 0,
        pricingVersion: PRICING_VERSION,
      };
    }
    return calculateCostBreakdown(model, usage);
  }, [model, usage]);

  if (!isVisible) return null;

  const clientMessageTotal = breakdown.totalCost;
  const messageTotal = isStreaming
    ? clientMessageTotal
    : (finalCostUsd ?? clientMessageTotal);
  const sessionTotalDisplay = isStreaming
    ? totalCost + messageTotal
    : totalCost;

  const serverFinalApplied =
    !isStreaming && finalCostUsd !== null && finalCostUsd !== undefined;
  const clientVsServerDiffers =
    serverFinalApplied &&
    Math.abs((finalCostUsd as number) - clientMessageTotal) > TOTAL_COMPARE_EPS;

  const routerVersionTrimmed = routerPricingVersion?.trim() || null;
  const clientVersionTrimmed = breakdown.pricingVersion?.trim() || PRICING_VERSION;
  const pricingVersionsDiffer =
    !!routerVersionTrimmed &&
    routerVersionTrimmed !== clientVersionTrimmed;

  return (
    <div
      className={`cost-estimator ${isStreaming ? 'streaming' : 'final'}`}
      aria-live='polite'
    >
      <div className='cost-estimator-title'>{isStreaming ? 'This message' : 'Final total'}</div>
      <div className='cost-estimator-rows'>
        <div className='cost-estimator-row'>
          <span>Input</span>
          <span>${breakdown.inputCost.toFixed(4)}</span>
        </div>
        <div className='cost-estimator-row'>
          <span>Output</span>
          <span>${breakdown.outputCost.toFixed(4)}</span>
        </div>
        {breakdown.thinkingCost > 0 && (
          <div className='cost-estimator-row'>
            <span>Thinking</span>
            <span>${breakdown.thinkingCost.toFixed(4)}</span>
          </div>
        )}
        <div className='cost-estimator-total'>
          <span>Total</span>
          <span>${messageTotal.toFixed(4)}</span>
        </div>
      </div>

      {clientVsServerDiffers && (
        <p className='cost-estimator-reconcile-note' role='status'>
          Shown total uses stream / logged final (
          ${(finalCostUsd as number).toFixed(4)}). Client breakdown sum is $
          {clientMessageTotal.toFixed(4)} — see details.
        </p>
      )}

      <div className='cost-estimator-session'>
        <span>Session total</span>
        <strong>${sessionTotalDisplay.toFixed(4)}</strong>
      </div>

      <button
        type='button'
        className='cost-estimator-details-toggle'
        aria-expanded={detailsOpen}
        aria-controls='cost-estimator-details-panel'
        onClick={() => setDetailsOpen((o) => !o)}
      >
        {detailsOpen ? 'Hide details' : 'Details'}
      </button>

      {detailsOpen && (
        <div className='cost-estimator-details' id='cost-estimator-details-panel'>
          <div className='cost-estimator-detail-block'>
            <div className='cost-estimator-detail-label'>Model (client breakdown)</div>
            <div className='cost-estimator-detail-value'>{model}</div>
          </div>

          <div className='cost-estimator-detail-block'>
            <div className='cost-estimator-detail-label'>Pricing registry (client)</div>
            <div className='cost-estimator-detail-value'>{clientVersionTrimmed}</div>
          </div>

          {routerVersionTrimmed && (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Router / response</div>
              <div className='cost-estimator-detail-value'>{routerVersionTrimmed}</div>
              {pricingVersionsDiffer && (
                <p className='cost-estimator-detail-hint'>
                  Router version differs from client registry — compare totals below if needed.
                </p>
              )}
            </div>
          )}

          {usage ? (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Tokens (usage)</div>
              <ul className='cost-estimator-token-list'>
                <li>
                  <span>Prompt</span>
                  <span>{usage.promptTokens.toLocaleString()}</span>
                </li>
                <li>
                  <span>Completion</span>
                  <span>{usage.completionTokens.toLocaleString()}</span>
                </li>
                {(usage.thinkingTokens ?? 0) > 0 && (
                  <li>
                    <span>Thinking</span>
                    <span>{(usage.thinkingTokens ?? 0).toLocaleString()}</span>
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <p className='cost-estimator-detail-hint'>No usage snapshot yet.</p>
          )}

          <div className='cost-estimator-detail-block'>
            <div className='cost-estimator-detail-label'>High precision (client, USD)</div>
            <div className='cost-estimator-micro-rows'>
              <div className='cost-estimator-micro-row'>
                <span>Input</span>
                <span>${breakdown.inputCost.toFixed(6)}</span>
              </div>
              <div className='cost-estimator-micro-row'>
                <span>Output</span>
                <span>${breakdown.outputCost.toFixed(6)}</span>
              </div>
              <div className='cost-estimator-micro-row'>
                <span>Thinking</span>
                <span>${breakdown.thinkingCost.toFixed(6)}</span>
              </div>
              <div className='cost-estimator-micro-row cost-estimator-micro-row-total'>
                <span>Sum</span>
                <span>${clientMessageTotal.toFixed(6)}</span>
              </div>
            </div>
          </div>

          {serverFinalApplied && (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Stream / logged final (USD)</div>
              <div className='cost-estimator-detail-value'>
                ${(finalCostUsd as number).toFixed(6)}
              </div>
            </div>
          )}

          {isStreaming && (
            <p className='cost-estimator-detail-hint'>
              Live line items use client rates and usage updates; the stream may report a
              different final when the message completes.
            </p>
          )}
        </div>
      )}

      {!isStreaming && (
        <div className='cost-estimator-final-note'>Hiding soon…</div>
      )}
    </div>
  );
};
