// src/components/ProjectModal.tsx
// F09: Create/edit project workspaces with scoped instructions.

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createProject,
  updateProject,
  type Project,
} from '../services/projectService';
import {
  listProjectDocuments,
  addProjectDocument,
  deleteProjectDocument,
  type ProjectDocument,
} from '../services/projectDocumentLibrary';
import '../styles/KnowledgeWorkspace.css';

interface ProjectModalProps {
  client: SupabaseClient;
  isOpen: boolean;
  initialProject?: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}

const MAX_INSTRUCTIONS_LENGTH = 12000;

export const ProjectModal: React.FC<ProjectModalProps> = ({
  client,
  isOpen,
  initialProject,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'documents'>('settings');
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadDocName, setUploadDocName] = useState('');
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);

  const loadDocuments = async (projectId: string) => {
    setIsLoadingDocs(true);
    try {
      const docs = await listProjectDocuments(client, projectId);
      setDocuments(docs);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  useEffect(() => {
    if (isOpen && initialProject?.id && activeTab === 'documents') {
      void loadDocuments(initialProject.id);
    }
  }, [isOpen, initialProject?.id, activeTab]);

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialProject?.id || !uploadText.trim() || !uploadDocName.trim()) return;

    setIsUploadingDoc(true);
    try {
      const res = await addProjectDocument(client, {
        projectId: initialProject.id,
        name: uploadDocName.trim(),
        extractedText: uploadText.trim(),
      });
      if (res.success && res.document) {
        setDocuments((prev) => [res.document!, ...prev]);
        setUploadText('');
        setUploadDocName('');
      } else {
        setError(res.error || 'Failed to add document.');
      }
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const ok = await deleteProjectDocument(client, docId);
    if (ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialProject) {
        setName(initialProject.name);
        setDescription(initialProject.description);
        setInstructions(initialProject.instructions);
      } else {
        setName('');
        setDescription('');
        setInstructions('');
      }
      setError(null);
    }
  }, [isOpen, initialProject]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Project name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let saved: Project;
      if (initialProject) {
        saved = await updateProject(client, initialProject.id, {
          name: trimmedName,
          description: description.trim(),
          instructions: instructions.trim(),
        });
      } else {
        saved = await createProject(client, {
          name: trimmedName,
          description: description.trim(),
          instructions: instructions.trim(),
        });
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose}>
      <div
        className='knowledge-modal-card'
        role='dialog'
        aria-label={initialProject ? 'Edit Project' : 'New Project'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='knowledge-modal-header'>
          <h3>{initialProject ? 'Edit Project Workspace' : 'New Project Workspace'}</h3>
          <button
            type='button'
            className='btn-secondary'
            style={{ border: 'none', padding: '0.2rem 0.5rem', fontSize: '1.2rem' }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {initialProject && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', padding: '0 1.5rem' }}>
            <button
              type='button'
              onClick={() => setActiveTab('settings')}
              style={{
                padding: '0.6rem 1rem',
                border: 'none',
                background: 'none',
                color: activeTab === 'settings' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                borderBottom: activeTab === 'settings' ? '2px solid #4ecdc4' : 'none',
                fontWeight: activeTab === 'settings' ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              Workspace Settings
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('documents')}
              style={{
                padding: '0.6rem 1rem',
                border: 'none',
                background: 'none',
                color: activeTab === 'documents' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                borderBottom: activeTab === 'documents' ? '2px solid #4ecdc4' : 'none',
                fontWeight: activeTab === 'documents' ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              Knowledge Files (F21)
            </button>
          </div>
        )}

        {activeTab === 'settings' ? (
          <form onSubmit={handleSubmit}>
            <div className='knowledge-modal-body'>
              {error && (
                <div
                  style={{
                    background: 'rgba(255, 107, 107, 0.15)',
                    border: '1px solid rgba(255, 107, 107, 0.3)',
                    color: 'var(--color-danger, #ff6b6b)',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                  }}
                >
                  {error}
                </div>
              )}

              <div className='form-group'>
                <label htmlFor='project-name'>Project Name *</label>
                <input
                  id='project-name'
                  type='text'
                  placeholder='e.g. Q4 Tax Planning, Mobile App Refactor'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoFocus
                  required
                />
              </div>

              <div className='form-group'>
                <label htmlFor='project-desc'>Description (optional)</label>
                <input
                  id='project-desc'
                  type='text'
                  placeholder='Brief description of this workspace'
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={250}
                />
              </div>

              <div className='form-group'>
                <label htmlFor='project-instructions'>
                  Scoped System Instructions
                </label>
                <textarea
                  id='project-instructions'
                  rows={5}
                  placeholder='Instructions automatically injected into all prompts in this workspace (e.g. "Always respond in TypeScript with strict typing. Never use any.")'
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH))}
                />
                <div className='instructions-counter'>
                  {instructions.length} / {MAX_INSTRUCTIONS_LENGTH} characters
                </div>
              </div>
            </div>

            <div className='knowledge-modal-footer'>
              <button
                type='button'
                className='btn-secondary'
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type='submit'
                className='btn-primary'
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? 'Saving…' : initialProject ? 'Update Project' : 'Create Project'}
              </button>
            </div>
          </form>
        ) : (
          <div className='knowledge-modal-body' style={{ overflowY: 'auto', maxHeight: '60vh' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim, #9ca3af)', marginBottom: '1rem' }}>
              Persistent files in this workspace library are automatically chunked and indexed. They ground reasoning and responses across all conversations in this project.
            </p>

            {/* Add Document Form */}
            <form onSubmit={handleAddDocument} style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--color-border, #374151)' }}>
              <h5 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>Add Knowledge Document</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type='text'
                  placeholder='Document Name (e.g. API Architecture Spec v2.md)'
                  value={uploadDocName}
                  onChange={(e) => setUploadDocName(e.target.value)}
                  required
                  style={{
                    padding: '0.45rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                    fontSize: '0.85rem',
                  }}
                />
                <textarea
                  placeholder='Paste plain text or markdown content to index into workspace knowledge…'
                  value={uploadText}
                  onChange={(e) => setUploadText(e.target.value)}
                  rows={4}
                  required
                  style={{
                    padding: '0.45rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                  }}
                />
              </div>
              <button
                type='submit'
                className='knowledge-btn-primary'
                disabled={isUploadingDoc || !uploadDocName.trim() || !uploadText.trim()}
                style={{
                  padding: '0.4rem 0.8rem',
                  background: 'var(--color-primary, #4ecdc4)',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: '4px',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: isUploadingDoc || !uploadDocName.trim() || !uploadText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isUploadingDoc ? 'Indexing…' : 'Add to Knowledge Library'}
              </button>
            </form>

            {/* Document list */}
            {isLoadingDocs ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-dim, #9ca3af)' }}>Loading documents…</div>
            ) : documents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-dim, #9ca3af)' }}>
                No files in this project library yet. Add your first document above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.6rem 0.8rem',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border, rgba(255,255,255,0.05))',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.85rem' }}>📄 {doc.name}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim, #9ca3af)', marginTop: '0.2rem' }}>
                        {doc.metadata?.chunkCount ?? 1} chunks • {(doc.sizeBytes / 1024).toFixed(1)} KB • {new Date(doc.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type='button'
                      onClick={() => void handleDeleteDocument(doc.id)}
                      title='Delete document'
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0.3rem 0.5rem',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
