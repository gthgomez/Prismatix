import React, { useEffect, useMemo, useState, type Ref } from 'react';
import { calculateCostBreakdown, type UsageEstimate } from '../costEngine';
import { PRICING_VERSION } from '../pricingRegistry';
import type { RouterModel } from '../types';
import { formatUsd } from '../utils/costFormat';
import type { SettledBreakdown } from '../../supabase/functions/_shared/execution_receipt';

const LS_DETAILS = 'prismatix.costEstimator.detailsExpanded';

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
  /**
   * Authoritative per-call ledger components from the terminal receipt. Only
   * meaningful when `breakdownSource === 'confirmed'`; absent or null means the
   * client must not present its own recalculation as confirmed.
   */
  settledBreakdown?: SettledBreakdown | null;
  breakdownSource?: 'confirmed' | 'estimated' | 'unavailable' | null;
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
  settledBreakdown = null,
  breakdownSource = null,
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

  const serverFinalApplied = !isStreaming && finalCostUsd !== null && finalCostUsd !== undefined;
  const authoritativeBreakdown = serverFinalApplied
    && breakdownSource === 'confirmed'
    && settledBreakdown
    ? settledBreakdown
    : null;
  // A settled total with no confirmed per-call breakdown is NOT a zero-cost
  // breakdown. The client must say the components are unavailable instead of
  // rendering its own recalculation as if it were the receipt.
  const settledBreakdownUnavailable = serverFinalApplied && !authoritativeBreakdown;
  const clientBreakdownUnavailable = breakdown.hasUnknownRate;
  const clientMessageTotal = breakdown.totalCost;
  const messageTotal = serverFinalApplied
    ? (finalCostUsd as number)
    : clientMessageTotal;
  const showClientRows = !authoritativeBreakdown && !settledBreakdownUnavailable && !clientBreakdownUnavailable;
  const tokensUnavailable = settledBreakdownUnavailable
    || (!isStreaming && breakdownSource === 'unavailable');

  const routerVersionTrimmed = routerPricingVersion?.trim() || null;
  const clientVersionTrimmed = breakdown.pricingVersion?.trim() || PRICING_VERSION;
  const pricingVersionsDiffer =
    !!routerVersionTrimmed &&
    routerVersionTrimmed !== clientVersionTrimmed;

  const provenanceLabel = authoritativeBreakdown
    ? 'confirmed'
    : settledBreakdownUnavailable
      ? 'unavailable'
      : 'estimated';

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

      {clientBreakdownUnavailable && !authoritativeBreakdown ? (
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
      ) : settledBreakdownUnavailable ? (
        <>
          <p className='cost-estimator-unknown-pricing' role='status'>
            A client token breakdown is unavailable for this turn. The confirmed total is
            shown; component costs and usage are unavailable and are not displayed as zero.
          </p>
          <div className='cost-estimator-total'>
            <span>Confirmed receipt</span>
            <span>{formatUsd(finalCostUsd as number)}</span>
          </div>
        </>
      ) : (
        <div className='cost-estimator-rows'>
          <div className='cost-estimator-row'>
            <span>Input</span>
            <span>{formatUsd(authoritativeBreakdown?.inputCostUsd ?? breakdown.inputCost)}</span>
          </div>
          <div className='cost-estimator-row'>
            <span>Output</span>
            <span>{formatUsd(authoritativeBreakdown?.outputCostUsd ?? breakdown.outputCost)}</span>
          </div>
          {((authoritativeBreakdown?.reasoningCostUsd ?? breakdown.thinkingCost) > 0) && (
            <div className='cost-estimator-row'>
              <span>Thinking</span>
              <span>{formatUsd(authoritativeBreakdown?.reasoningCostUsd ?? breakdown.thinkingCost)}</span>
            </div>
          )}
          <div className='cost-estimator-total'>
            <span>{isStreaming ? 'Live estimate' : serverFinalApplied ? 'Confirmed receipt' : 'Estimate'}</span>
            <span>{formatUsd(messageTotal)}</span>
          </div>
        </div>
      )}

      {!isStreaming && breakdownSource === 'estimated' && (
        <p className='cost-estimator-reconcile-note' role='status'>
          Settlement is pending. Line items are client estimates, not confirmed charges.
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
            <div className='cost-estimator-detail-label'>Model</div>
            <div className='cost-estimator-detail-value'>{model ?? reportedModel ?? 'Not reported'}</div>
          </div>

          <div className='cost-estimator-detail-block'>
            <div className='cost-estimator-detail-label'>Breakdown source</div>
            <div className='cost-estimator-detail-value'>{provenanceLabel}</div>
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
                  Router version differs from client registry - the confirmed receipt is authoritative.
                </p>
              )}
            </div>
          )}

          {tokensUnavailable ? (
            <p className='cost-estimator-detail-hint'>
              Token usage is unavailable for this turn; it is not reported as zero.
            </p>
          ) : authoritativeBreakdown ? (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Tokens (confirmed ledger)</div>
              <ul className='cost-estimator-token-list'>
                <li>
                  <span>Prompt</span>
                  <span>{authoritativeBreakdown.promptTokens.toLocaleString()}</span>
                </li>
                <li>
                  <span>Completion</span>
                  <span>{authoritativeBreakdown.completionTokens.toLocaleString()}</span>
                </li>
                {authoritativeBreakdown.reasoningTokens > 0 && (
                  <li>
                    <span>Thinking</span>
                    <span>{authoritativeBreakdown.reasoningTokens.toLocaleString()}</span>
                  </li>
                )}
              </ul>
            </div>
          ) : usage ? (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>Tokens (client estimate)</div>
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

          {authoritativeBreakdown ? (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>High precision (confirmed ledger, USD)</div>
              <div className='cost-estimator-micro-rows'>
                <div className='cost-estimator-micro-row'>
                  <span>Input</span>
                  <span>${authoritativeBreakdown.inputCostUsd.toFixed(6)}</span>
                </div>
                <div className='cost-estimator-micro-row'>
                  <span>Output</span>
                  <span>${authoritativeBreakdown.outputCostUsd.toFixed(6)}</span>
                </div>
                <div className='cost-estimator-micro-row'>
                  <span>Thinking</span>
                  <span>${authoritativeBreakdown.reasoningCostUsd.toFixed(6)}</span>
                </div>
                <div className='cost-estimator-micro-row cost-estimator-micro-row-total'>
                  <span>Sum</span>
                  <span>${authoritativeBreakdown.totalUsd.toFixed(6)}</span>
                </div>
              </div>
            </div>
          ) : showClientRows ? (
            <div className='cost-estimator-detail-block'>
              <div className='cost-estimator-detail-label'>High precision (client estimate, USD)</div>
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
          ) : null}

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
              Live line items use client rates and usage updates; the confirmed receipt replaces
              them when the message completes.
            </p>
          )}
        </div>
      )}

      {!isStreaming && (
        <div className='cost-estimator-final-note'>Hiding soon.</div>
      )}
    </div>
  );
};
