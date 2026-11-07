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
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
