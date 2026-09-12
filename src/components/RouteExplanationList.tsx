// RouteExplanationList.tsx - "Why Auto picked this" rows for the message metadata popover.
// Purely presentational: rows are computed by modelDisplay.buildRouteExplanationRows.

import React from 'react';
import type { RouteExplanationRow } from '../modelDisplay';

interface RouteExplanationListProps {
  rows: RouteExplanationRow[];
  priceWarning?: string;
}

export const RouteExplanationList: React.FC<RouteExplanationListProps> = ({ rows, priceWarning }) => {
  if (rows.length === 0 && !priceWarning) return null;

  return (
    <div className='route-explanation' data-testid='route-explanation'>
      <div className='metadata-divider' />
      {rows.map((row) => (
        <div className='metadata-item' key={row.label}>
          <span className='item-label'>{row.label}</span>
          <span className='item-value'>{row.value}</span>
        </div>
      ))}
      {priceWarning && (
        <div className='route-price-warning' role='alert'>
          {priceWarning}
        </div>
      )}
    </div>
  );
};
