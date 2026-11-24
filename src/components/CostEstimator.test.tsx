import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { CostEstimator } from './CostEstimator';
import { formatUsd } from '../utils/costFormat';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const legacyModel = 'gemini-2.5-flash';

describe('CostEstimator pricing freshness', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
    vi.useRealTimers();
  });

  it('keeps a live message estimate separate from router-confirmed session receipts', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 1000, completionTokens: 1000 }}
      isVisible
      isStreaming
      totalCost={0.0123}
      finalCostUsd={null}
    />));

    expect(container.querySelector('.cost-estimator-title')?.textContent).toBe('Live message estimate');
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('Live estimate');
    expect(container.querySelector('.cost-estimator-session')?.textContent).toContain('Confirmed receipts in this session');
    expect(container.querySelector('.cost-estimator-session strong')?.textContent).toBe('$0.0123');
    expect(container.querySelector('.cost-estimator-session')?.textContent).not.toContain('0.0123 +');
  });

  it('explains when an estimate is unavailable because the legacy price is stale', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model={legacyModel}
      usage={{ promptTokens: 1000, completionTokens: 500 }}
      isVisible
      isStreaming={false}
      totalCost={0}
      finalCostUsd={null}
    />));

    expect(container.textContent).toContain(`Pricing for ${legacyModel} is unverified or out of date`);
    expect(container.textContent).toContain('A detailed estimate is unavailable');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
  });

  it('shows a settled receipt without inventing a zero breakdown for unknown pricing', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model={legacyModel}
      usage={{ promptTokens: 1000, completionTokens: 500 }}
      isVisible
      isStreaming={false}
      totalCost={0.0123}
      finalCostUsd={0.0123}
    />));

    expect(container.textContent).toContain('Settled total');
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('$0.0123');
    expect(container.textContent).not.toContain('Client breakdown sum');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
    const details = container.querySelector<HTMLButtonElement>('.cost-estimator-details-toggle')!;
    if (details.getAttribute('aria-expanded') === 'false') act(() => details.click());
    expect(container.textContent).not.toContain('High precision (client, USD)');
    expect(container.textContent).toContain('Confirmed receipt (USD)');
  });

  it('keeps nonzero micro-costs visibly nonzero', () => {
    expect(formatUsd(0.00003)).toBe('$0.000030');
    expect(formatUsd(0.000045)).toBe('$0.000045');
    expect(formatUsd(0.000075)).toBe('$0.000075');
    expect(formatUsd(0.0123)).toBe('$0.0123');
    expect(formatUsd(0)).toBe('$0.0000');
    // Unavailable/invalid money is not a confident zero.
    expect(formatUsd(Number.NaN)).toBe('—');
    expect(formatUsd(-0.01)).toBe('—');
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    // Below storage precision the amount is not zero, but cannot be shown.
    expect(formatUsd(0.0000004)).toBe('<$0.000001');
    expect(formatUsd(0.000001)).toBe('$0.000001');
    // Formatting boundary.
    expect(formatUsd(0.0000999)).toBe('$0.000100');
    expect(formatUsd(0.0001)).toBe('$0.0001');
  });

  it('does not present a zero client breakdown beside a positive settled receipt', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 0, completionTokens: 0 }}
      isVisible
      isStreaming={false}
      totalCost={0.0001}
      finalCostUsd={0.0001}
    />));

    expect(container.textContent).toContain('A client token breakdown is unavailable for this turn');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('$0.0001');
    expect(container.textContent).not.toContain('Client breakdown sum');
  });

  it('does not invent a model or cost breakdown when the router omits the model', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model={null}
      usage={{ promptTokens: 1000, completionTokens: 500 }}
      isVisible
      isStreaming={false}
      totalCost={0.0123}
      finalCostUsd={0.0123}
    />));

    expect(container.textContent).toContain('The router did not report the model');
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('$0.0123');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
    expect(container.textContent).not.toContain('Client breakdown sum');
  });

  it('renders authoritative ledger components instead of recalculating a settled total', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 1000, completionTokens: 1000 }}
      isVisible
      isStreaming={false}
      totalCost={0.000075}
      finalCostUsd={0.000075}
      breakdownSource='confirmed'
      settledBreakdown={{
        promptTokens: 40,
        completionTokens: 12,
        reasoningTokens: 0,
        inputCostUsd: 0.00003,
        outputCostUsd: 0.000045,
        reasoningCostUsd: 0,
        totalUsd: 0.000075,
      }}
    />));

    expect(container.querySelector('.cost-estimator-title')?.textContent).toBe('Settled total');
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('$0.000075');
    const rows = Array.from(container.querySelectorAll('.cost-estimator-row')).map((row) => row.textContent);
    expect(rows).toEqual(['Input$0.000030', 'Output$0.000045']);
    expect(container.textContent).not.toContain('Settlement is pending');

    const details = container.querySelector<HTMLButtonElement>('.cost-estimator-details-toggle')!;
    if (details.getAttribute('aria-expanded') === 'false') act(() => details.click());
    expect(container.textContent).toContain('Breakdown sourceconfirmed');
    expect(container.textContent).toContain('Tokens (confirmed ledger)');
    expect(container.textContent).toContain('High precision (confirmed ledger, USD)');
    expect(container.textContent).not.toContain('High precision (client estimate, USD)');
  });

  it('shows a settled total with unavailable components without inventing zeros', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 1000, completionTokens: 1000 }}
      isVisible
      isStreaming={false}
      totalCost={0.000075}
      finalCostUsd={0.000075}
      breakdownSource='unavailable'
      settledBreakdown={null}
    />));

    expect(container.querySelector('.cost-estimator-title')?.textContent).toBe('Settled total');
    expect(container.querySelector('.cost-estimator-total')?.textContent).toContain('$0.000075');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
    expect(container.textContent).toContain('component costs and usage are unavailable');
    expect(container.textContent).not.toContain('Input$0.0000');

    const details = container.querySelector<HTMLButtonElement>('.cost-estimator-details-toggle')!;
    if (details.getAttribute('aria-expanded') === 'false') act(() => details.click());
    expect(container.textContent).toContain('Token usage is unavailable');
  });

  it('labels a pending settlement as an estimate, not a confirmed charge', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 1000, completionTokens: 1000 }}
      isVisible
      isStreaming={false}
      totalCost={0}
      finalCostUsd={null}
      breakdownSource='estimated'
    />));

    expect(container.querySelector('.cost-estimator-title')?.textContent).toBe('Estimated total');
    expect(container.textContent).toContain('Settlement is pending');
    expect(container.textContent).toContain('Line items are client estimates');
    expect(container.querySelector('.cost-estimator-rows')).not.toBeNull();
  });

  it('treats a confirmed label without a breakdown as unavailable', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model='gemini-3.8-flash'
      usage={{ promptTokens: 1000, completionTokens: 1000 }}
      isVisible
      isStreaming={false}
      totalCost={0.000075}
      finalCostUsd={0.000075}
      breakdownSource='confirmed'
      settledBreakdown={null}
    />));

    expect(container.textContent).toContain('component costs and usage are unavailable');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
  });

  it('distinguishes an unrecognized reported model from an omitted model', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<CostEstimator
      model={null}
      reportedModel='new-model-from-router'
      usage={{ promptTokens: 1000, completionTokens: 500 }}
      isVisible
      isStreaming={false}
      totalCost={0}
      finalCostUsd={null}
    />));

    expect(container.textContent).toContain('unrecognized model new-model-from-router');
    expect(container.textContent).not.toContain('router did not report');
    expect(container.querySelector('.cost-estimator-rows')).toBeNull();
  });
});
