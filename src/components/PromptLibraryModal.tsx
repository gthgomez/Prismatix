// src/components/PromptLibraryModal.tsx
// F19: Reusable prompt template library modal with variable substitution.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import {
  listPromptTemplates,
  createPromptTemplate,
  deletePromptTemplate,
  duplicatePromptTemplate,
  substituteVariables,
  type PromptTemplate,
} from '../services/promptTemplateService';
import '../styles/KnowledgeWorkspace.css';

interface PromptLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (promptText: string) => void;
  activeProjectId?: string | null;
}

export const PromptLibraryModal: React.FC<PromptLibraryModalProps> = ({
  isOpen,
  onClose,
  onSelectPrompt,
  activeProjectId,
}) => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isCreating, setIsCreating] = useState(false);

  // New template form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newTemplateText, setNewTemplateText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = async () => {
    const list = await listPromptTemplates(supabase, {
      projectId: activeProjectId,
      search: search || undefined,
    });
    setTemplates(list);
  };

  useEffect(() => {
    if (isOpen) {
      void loadTemplates();
      setSelectedTemplate(null);
      setIsCreating(false);
    }
  }, [isOpen, activeProjectId, search]);

  if (!isOpen) return null;

  const handleSelectTemplateToUse = (tpl: PromptTemplate) => {
    setSelectedTemplate(tpl);
    const initialVals: Record<string, string> = {};
    for (const v of tpl.variables) {
      initialVals[v] = '';
    }
    setVariableValues(initialVals);
  };

  const handleApplyToComposer = () => {
    if (!selectedTemplate) return;
    const resolved = substituteVariables(selectedTemplate.template, variableValues);
    onSelectPrompt(resolved);
    onClose();
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newTemplateText.trim()) return;

    setIsSaving(true);
    const res = await createPromptTemplate(supabase, {
      title: newTitle,
      description: newDescription,
      category: newCategory,
      template: newTemplateText,
      projectId: activeProjectId,
    });
    setIsSaving(false);

    if (res.success && res.template) {
      setNewTitle('');
      setNewDescription('');
      setNewTemplateText('');
      setIsCreating(false);
      void loadTemplates();
    }
  };

  const handleDelete = async (id: string) => {
    await deletePromptTemplate(supabase, id);
    if (selectedTemplate?.id === id) setSelectedTemplate(null);
    void loadTemplates();
  };

  const handleDuplicate = async (id: string) => {
    await duplicatePromptTemplate(supabase, id);
    void loadTemplates();
  };

  const filtered = templates.filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    return true;
  });

  const previewResolved = selectedTemplate
    ? substituteVariables(selectedTemplate.template, variableValues)
    : '';

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose} role='dialog' aria-modal='true'>
      <div
        className='knowledge-modal-card prompt-library-modal'
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '750px', width: '92%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className='knowledge-modal-header'>
          <h3>Prompt Library</h3>
          <button
            type='button'
            className='knowledge-modal-close'
            onClick={onClose}
            aria-label='Close prompt library'
          >
            ✕
          </button>
        </div>

        <div className='knowledge-modal-body' style={{ overflowY: 'auto', flex: 1 }}>
          {isCreating ? (
            <form onSubmit={handleCreateNew} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4>Create Prompt Template</h4>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>Template Title</label>
                <input
                  type='text'
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder='e.g., Code Reviewer, API Spec Generator'
                  required
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>Description</label>
                <input
                  type='text'
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder='Brief explanation of what this prompt does'
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                  }}
                >
                  <option value='general'>General</option>
                  <option value='coding'>Coding</option>
                  <option value='writing'>Writing</option>
                  <option value='analysis'>Analysis</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>
                  Prompt Template Text (use <code>{'{{variable}}'}</code> for placeholder fields)
                </label>
                <textarea
                  value={newTemplateText}
                  onChange={(e) => setNewTemplateText(e.target.value)}
                  rows={5}
                  placeholder='Review this {{language}} code snippet for performance and security flaws:&#10;&#10;{{code}}'
                  required
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type='button'
                  className='knowledge-btn-secondary'
                  onClick={() => setIsCreating(false)}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  className='knowledge-btn-primary'
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save Template'}
                </button>
              </div>
            </form>
          ) : selectedTemplate ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <button
                  type='button'
                  onClick={() => setSelectedTemplate(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary, #4ecdc4)', cursor: 'pointer', fontSize: '0.85rem', padding: 0, marginBottom: '0.5rem' }}
                >
                  ← Back to template list
                </button>
                <h4>{selectedTemplate.title}</h4>
                {selectedTemplate.description && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim, #9ca3af)' }}>{selectedTemplate.description}</p>
                )}
              </div>

              {selectedTemplate.variables.length > 0 && (
                <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '0.75rem', borderRadius: '6px' }}>
                  <h5 style={{ marginBottom: '0.5rem' }}>Fill Template Variables:</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {selectedTemplate.variables.map((varName) => (
                      <div key={varName}>
                        <label style={{ fontSize: '0.75rem', color: '#4ecdc4', fontWeight: 600 }}>{`{{${varName}}}`}</label>
                        <input
                          type='text'
                          value={variableValues[varName] || ''}
                          onChange={(e) =>
                            setVariableValues((prev) => ({ ...prev, [varName]: e.target.value }))
                          }
                          placeholder={`Enter value for ${varName}`}
                          style={{
                            width: '100%',
                            padding: '0.4rem',
                            marginTop: '0.2rem',
                            background: 'var(--color-surface, #1f2937)',
                            border: '1px solid var(--color-border, #374151)',
                            borderRadius: '4px',
                            color: 'inherit',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h5 style={{ marginBottom: '0.35rem' }}>Resolved Prompt Preview:</h5>
                <pre
                  style={{
                    background: '#111827',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border, #374151)',
                  }}
                >
                  {previewResolved}
                </pre>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type='button'
                  className='knowledge-btn-secondary'
                  onClick={() => setSelectedTemplate(null)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='knowledge-btn-primary'
                  onClick={handleApplyToComposer}
                >
                  Insert into Composer
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type='text'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder='Search templates…'
                  style={{
                    padding: '0.45rem 0.75rem',
                    background: 'var(--color-surface, #1f2937)',
                    border: '1px solid var(--color-border, #374151)',
                    borderRadius: '4px',
                    color: 'inherit',
                    flex: '1 1 200px',
                  }}
                />

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    style={{
                      padding: '0.45rem',
                      background: 'var(--color-surface, #1f2937)',
                      border: '1px solid var(--color-border, #374151)',
                      borderRadius: '4px',
                      color: 'inherit',
                    }}
                  >
                    <option value='all'>All Categories</option>
                    <option value='general'>General</option>
                    <option value='coding'>Coding</option>
                    <option value='writing'>Writing</option>
                    <option value='analysis'>Analysis</option>
                  </select>

                  <button
                    type='button'
                    className='knowledge-btn-primary'
                    onClick={() => setIsCreating(true)}
                  >
                    + New Template
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {filtered.map((tpl) => (
                  <div
                    key={tpl.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--color-border, #374151)',
                      borderRadius: '6px',
                      padding: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h5 style={{ margin: 0, fontWeight: 600 }}>{tpl.title}</h5>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            background: 'rgba(78, 205, 196, 0.15)',
                            color: '#4ecdc4',
                            textTransform: 'capitalize',
                          }}
                        >
                          {tpl.category}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--color-text-dim, #9ca3af)',
                          margin: '0.4rem 0',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {tpl.description || tpl.template}
                      </p>
                      {tpl.variables.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                          {tpl.variables.map((v) => (
                            <span
                              key={v}
                              style={{
                                fontSize: '0.65rem',
                                background: 'rgba(255, 255, 255, 0.08)',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '3px',
                              }}
                            >
                              {`{{${v}}}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type='button'
                          onClick={() => handleDuplicate(tpl.id)}
                          title='Duplicate template'
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                          📋
                        </button>
                        <button
                          type='button'
                          onClick={() => handleDelete(tpl.id)}
                          title='Delete template'
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#ef4444' }}
                        >
                          🗑️
                        </button>
                      </div>
                      <button
                        type='button'
                        className='knowledge-btn'
                        onClick={() => handleSelectTemplateToUse(tpl)}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.6rem',
                          background: 'var(--color-primary, #4ecdc4)',
                          color: '#0f172a',
                          fontWeight: 600,
                          borderRadius: '4px',
                        }}
                      >
                        Use Template
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-dim, #9ca3af)' }}>
                  No templates found. Click <strong>+ New Template</strong> to create one.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
