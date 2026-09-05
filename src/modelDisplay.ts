import { MODEL_CATALOG } from './modelCatalog';
import type { Message, RouteExplanation, RouterModel } from './types';

/** Compact label for the assistant message model pill; full detail in title / popover. */
export function assistantModelPillDisplay(
  msg: Pick<Message, 'model' | 'modelId'>,
): { label: string; title: string } {
  if (!msg.model) return { label: '', title: '' };
  const cat = MODEL_CATALOG[msg.model as RouterModel];
  const label = cat?.shortName ?? (msg.modelId || msg.model);
  const titleParts: string[] = [];
  if (cat?.name) titleParts.push(cat.name);
  else titleParts.push(msg.model);
  if (msg.modelId && msg.modelId !== msg.model) {
    titleParts.push(msg.modelId);
  }
  return { label, title: titleParts.join(' — ') };
}

export interface RouteExplanationRow {
  label: string;
  value: string;
}

const ROLE_LABELS: Record<string, string> = {
  economy: 'Economy (cheapest)',
  fast: 'Fast',
  balanced: 'Balanced',
  strong: 'Strong',
  max: 'Maximum capability',
  vision_fast: 'Vision (fast)',
  vision_strong: 'Vision (strong)',
  code_review: 'Code review',
  cheap_critic: 'Critic (cheap)',
};

const GATEWAY_LABELS: Record<string, string> = {
  opencode: 'OpenCode gateway',
  direct_fallback: 'Legacy direct provider',
};

/** Human-readable label for a routing role, or the raw value when unknown. */
export function routeRoleLabel(role?: string): string | undefined {
  if (!role) return undefined;
  return ROLE_LABELS[role] ?? role;
}

/**
 * Builds the "why Auto picked this" rows shown in the message metadata popover
 * from the route explanation returned by the router (X-Route-Decision).
 * Returns only rows with data, so manual-override or legacy messages degrade
 * gracefully.
 */
export function buildRouteExplanationRows(
  msg: Pick<Message, 'routeInfo' | 'cost'>,
): { rows: RouteExplanationRow[]; priceWarning?: string } {
  const info: RouteExplanation | undefined = msg.routeInfo;
  if (!info) return { rows: [] };

  const rows: RouteExplanationRow[] = [];

  const chosenBy = info.selection === 'override' ? 'Your manual pick' : 'Auto routing';
  rows.push({ label: 'Chosen by', value: chosenBy });

  const roleLabel = routeRoleLabel(info.role);
  if (roleLabel) rows.push({ label: 'Routing role', value: roleLabel });

  rows.push({ label: 'Why', value: info.reason });

  rows.push({
    label: 'Gateway',
    value: GATEWAY_LABELS[info.gateway] ?? info.gateway,
  });

  rows.push({
    label: 'Fallback',
    value: info.fallbackUsed ? 'Yes (see why above)' : 'No — first choice worked',
  });

  if (msg.cost?.estimatedUsd !== undefined) {
    const versionSuffix = msg.cost.pricingVersion ? ` · prices ${msg.cost.pricingVersion}` : '';
    rows.push({
      label: 'Est. cost basis',
      value: `≈$${msg.cost.estimatedUsd.toFixed(6)}${versionSuffix}`,
    });
  }

  const priceWarning = info.priceKnown
    ? undefined
    : 'Pricing for this model is unknown — Auto blocked the send (fail-closed cost safety).';

  return { rows, priceWarning };
}
