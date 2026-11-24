/**
 * Micro-costs are normal in Prismatix ($0.00003 input). Four decimals would
 * render them as $0.0000 and imply the component was free, so use enough
 * precision to keep a nonzero amount visibly nonzero.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.0000';
  if (value > 0 && value < 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}
