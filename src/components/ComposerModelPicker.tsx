// src/components/ComposerModelPicker.tsx
// Compact model selector pill for ChatInputComposer with rich popover for
// auto-routing, favorites, provider filtering, and direct provider settings link.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeminiFlashThinkingLevel, RouterModel } from '../types';
import {
  formatModelPriceLabel,
  getCatalogEntry,
} from '../modelCatalog';
import {
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  hasOpenRouterRoute,
  providerForModel,
  type ProviderId,
} from '../providerRegistry';
import { useModelCatalogFilter } from '../hooks/useModelCatalogFilter';
import type { ModelPickerPreferencesHook } from '../hooks/useModelPickerPreferences';
import type { DebateSelection } from '../debateMode';

export interface ComposerModelPickerProps {
  currentModel: RouterModel;
  manualModelOverride: RouterModel | null;
  enabledProviders: ReadonlySet<ProviderId>;
  preferences: ModelPickerPreferencesHook;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  geminiFlashThinkingLevel?: GeminiFlashThinkingLevel;
  debateSelection?: DebateSelection;
  onModelSelect: (model: RouterModel) => void;
  onClearOverride: () => void;
  onGeminiThinkingChange?: (level: GeminiFlashThinkingLevel) => void;
  onOpenProviderSettings: () => void;
  disabled?: boolean;
}

