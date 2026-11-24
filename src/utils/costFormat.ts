/**
 * Prismatix deals in micro-costs: a single turn can legitimately cost
 * $0.00003. Four decimals would render it as $0.0000 and imply the component
 * was free, so sub-cent amounts use storage precision (numeric(12,6)).
 *
 * Invalid or negative input is NOT money and must never be formatted as
 * `$0.0000` — that would turn bad data into a confident claim of free usage.
 * A confirmed zero is different from unavailable data and keeps its own form.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value === 0) return '$0.0000';
  // Below the database's micro-dollar precision the amount is indistinguishable
  // from zero, but it is not zero. Say so instead of rounding to a false zero.
  if (value < 0.000001) return '<$0.000001';
  if (value < 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}
