// src/components/ArtifactViewerModal.tsx
// Dedicated artifact viewer, editor, version history, and sandboxed preview modal.

import React, { useState } from 'react';
import {
  type Artifact,
  saveArtifactRevision,
  getFileExtensionForLanguage,
  createSandboxedHtmlPreview,
} from '../services/artifactService';

export interface ArtifactViewerModalProps {
  isOpen: boolean;
  artifact: Artifact | null;
  onClose: () => void;
  onUpdateArtifact?: (updated: Artifact) => void;
}

export const ArtifactViewerModal: React.FC<ArtifactViewerModalProps> = ({
  isOpen,
  artifact,
  onClose,
  onUpdateArtifact,
}) => {
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(artifact);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview' | 'history'>('editor');
  const [editedCode, setEditedCode] = useState(artifact?.currentContent || '');
  const [copied, setCopied] = useState(false);

  // Sync state when prop artifact changes
  React.useEffect(() => {
    if (artifact) {
      setCurrentArtifact(artifact);
      setEditedCode(artifact.currentContent);
    }
  }, [artifact]);

  if (!isOpen || !currentArtifact) return null;

  const handleSave = () => {
    const updated = saveArtifactRevision(currentArtifact, editedCode);
    setCurrentArtifact(updated);
    onUpdateArtifact?.(updated);
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editedCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    const ext = getFileExtensionForLanguage(currentArtifact.language);
    const filename = currentArtifact.title.includes('.')
      ? currentArtifact.title
      : `${currentArtifact.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}.${ext}`;

    const blob = new Blob([editedCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isPreviewable = ['html', 'svg', 'md', 'markdown'].includes(currentArtifact.language.toLowerCase());

  return (
    <div
      className='modal-overlay artifact-modal-overlay'
      role='dialog'
      aria-modal='true'
      aria-labelledby='artifact-title'
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1rem',
      }}
    >
      <div
        className='modal-card artifact-viewer-modal'
        style={{
          background: 'var(--color-bg-primary, #18181b)',
          border: '1px solid var(--color-border, #27272a)',
          borderRadius: 'var(--radius-lg, 12px)',
          width: '95%',
          maxWidth: '850px',
          height: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--color-border, #27272a)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--color-bg-secondary, #202024)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.2rem' }}>📦</span>
            <div>
              <h2 id='artifact-title' style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#fafafa' }}>
                {currentArtifact.title}
              </h2>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                Language: <strong style={{ color: '#4ECDC4' }}>{currentArtifact.language.toUpperCase()}</strong> • Version {currentArtifact.versions.length}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type='button'
              onClick={handleCopy}
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: '1px solid #3f3f46',
                background: 'transparent',
                color: '#d1d5db',
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              type='button'
              onClick={handleDownload}
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: '1px solid #3f3f46',
                background: 'transparent',
                color: '#d1d5db',
                cursor: 'pointer',
              }}
            >
              Download
            </button>
            <button
              type='button'
              onClick={onClose}
              aria-label='Close artifact viewer'
              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '1.2rem', padding: '0.2rem 0.5rem' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border, #27272a)',
            padding: '0 1.25rem',
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        >
          <button
            type='button'
            onClick={() => setActiveTab('editor')}
            style={{
              padding: '0.6rem 1rem',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'editor' ? '2px solid #4ECDC4' : '2px solid transparent',
              color: activeTab === 'editor' ? '#4ECDC4' : '#9ca3af',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Editor & Code
          </button>
          {isPreviewable && (
            <button
              type='button'
              onClick={() => setActiveTab('preview')}
              style={{
                padding: '0.6rem 1rem',
                border: 'none',
                background: 'none',
                borderBottom: activeTab === 'preview' ? '2px solid #4ECDC4' : '2px solid transparent',
                color: activeTab === 'preview' ? '#4ECDC4' : '#9ca3af',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Sandboxed Preview
            </button>
          )}
          <button
            type='button'
            onClick={() => setActiveTab('history')}
            style={{
              padding: '0.6rem 1rem',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'history' ? '2px solid #4ECDC4' : '2px solid transparent',
              color: activeTab === 'history' ? '#4ECDC4' : '#9ca3af',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Version History ({currentArtifact.versions.length})
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'editor' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem' }}>
              <textarea
                value={editedCode}
                onChange={(e) => setEditedCode(e.target.value)}
                aria-label='Artifact code content'
                style={{
                  flex: 1,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.9rem',
                  lineHeight: '1.5',
                  padding: '1rem',
                  backgroundColor: '#0f0f11',
                  color: '#e4e4e7',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                  resize: 'none',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button
                  type='button'
                  onClick={handleSave}
                  disabled={editedCode === currentArtifact.currentContent}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: editedCode !== currentArtifact.currentContent ? '#4ECDC4' : '#3f3f46',
                    color: editedCode !== currentArtifact.currentContent ? '#000' : '#71717a',
                    fontWeight: 600,
                    cursor: editedCode !== currentArtifact.currentContent ? 'pointer' : 'default',
                  }}
                >
                  Save as Version {currentArtifact.versions.length + 1}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div style={{ flex: 1, padding: '1rem', overflow: 'hidden' }}>
              {/* Strict sandboxing without allow-same-origin prevents parent DOM/storage access */}
              <iframe
                title='Artifact Sandboxed Preview'
                sandbox='allow-scripts'
                srcDoc={createSandboxedHtmlPreview(editedCode, currentArtifact.language)}
                style={{
                  width: '100%',
                  height: '100%',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {currentArtifact.versions.map((ver) => (
                  <div
                    key={ver.versionNumber}
                    style={{
                      padding: '0.75rem 1rem',
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                      backgroundColor: '#202024',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#fafafa' }}>
                        Version {ver.versionNumber} {ver.versionNumber === currentArtifact.versions.length && '(Current)'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                        Saved at: {new Date(ver.savedAt).toLocaleString()} • Author: {ver.author}
                      </div>
                    </div>
                    {ver.versionNumber !== currentArtifact.versions.length && (
                      <button
                        type='button'
                        onClick={() => {
                          setEditedCode(ver.content);
                          setActiveTab('editor');
                        }}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #3f3f46',
                          background: 'transparent',
                          color: '#4ECDC4',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                        }}
                      >
                        Restore Version
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
