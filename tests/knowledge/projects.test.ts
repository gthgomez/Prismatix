// tests/knowledge/projects.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  createProject,
  listProjects,
  formatProjectContextPrompt,
  type Project,
} from '../../src/services/projectService';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Project Workspaces Service (F09)', () => {
  it('formats project instructions defensively with clear delimiters', () => {
    const project: Project = {
      id: 'p1',
      name: 'Tax Audit 2026',
      description: 'Reviewing receipts',
      instructions: 'Format all monetary values with 2 decimals. Flag items over $500.',
      archived: false,
      createdAt: '2026-11-07T00:00:00Z',
      updatedAt: '2026-11-07T00:00:00Z',
    };

    const prompt = formatProjectContextPrompt(project);
    expect(prompt).toContain('[PROJECT WORKSPACE: Tax Audit 2026]');
    expect(prompt).toContain('Format all monetary values with 2 decimals. Flag items over $500.');
    expect(prompt).toContain('[/PROJECT WORKSPACE]');
  });

  it('returns empty string when project has empty instructions', () => {
    const project: Project = {
      id: 'p2',
      name: 'Empty Workspace',
      description: '',
      instructions: '   ',
      archived: false,
      createdAt: '2026-11-07T00:00:00Z',
      updatedAt: '2026-11-07T00:00:00Z',
    };

    expect(formatProjectContextPrompt(project)).toBe('');
    expect(formatProjectContextPrompt(null)).toBe('');
  });

  it('lists active projects under RLS scoping', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'p100',
              name: 'Apollo Refactor',
              description: 'Frontend codebase',
              instructions: 'Use functional React.',
              archived: false,
              created_at: '2026-11-07T00:00:00Z',
              updated_at: '2026-11-07T00:00:00Z',
            },
          ],
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    } as unknown as SupabaseClient;

    const list = await listProjects(mockSupabase);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('p100');
    expect(list[0]?.name).toBe('Apollo Refactor');
  });

  it('creates project with user scoping and bounded instructions', async () => {
    const mockGetUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'u123' } },
      error: null,
    });

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'p200',
            name: 'New Project',
            description: 'A test project',
            instructions: 'Strict output format',
            archived: false,
            created_at: '2026-11-07T00:00:00Z',
            updated_at: '2026-11-07T00:00:00Z',
          },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as unknown as SupabaseClient;

    const created = await createProject(mockSupabase, {
      name: 'New Project',
      description: 'A test project',
      instructions: 'Strict output format',
    });

    expect(created.id).toBe('p200');
    expect(created.name).toBe('New Project');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u123',
        name: 'New Project',
        instructions: 'Strict output format',
      })
    );
  });
});
