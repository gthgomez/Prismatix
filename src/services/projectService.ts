// src/services/projectService.ts
// F09: Real Project Workspaces with Scoped Instructions and RLS isolation.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  instructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  instructions?: string;
  archived?: boolean;
}

const MAX_PROJECT_INSTRUCTIONS_LENGTH = 12000;

export async function listProjects(
  client: SupabaseClient,
  includeArchived = false,
): Promise<Project[]> {
  try {
    let query = client
      .from('projects')
      .select('id, name, description, instructions, archived, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (!includeArchived) {
      query = query.eq('archived', false);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[projectService] Failed to list projects:', error.message);
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data.map((row) => ({
      id: String(row.id),
      name: String(row.name || 'Untitled Project'),
      description: String(row.description || ''),
      instructions: String(row.instructions || ''),
      archived: Boolean(row.archived),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    }));
  } catch (err) {
    console.error('[projectService] listProjects exception:', err);
    return [];
  }
}

export async function createProject(
  client: SupabaseClient,
  input: CreateProjectInput,
): Promise<Project> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name cannot be empty.');
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Authenticated user required to create a project.');
  }

  const boundedInstructions = (input.instructions || '').trim().slice(0, MAX_PROJECT_INSTRUCTIONS_LENGTH);

  const { data, error } = await client
    .from('projects')
    .insert({
      user_id: user.id,
      name: trimmedName,
      description: (input.description || '').trim(),
      instructions: boundedInstructions,
      archived: false,
    })
    .select('id, name, description, instructions, archived, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create project: ${error?.message || 'Unknown error'}`);
  }

  return {
    id: String(data.id),
    name: String(data.name),
    description: String(data.description || ''),
    instructions: String(data.instructions || ''),
    archived: Boolean(data.archived),
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
}

export async function updateProject(
  client: SupabaseClient,
  id: string,
  updates: UpdateProjectInput,
): Promise<Project> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) throw new Error('Project name cannot be empty.');
    payload.name = trimmed;
  }

  if (updates.description !== undefined) {
    payload.description = updates.description.trim();
  }

  if (updates.instructions !== undefined) {
    payload.instructions = updates.instructions.trim().slice(0, MAX_PROJECT_INSTRUCTIONS_LENGTH);
  }

  if (updates.archived !== undefined) {
    payload.archived = updates.archived;
  }

  const { data, error } = await client
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select('id, name, description, instructions, archived, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to update project: ${error?.message || 'Unknown error'}`);
  }

  return {
    id: String(data.id),
    name: String(data.name),
    description: String(data.description || ''),
    instructions: String(data.instructions || ''),
    archived: Boolean(data.archived),
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
}

export async function archiveProject(client: SupabaseClient, id: string): Promise<void> {
  await updateProject(client, id, { archived: true });
}

/**
 * Defensive prompt wrapper for project instructions.
 * Protects against prompt injection by bounding and clearly delimiting instructions.
 */
export function formatProjectContextPrompt(project: Project | null | undefined): string {
  if (!project || !project.instructions.trim()) return '';

  const cleanName = project.name.replace(/[[\]]/g, '').trim();
  const cleanInstructions = project.instructions.trim().slice(0, MAX_PROJECT_INSTRUCTIONS_LENGTH);

  return (
    `\n\n[PROJECT WORKSPACE: ${cleanName}]\n` +
    `The user is working inside this workspace project. Adhere strictly to these project-specific guidelines:\n` +
    `${cleanInstructions}\n` +
    `[/PROJECT WORKSPACE]\n`
  );
}
