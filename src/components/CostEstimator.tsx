import React, { useEffect, useMemo, useState, type Ref } from 'react';
import { calculateCostBreakdown, type UsageEstimate } from '../costEngine';
import { PRICING_VERSION } from '../pricingRegistry';
import type { RouterModel } from '../types';

const LS_DETAILS = 'prismatix.costEstimator.detailsExpanded';
const TOTAL_COMPARE_EPS = 1e-5;

/**
 * Micro-costs are normal here ($0.00003 input). Four decimals would render
 * them as $0.0000 and imply the component was free, so use enough precision to
 * keep a nonzero amount visibly nonzero.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.0000';
  if (value > 0 && value < 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function readDetailsExpanded(): boolean {
  try {
    return localStorage.getItem(LS_DETAILS) === '1';
  } catch {
    return false;
  }
}

interface CostEstimatorProps {
  model: RouterModel | null;
  /** Raw identifier reported by a router newer than this client's catalog. */
  reportedModel?: string;
  usage: UsageEstimate | null;
  isVisible: boolean;
  isStreaming: boolean;
  totalCost: number;
  finalCostUsd: number | null;
  /** Pricing version from the router / stream headers when available. */
  routerPricingVersion?: string | null;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  panelRef?: Ref<HTMLDivElement>;
  detailsButtonRef?: Ref<HTMLButtonElement>;
  compactViewportHeight?: number | null;
}

export const CostEstimator: React.FC<CostEstimatorProps> = ({
  model,
  reportedModel,
  usage,
  isVisible,
  isStreaming,
  totalCost,
  finalCostUsd,
  routerPricingVersion,
  onInteractionStart,
  onInteractionEnd,
  panelRef,
  detailsButtonRef,
  compactViewportHeight,
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
    if (!usage || !model) {
      return {
        inputCost: 0,
        outputCost: 0,
        thinkingCost: 0,
        totalCost: 0,
        pricingVersion: PRICING_VERSION,
        hasUnknownRate: !model,
      };
    }
    return calculateCostBreakdown(model, usage);
  }, [model, usage]);

  if (!isVisible) return null;

  const clientMessageTotal = breakdown.totalCost;
  const messageTotal = isStreaming
    ? clientMessageTotal
    : (finalCostUsd ?? clientMessageTotal);

  const serverFinalApplied =
    !isStreaming && finalCostUsd !== null && finalCostUsd !== undefined;
  // A zero client-side breakdown next to a positive settled receipt means the
  // client never had usable token data for this turn. Presenting $0.0000
  // Input/Output rows implies the call was free; treat the breakdown as
  // unavailable and show only the confirmed receipt.
  const clientBreakdownUnavailable = breakdown.hasUnknownRate
    || (serverFinalApplied && (finalCostUsd as number) > 0 && clientMessageTotal <= 0);
  const clientVsServerDiffers =
    serverFinalApplied &&
    !clientBreakdownUnavailable &&
    Math.abs((finalCostUsd as number) - clientMessageTotal) > TOTAL_COMPARE_EPS;

  const routerVersionTrimmed = routerPricingVersion?.trim() || null;
  const clientVersionTrimmed = breakdown.pricingVersion?.trim() || PRICING_VERSION;
  const pricingVersionsDiffer =
    !!routerVersionTrimmed &&
    routerVersionTrimmed !== clientVersionTrimmed;

  return (
    <div
      ref={panelRef}
      className={`cost-estimator ${isStreaming ? 'streaming' : 'final'} ${compactViewportHeight !== null && compactViewportHeight !== undefined ? 'compact-details-revealed' : ''}`}
      style={compactViewportHeight !== null && compactViewportHeight !== undefined
        ? ({ '--compact-cost-viewport-height': `${compactViewportHeight}px` } as React.CSSProperties)
        : undefined}
      aria-live='polite'
      onFocusCapture={onInteractionStart}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onInteractionEnd?.();
        }
      }}
    >
      <div className='cost-estimator-title'>
        {isStreaming ? 'Live message estimate' : serverFinalApplied ? 'Settled total' : 'Estimated total'}
      </div>
      {clientBreakdownUnavailable ? (
        <>
          <p className='cost-estimator-unknown-pricing' role='alert'>
            {breakdown.hasUnknownRate
              ? model
                ? `Pricing for ${model} is unverified or out of date.`
                : reportedModel
                  ? `Pricing for the unrecognized model ${reportedModel} is unavailable in this client.`
                  : 'The router did not report the model.'
              : 'A client token breakdown is unavailable for this turn.'}{' '}
            A detailed estimate is unavailable.
          </p>
          {serverFinalApplied && (
            <div className='cost-estimator-total'>
              <span>Confirmed receipt</span>
              <span>{formatUsd(finalCostUsd as number)}</span>
            </div>
          )}
        </>
      ) : (
        <div className='cost-estimator-rows'>
          <div className='cost-estimator-row'>
            <span>Input</span>
            <span>{formatUsd(breakdown.inputCost)}</span>
          </div>
          <div className='cost-estimator-row'>
            <span>Output</span>
            <span>{formatUsd(breakdown.outputCost)}</span>
          </div>
          {breakdown.thinkingCost > 0 && (
            <div className='cost-estimator-row'>
              <span>Thinking</span>
              <span>{formatUsd(breakdown.thinkingCost)}</span>
            </div>
          )}
          <div className='cost-estimator-total'>
            <span>{isStreaming ? 'Live estimate' : serverFinalApplied ? 'Confirmed receipt' : 'Estimate'}</span>
            <span>{formatUsd(messageTotal)}</span>
          </div>
        </div>
      )}

      {clientVsServerDiffers && (
        <p className='cost-estimator-reconcile-note' role='status'>
          Shown total uses the confirmed receipt ({formatUsd(finalCostUsd as number)}). Client
          breakdown sum is {formatUsd(clientMessageTotal)} — see details.
        </p>
      )}

      <div className='cost-estimator-session'>
        <span>Confirmed receipts in this session</span>
        <strong>{formatUsd(totalCost)}</strong>
      </div>

      <button
        ref={detailsButtonRef}
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
            <div className='cost-estimator-detail-value'>{model ?? reportedModel ?? 'Not reported'}</div>
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

          {!breakdown.hasUnknownRate && <div className='cost-estimator-detail-block'>
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
          </div>}

          {serverFinalApplied && (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Confirmed receipt (USD)</div>
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