export const ComposerModelPicker: React.FC<ComposerModelPickerProps> = ({
  currentModel,
  manualModelOverride,
  enabledProviders,
  preferences,
  inputRef,
  geminiFlashThinkingLevel,
  debateSelection,
  onModelSelect,
  onClearOverride,
  onGeminiThinkingChange,
  onOpenProviderSettings,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [popoverCoords, setPopoverCoords] = useState<{ bottom: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const listboxId = useId();

  const {
    favoriteModels,
    hiddenModels,
    activeProviderFilter,
    toggleFavorite,
    setProviderFilter,
    isFavorite,
  } = preferences;

  // If the active filter tab belongs to a provider that was disabled, fall back to 'all'
  const effectiveProviderFilter: ProviderId | 'all' =
    activeProviderFilter === 'all' || enabledProviders.has(activeProviderFilter)
      ? activeProviderFilter
      : 'all';

  const {
    filteredModels,
    pinnedModels,
    groupedModels,
  } = useModelCatalogFilter({
    enabledProviders,
    hiddenModels,
    favoriteModels,
    searchQuery,
    providerFilter: effectiveProviderFilter,
  });

  // Calculate coordinates to anchor the popover dynamically right above the trigger
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPopoverCoords({
      bottom: window.innerHeight - rect.top + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 380)),
      width: Math.min(380, window.innerWidth - 24),
    });
  };

  const handleOpen = () => {
    if (disabled) return;
    // On mobile devices, blur active textarea to prevent virtual keyboard from pushing/obscuring popover
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      inputRef?.current?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    updatePosition();
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  // Keep popover positioned on scroll/resize and textarea resizing
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && triggerRef.current) {
      ro = new ResizeObserver(onResize);
      ro.observe(triggerRef.current);
      if (triggerRef.current.parentElement) {
        ro.observe(triggerRef.current.parentElement);
      }
    }

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      ro?.disconnect();
    };
  }, [isOpen]);

  // Focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Click outside and escape handling
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        handleClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const activeEntry = getCatalogEntry(manualModelOverride ?? currentModel);
  // Flash thinking level applies only when a Gemini Flash family model is selected
  const activeModelId = manualModelOverride ?? currentModel;
  const isGeminiFlashModel =
    activeModelId.startsWith('gemini-') && activeModelId.includes('flash');

  // Available provider tabs: 'all' + enabled providers that have models
  const providerTabs = useMemo(() => {
    const list: Array<{ id: ProviderId | 'all'; label: string }> = [
      { id: 'all', label: 'All' },
    ];
    for (const p of PROVIDER_PLUGIN_ORDER) {
      if (enabledProviders.has(p)) {
        list.push({ id: p, label: PROVIDER_PLUGINS[p].label });
      }
    }
    return list;
  }, [enabledProviders]);

  const renderModelItem = (modelId: RouterModel, sectionKey: string) => {
    const config = getCatalogEntry(modelId);
    const isSelected = manualModelOverride === modelId;
    const isFav = isFavorite(modelId);
    const providerId = providerForModel(modelId);
    const viaOpenRouter =
      providerId !== 'other' &&
      providerId !== 'openrouter' &&
      !enabledProviders.has(providerId) &&
      enabledProviders.has('openrouter') &&
      hasOpenRouterRoute(modelId);

    return (
      <div
        key={`${sectionKey}-${modelId}`}
        className={`composer-model-item ${isSelected ? 'is-selected' : ''}`}
      >
        <button
          type='button'
          className='composer-model-item-btn'
          role='option'
          aria-selected={isSelected}
          onClick={() => {
            onModelSelect(modelId);
            handleClose();
          }}
        >
          <span className='composer-model-icon' aria-hidden='true'>
            {config.icon}
          </span>
          <div className='composer-model-details'>
            <div className='composer-model-title-row'>
              <span className='composer-model-name' style={{ color: config.color }}>
                {config.shortName}
              </span>
              {viaOpenRouter && (
                <span className='composer-model-route-badge'>via OpenRouter</span>
              )}
            </div>
            <span className='composer-model-desc'>{config.description}</span>
            <span className='composer-model-rate'>{formatModelPriceLabel(modelId)}</span>
          </div>
        </button>

        <button
          type='button'
          className={`composer-model-fav-btn ${isFav ? 'is-fav' : ''}`}
          title={isFav ? 'Unpin from quick access' : 'Pin to quick access'}
          aria-label={isFav ? `Unpin ${config.shortName}` : `Pin ${config.shortName}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(modelId);
          }}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
    );
  };

  const popoverContent = isOpen && (
    <div
      ref={popoverRef}
      className='composer-model-popover glass-surface'
      data-glass-variant='floating'
      data-glass-mode='glass'
      role='dialog'
      aria-modal='true'
      aria-label='Choose model or routing'
      style={
        popoverCoords
          ? ({
              '--popover-bottom': `${popoverCoords.bottom}px`,
              '--popover-left': `${popoverCoords.left}px`,
              '--popover-width': `${popoverCoords.width}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className='composer-model-popover-header'>
        <div className='composer-model-search-box'>
          <span className='composer-model-search-icon' aria-hidden='true'>🔍</span>
          <input
            ref={searchInputRef}
            type='search'
            className='composer-model-search-input'
            placeholder='Search models or capabilities...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label='Search models'
            autoComplete='off'
          />
          {searchQuery && (
            <button
              type='button'
              className='composer-model-search-clear'
              onClick={() => setSearchQuery('')}
              aria-label='Clear search'
            >
              ×
            </button>
          )}
        </div>
        <button
          type='button'
          className='composer-model-settings-link'
          onClick={() => {
            handleClose();
            onOpenProviderSettings();
          }}
          title='Configure provider API keys'
        >
          ⚙ Providers
        </button>
      </div>

      {/* Provider filter tags */}
      <div className='composer-model-provider-tabs' role='tablist' aria-label='Filter by provider'>
        {providerTabs.map((tab) => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={activeProviderFilter === tab.id}
            className={`composer-provider-tab ${
              activeProviderFilter === tab.id ? 'is-active' : ''
            }`}
            onClick={() => setProviderFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={listboxId}
        className='composer-model-scroll-area'
        role='listbox'
        aria-label='Available models'
      >
        {/* Smart Auto-Routing Row */}
        {!searchQuery.trim() && (
          <div className='composer-model-section'>
            <div className='composer-model-section-title'>Routing Intelligence</div>
            <button
              type='button'
              className={`composer-model-item-btn composer-auto-route-card ${
                !manualModelOverride ? 'is-selected' : ''
              }`}
              onClick={() => {
                onClearOverride();
                handleClose();
              }}
            >
              <span className='composer-model-icon' aria-hidden='true'>✨</span>
              <div className='composer-model-details'>
                <div className='composer-model-title-row'>
                  <span className='composer-model-name'>Prismatix Smart Router</span>
                  <span className='composer-model-auto-badge'>Auto</span>
                </div>
                <span className='composer-model-desc'>
                  Automatically selects the best model per prompt complexity
                </span>
              </div>
            </button>
          </div>
        )}

        {/* Pinned / Favorites */}
        {!searchQuery.trim() && pinnedModels.length > 0 && activeProviderFilter === 'all' && (
          <div className='composer-model-section'>
            <div className='composer-model-section-title'>Quick Access / Pinned</div>
            <div className='composer-model-list'>
              {pinnedModels.map((m) => renderModelItem(m, 'fav'))}
            </div>
          </div>
        )}

        {/* Grouped or Filtered Models */}
        {filteredModels.length === 0 ? (
          <div className='composer-model-empty' role='status'>
            No models match “{searchQuery}”.
          </div>
        ) : activeProviderFilter === 'all' && !searchQuery.trim() ? (
          groupedModels.map((group) => (
            <div key={group.provider} className='composer-model-section'>
              <div className='composer-model-section-title'>{group.label}</div>
              <div className='composer-model-list'>
                {group.models.map((m) => renderModelItem(m, group.provider))}
              </div>
            </div>
          ))
        ) : (
          <div className='composer-model-section'>
            <div className='composer-model-list'>
              {filteredModels.map((m) => renderModelItem(m, 'filtered'))}
            </div>
          </div>
        )}
      </div>

      <div className='composer-model-popover-footer'>
        <button
          type='button'
          className='composer-model-footer-provider-btn'
          onClick={() => {
            handleClose();
            onOpenProviderSettings();
          }}
        >
          Manage Providers &amp; Keys…
        </button>
      </div>
    </div>
  );

  return (
    <div className='composer-model-picker-container'>
      {/* Trigger Pill */}
      <div className='composer-model-pill-wrapper'>
        <button
          ref={triggerRef}
          type='button'
          className={`composer-model-pill ${manualModelOverride ? 'is-manual' : 'is-auto'}`}
          onClick={() => (isOpen ? handleClose() : handleOpen())}
          aria-haspopup='dialog'
          aria-expanded={isOpen}
          aria-controls={listboxId}
          title={
            manualModelOverride
              ? `Model locked to ${activeEntry.name} (Click to switch)`
              : `Automatic routing active (Currently ${activeEntry.name})`
          }
          disabled={disabled}
        >
          <span className='composer-pill-icon' aria-hidden='true'>
            {manualModelOverride ? activeEntry.icon : '✨'}
          </span>
          <span
            className='composer-pill-label'
            style={{ color: manualModelOverride ? activeEntry.color : undefined }}
          >
            {manualModelOverride ? activeEntry.shortName : 'Auto Router'}
          </span>

          <span className={`composer-pill-badge ${manualModelOverride ? 'manual' : 'auto'}`}>
            {manualModelOverride ? 'Manual' : 'Auto'}
          </span>

          {debateSelection && debateSelection !== 'off' && (
            <span className='composer-pill-badge debate'>
              {debateSelection === 'auto' ? 'Debate (Auto)' : 'Debate'}
            </span>
          )}

          <span className={`composer-pill-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden='true'>
            ▾
          </span>
        </button>

        {/* Snap-back to Auto Button when in Manual mode */}
        {manualModelOverride && (
          <button
            type='button'
            className='composer-pill-clear-btn'
            onClick={(e) => {
              e.stopPropagation();
              onClearOverride();
            }}
            title='Reset to Automatic Routing'
            aria-label='Reset to Automatic Routing'
          >
            ×
          </button>
        )}

        {/* Inline Gemini Thinking Toggle: applies strictly to Gemini Flash family models */}
        {isGeminiFlashModel && onGeminiThinkingChange && geminiFlashThinkingLevel && (
          <button
            type='button'
            className='composer-thinking-pill'
            title={`Flash Thinking: ${geminiFlashThinkingLevel} (Click to switch)`}
            aria-label={`Flash Thinking: ${geminiFlashThinkingLevel}`}
            onClick={() =>
              onGeminiThinkingChange(geminiFlashThinkingLevel === 'high' ? 'low' : 'high')
            }
          >
            🧠 {geminiFlashThinkingLevel === 'high' ? 'Think: High' : 'Think: Low'}
          </button>
        )}
      </div>

      {/* Render Popover via React Portal */}
      {typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
    </div>
  );
};
