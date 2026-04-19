import { MODEL_CATALOG } from './modelCatalog';
import type { Message, RouterModel } from './types';

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
