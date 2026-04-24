// ModelSelectorDropdown.tsx — Routing / debate vs model override (tabbed), layout prefs persisted

import React, { useEffect, useMemo, useState } from 'react';
import type { GeminiFlashThinkingLevel, RouterModel, RouterProvider } from '../types';
import {
  MODEL_CATALOG,
  MODEL_EXTENDED_ORDER,
  MODEL_HIGHLIGHTS,
  MODEL_ORDER,
} from '../modelCatalog';
import { DEBATE_SELECTIONS, type DebateSelection } from '../debateMode';
import {
  complexityScoreRoutingHint,
  ROUTING_SCORE_GATE_LEGEND,
} from '../routingThresholds';

const LS_GROUP = 'prismatix.modelSelector.groupByProvider';
const LS_TAB = 'prismatix.modelSelector.activeTab';

const OVERRIDE_PROVIDER_ORDER: RouterProvider[] = [
  'anthropic',
  'openai',
  'google',
  'nvidia',
  'deepinfra',
];

const PROVIDER_LABEL: Record<RouterProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  nvidia: 'NVIDIA',
  deepinfra: 'DeepInfra',
};

type SelectorTab = 'routing' | 'models';

function readStoredGroupByProvider(): boolean {
  try {
    const v = localStorage.getItem(LS_GROUP);
    if (v === 'flat') return false;
    return true;
  } catch {
    return true;
  }
}

function readStoredTab(): SelectorTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    return v === 'models' ? 'models' : 'routing';
  } catch {
    return 'routing';
  }
}

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
  const [activeTab, setActiveTab] = useState<SelectorTab>(() =>
    sendValidationError ? 'routing' : readStoredTab(),
  );
  const [showAllOverrides, setShowAllOverrides] = useState(false);
  const [groupByProvider, setGroupByProvider] = useState(readStoredGroupByProvider);

  useEffect(() => {
    if (!sendValidationError) return;
    setActiveTab('routing');
    try {
      localStorage.setItem(LS_TAB, 'routing');
    } catch {
      /* ignore */
    }
  }, [sendValidationError]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_GROUP, groupByProvider ? 'grouped' : 'flat');
    } catch {
      /* ignore */
    }
  }, [groupByProvider]);

  const setTab = (tab: SelectorTab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(LS_TAB, tab);
    } catch {
      /* ignore */
    }
  };

  const extendedIncludesSelection = useMemo(
    () => MODEL_EXTENDED_ORDER.includes(currentModel),
    [currentModel],
  );

  const visibleOverrideKeys = useMemo(() => {
    if (showAllOverrides || extendedIncludesSelection) {
      return MODEL_ORDER;
    }
    return MODEL_HIGHLIGHTS;
  }, [showAllOverrides, extendedIncludesSelection]);

  const modelsByProvider = useMemo(() => {
    const keySet = new Set(visibleOverrideKeys);
    return OVERRIDE_PROVIDER_ORDER.map((provider) => ({
      provider,
      label: PROVIDER_LABEL[provider],
      models: MODEL_ORDER.filter(
        (id) => keySet.has(id) && modelConfig[id].provider === provider,
      ),
    })).filter((g) => g.models.length > 0);
  }, [visibleOverrideKeys, modelConfig]);

  const renderModelButton = (key: RouterModel) => {
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
  };

  const routingHint = complexityScoreRoutingHint(currentComplexity);

  return (
    <div className='model-dropdown'>
      <div className='dropdown-header'>
        <span>Model & routing</span>
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

      <div className='model-dropdown-nav' role='tablist' aria-label='Model menu sections'>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'routing'}
          className={`model-dropdown-tab ${activeTab === 'routing' ? 'active' : ''}`}
          onClick={() => setTab('routing')}
        >
          Routing & debate
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'models'}
          className={`model-dropdown-tab ${activeTab === 'models' ? 'active' : ''}`}
          onClick={() => setTab('models')}
        >
          Models
        </button>
      </div>

      {activeTab === 'routing' && (
        <div className='model-dropdown-panel' role='tabpanel'>
          <div className='dropdown-section-title'>Routing intelligence</div>
          <div className='dropdown-options-grid'>
            <div className='complexity-status-item'>
              <div className='status-header'>
                <span className='status-label'>Current task complexity</span>
                <span className='complexity-value'>{currentComplexity}</span>
              </div>
              <div className='complexity-bar'>
                <div
                  className='complexity-fill'
                  style={{ width: `${currentComplexity}%` }}
                />
              </div>
              <span className='routing-logic-hint'>{routingHint}</span>
              <span className='routing-logic-legend'>{ROUTING_SCORE_GATE_LEGEND}</span>
            </div>

            <div className='dropdown-divider' />

            <div className='dropdown-controls-row'>
              <div
                className='thinking-toggle-container'
                title='Applies when a Gemini Flash family model is selected'
              >
                <span className='thinking-toggle-label'>Flash thinking</span>
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
                <span className='debate-toggle-label'>Debate mode</span>
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

            {sendValidationError && (
              <div className='model-dropdown-validation-wrap'>
                <div className='model-dropdown-validation' role='status'>
                  {sendValidationError}
                </div>
                <p className='model-dropdown-validation-footnote'>
                  Same guidance appears above the send box.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'models' && (
        <div className='model-dropdown-panel' role='tabpanel'>
          <div className='dropdown-section-title model-override-section-head'>
            <span>Manual override</span>
            <div
              className='model-override-layout-toggle'
              role='group'
              aria-label='Override list layout'
            >
              <button
                type='button'
                className={groupByProvider ? 'active' : ''}
                onClick={() => setGroupByProvider(true)}
                title='Organize models under provider headings'
              >
                By provider
              </button>
              <button
                type='button'
                className={!groupByProvider ? 'active' : ''}
                onClick={() => setGroupByProvider(false)}
                title='Listed output $/M (low → high) from pricing registry'
              >
                List order
              </button>
            </div>
          </div>

          <div className='model-options-scroll'>
            {groupByProvider ? (
              <div className='model-options model-options--grouped'>
                {modelsByProvider.map(({ provider, label, models }) => (
                  <div key={provider} className='model-provider-group'>
                    <div className='model-provider-heading'>{label}</div>
                    <div className='model-provider-models'>
                      {models.map((key) => renderModelButton(key))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className='model-options'>
                {visibleOverrideKeys.map((key) => renderModelButton(key))}
              </div>
            )}
          </div>

          {!showAllOverrides && !extendedIncludesSelection && MODEL_EXTENDED_ORDER.length > 0 && (
            <button
              type='button'
              className='model-override-expand'
              onClick={() => setShowAllOverrides(true)}
            >
              Show all models ({MODEL_ORDER.length})
            </button>
          )}
          {showAllOverrides && !extendedIncludesSelection && MODEL_EXTENDED_ORDER.length > 0 && (
            <button
              type='button'
              className='model-override-expand'
              onClick={() => setShowAllOverrides(false)}
            >
              Show fewer models
            </button>
          )}
        </div>
      )}
    </div>
  );
};
