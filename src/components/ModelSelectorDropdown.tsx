// ModelSelectorDropdown.tsx - Dropdown panel for model selection, thinking level, and debate mode

import React from 'react';
import type { GeminiFlashThinkingLevel, RouterModel } from '../types';
import { MODEL_CATALOG, MODEL_ORDER } from '../modelCatalog';
import { DEBATE_SELECTIONS, type DebateSelection } from '../debateMode';

interface ModelSelectorDropdownProps {
  currentModel: RouterModel;
  currentComplexity: number;
  manualModelOverride: RouterModel | null;
  geminiFlashThinkingLevel: GeminiFlashThinkingLevel;
  debateSelection: DebateSelection;
  sendValidationError: string | null;
  onModelSelect: (model: RouterModel) => void;
  onClearOverride: () => void;
  onGeminiThinkingChange: (level: GeminiFlashThinkingLevel) => void;
  onDebateChange: (selection: DebateSelection) => void;
  onClearValidationError: () => void;
}

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  currentModel,
  currentComplexity,
  manualModelOverride,
  geminiFlashThinkingLevel,
  debateSelection,
  sendValidationError,
  onModelSelect,
  onClearOverride,
  onGeminiThinkingChange,
  onDebateChange,
  onClearValidationError,
}) => {
  const modelConfig = MODEL_CATALOG;

  return (
    <div className='model-dropdown'>
      <div className='dropdown-header'>
        <span>Model Selection</span>
        {manualModelOverride && (
          <button
            type='button'
            className='auto-mode-btn'
            onClick={onClearOverride}
          >
            Auto Mode
          </button>
        )}
      </div>

      <div className='dropdown-section-title'>Routing Intelligence</div>
      <div className='dropdown-options-grid'>
        <div className='complexity-status-item'>
          <div className='status-header'>
            <span className='status-label'>Current Task Complexity</span>
            <span className='complexity-value'>{currentComplexity}</span>
          </div>
          <div className='complexity-bar'>
            <div
              className='complexity-fill'
              style={{ width: `${currentComplexity}%` }}
            />
          </div>
          <span className='routing-logic-hint'>
            {currentComplexity > 75
              ? '↳ High complexity: Routed to Pro model'
              : currentComplexity > 40
              ? '↳ Medium complexity: Routed to Sonnet'
              : '↳ Low complexity: Routed to Flash'}
          </span>
        </div>

        <div className='dropdown-divider' />

        <div className='dropdown-controls-row'>
          <div
            className='thinking-toggle-container'
            title='Applies when Gemini Flash is selected'
          >
            <span className='thinking-toggle-label'>Flash Thinking</span>
            <div className='thinking-toggle-buttons'>
              <button
                type='button'
                className={`thinking-toggle-button ${
                  geminiFlashThinkingLevel === 'low' ? 'active' : ''
                }`}
                onClick={() => onGeminiThinkingChange('low')}
              >
                Low
              </button>
              <button
                type='button'
                className={`thinking-toggle-button ${
                  geminiFlashThinkingLevel === 'high' ? 'active' : ''
                }`}
                onClick={() => onGeminiThinkingChange('high')}
              >
                High
              </button>
            </div>
          </div>

          <div className='debate-toggle-container' title='Debate routing mode'>
            <span className='debate-toggle-label'>Debate Mode</span>
            <select
              className='debate-select'
              value={debateSelection}
              onChange={(e) => {
                onDebateChange(e.target.value as DebateSelection);
                if (sendValidationError) onClearValidationError();
              }}
            >
              {DEBATE_SELECTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className='dropdown-divider' />
      <div className='dropdown-section-title'>Manual Model Override</div>

      <div className='model-options'>
        {MODEL_ORDER.map((key) => {
          const config = modelConfig[key];
          return (
            <button
              key={key}
              type='button'
              className={`model-option ${currentModel === key ? 'active' : ''} ${
                manualModelOverride === key ? 'manual' : ''
              }`}
              onClick={() => onModelSelect(key)}
              style={{ '--option-color': config.color } as React.CSSProperties}
            >
              <span className='option-icon'>{config.icon}</span>
              <div className='option-info'>
                <span className='option-name'>{config.shortName}</span>
                <span className='option-desc'>{config.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
