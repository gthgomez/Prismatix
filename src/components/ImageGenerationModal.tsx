// src/components/ImageGenerationModal.tsx
// BYOK image generation modal with transparent cost disclosure and explicit opt-in.

import React, { useState } from 'react';
import {
  SUPPORTED_IMAGE_MODELS,
  estimateImageCost,
  executeImageGeneration,
  type ImageGenerationResult,
} from '../services/imageGenerationService';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';

export interface ImageGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageGenerated: (result: ImageGenerationResult) => void;
  initialPrompt?: string;
  userApiKey?: string;
  providerPlugins?: ProviderPlugins;
  onOpenProviderSettings?: () => void;
}

export const ImageGenerationModal: React.FC<ImageGenerationModalProps> = ({
  isOpen,
  onClose,
  onImageGenerated,
  initialPrompt = '',
  userApiKey,
  providerPlugins,
  onOpenProviderSettings,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [selectedModelId, setSelectedModelId] = useState('flux-1-schnell');
  const [selectedSize, setSelectedSize] = useState('1024x1024');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [useMockMode, setUseMockMode] = useState(false);

  if (!isOpen) return null;

  const currentModel = SUPPORTED_IMAGE_MODELS.find((m) => m.id === selectedModelId) || SUPPORTED_IMAGE_MODELS[0];
  const estimatedCost = estimateImageCost(selectedModelId, selectedSize);

  // Check provider key readiness
  const providerState = providerPlugins?.providers.find((p) => p.id === currentModel?.provider);
  const isKeyConfigured = Boolean(userApiKey || (providerState?.hasKey && providerState?.enabled));

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setErrorMessage('Please enter an image prompt.');
      return;
    }

    if (!isKeyConfigured && !useMockMode) {
      setErrorMessage(`Please configure your ${currentModel?.provider.toUpperCase()} API key in Provider Settings, or enable Mock Preview mode.`);
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const result = await executeImageGeneration({
        prompt: prompt.trim(),
        modelId: selectedModelId,
        size: selectedSize,
        apiKey: userApiKey,
        mockMode: useMockMode || !userApiKey,
      });

      if (result.success) {
        onImageGenerated(result);
        onClose();
      } else {
        setErrorMessage(result.error || 'Image generation failed.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown generation failure');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      className='modal-overlay image-gen-modal-overlay'
      role='dialog'
      aria-modal='true'
      aria-labelledby='image-gen-title'
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1rem',
      }}
    >
      <div
        className='modal-card image-generation-modal'
        style={{
          background: 'var(--color-bg-primary, #18181b)',
          border: '1px solid var(--color-border, #27272a)',
          borderRadius: 'var(--radius-lg, 12px)',
          width: '100%',
          maxWidth: '540px',
          padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id='image-gen-title' style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary, #fafafa)' }}>
            🎨 Generate Image (BYOK)
          </h2>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close modal'
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '1.25rem' }}
          >
            ✕
          </button>
        </div>

        <div>
          <label htmlFor='img-prompt-input' style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.35rem' }}>
            Prompt
          </label>
          <textarea
            id='img-prompt-input'
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='A vibrant watercolor landscape of mountains at sunrise...'
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '0.75rem',
              backgroundColor: 'var(--color-bg-secondary, #27272a)',
              color: 'var(--color-text-primary, #fafafa)',
              border: '1px solid var(--color-border, #3f3f46)',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: '0.95rem',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label htmlFor='img-model-select' style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.35rem' }}>
              Model
            </label>
            <select
              id='img-model-select'
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                backgroundColor: 'var(--color-bg-secondary, #27272a)',
                color: 'var(--color-text-primary, #fafafa)',
                border: '1px solid var(--color-border, #3f3f46)',
                borderRadius: 'var(--radius-md, 8px)',
              }}
            >
              {SUPPORTED_IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (${m.costPerImageUsd.toFixed(3)}/img)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor='img-size-select' style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.35rem' }}>
              Dimensions
            </label>
            <select
              id='img-size-select'
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                backgroundColor: 'var(--color-bg-secondary, #27272a)',
                color: 'var(--color-text-primary, #fafafa)',
                border: '1px solid var(--color-border, #3f3f46)',
                borderRadius: 'var(--radius-md, 8px)',
              }}
            >
              {currentModel?.supportedSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Provider Readiness / Missing Key Notice */}
        {!isKeyConfigured && !useMockMode && (
          <div
            style={{
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: 'var(--radius-md, 8px)',
              padding: '0.75rem',
              fontSize: '0.85rem',
              color: '#fef08a',
            }}
          >
            <div style={{ fontWeight: 600 }}>No {currentModel?.provider.toUpperCase()} API key configured</div>
            <div style={{ margin: '0.35rem 0', color: '#e2e8f0', fontSize: '0.8rem' }}>
              To generate live images using your BYOK account, configure your API key in Provider Settings.
              Alternatively, you can test with deterministic mock preview.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              {onOpenProviderSettings && (
                <button
                  type='button'
                  onClick={() => {
                    onClose();
                    onOpenProviderSettings();
                  }}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    background: '#eab308',
                    color: '#000',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Open Provider Settings
                </button>
              )}
              <button
                type='button'
                onClick={() => setUseMockMode(true)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  background: 'transparent',
                  color: '#fef08a',
                  border: '1px solid #eab308',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Use Mock Preview (Unmetered)
              </button>
            </div>
          </div>
        )}

        {/* Cost & Policy Transparency Notice */}
        <div
          style={{
            backgroundColor: useMockMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(78, 205, 196, 0.08)',
            border: `1px solid ${useMockMode ? 'rgba(59, 130, 246, 0.3)' : 'rgba(78, 205, 196, 0.25)'}`,
            borderRadius: 'var(--radius-md, 8px)',
            padding: '0.75rem',
            fontSize: '0.85rem',
            color: useMockMode ? '#93c5fd' : '#d1fae5',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
            {useMockMode ? 'Deterministic Mock Preview (Unmetered)' : `Estimated cost: ~$${estimatedCost.toFixed(4)} USD`}
          </div>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
            {useMockMode
              ? 'Generates local SVG placeholder without calling paid provider APIs or settling charges.'
              : `Charged to your ${currentModel?.provider.toUpperCase()} BYOK key. No deployment markups or hidden fees.`}
          </div>
          {useMockMode && (
            <button
              type='button'
              onClick={() => setUseMockMode(false)}
              style={{
                marginTop: '0.4rem',
                fontSize: '0.75rem',
                color: '#60a5fa',
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Switch back to Live BYOK
            </button>
          )}
        </div>

        {errorMessage && (
          <div
            role='alert'
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              borderRadius: 'var(--radius-md, 8px)',
              padding: '0.6rem 0.8rem',
              fontSize: '0.85rem',
            }}
          >
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type='button'
            onClick={onClose}
            disabled={isGenerating}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid #3f3f46',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type='button'
            className='generate-image-confirm-btn'
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || (!isKeyConfigured && !useMockMode)}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 'var(--radius-md, 8px)',
              border: 'none',
              background: useMockMode ? '#3b82f6' : '#4ECDC4',
              color: useMockMode ? '#ffffff' : '#000',
              fontWeight: 600,
              cursor: isGenerating || !prompt.trim() || (!isKeyConfigured && !useMockMode) ? 'not-allowed' : 'pointer',
              opacity: isGenerating || !prompt.trim() || (!isKeyConfigured && !useMockMode) ? 0.6 : 1,
            }}
          >
            {isGenerating
              ? 'Generating Image...'
              : useMockMode
              ? 'Generate Mock Preview ($0.00)'
              : `Generate Image ($${estimatedCost.toFixed(3)})`}
          </button>
        </div>
      </div>
    </div>
  );
};
