// src/services/promptTemplateService.ts
// F19: Reusable prompt library with safe variable substitution.
// Supports personal and project-scoped templates, variable extraction, and composer insertion.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PromptTemplate {
  id: string;
  userId: string;
  projectId?: string | null;
  title: string;
  description: string;
  template: string;
  variables: string[];
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateInput {
  title: string;
  description?: string;
  template: string;
  projectId?: string | null;
  category?: string;
}

const VARIABLE_REGEX = /\{\{([a-zA-Z0-9_-]+)\}\}/g;

/**
 * Extracts distinct variable names from a template string (e.g. {{language}}, {{topic}}).
 */
export function extractTemplateVariables(template: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_REGEX.exec(template)) !== null) {
    if (match[1]) {
      vars.add(match[1].trim());
    }
  }
  return Array.from(vars);
}

/**
 * Substitutes variables in a template with user-provided values.
 * Leaves unmatched variables intact.
 */
export function substituteVariables(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE_REGEX, (_fullMatch, varName: string) => {
    const key = varName.trim();
    return values[key] !== undefined ? values[key] : '';
  });
}

/**
 * Fetches prompt templates for the current user, optionally filtered by project.
 */
export async function listPromptTemplates(
  client: SupabaseClient,
  options: { projectId?: string | null; search?: string } = {},
): Promise<PromptTemplate[]> {
  try {
    let query = client
      .from('prompt_templates')
      .select('id, user_id, project_id, title, description, template, variables, category, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (options.projectId !== undefined) {
      if (options.projectId === null) {
        query = query.is('project_id', null);
      } else {
        query = query.eq('project_id', options.projectId);
      }
    }

    if (options.search?.trim()) {
      query = query.ilike('title', `%${options.search.trim()}%`);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      console.warn('[promptTemplateService] List templates failed:', error?.message);
      return [];
    }

    return data.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      projectId: row.project_id ? String(row.project_id) : null,
      title: String(row.title),
      description: String(row.description || ''),
      template: String(row.template),
      variables: Array.isArray(row.variables) ? (row.variables as string[]) : [],
      category: String(row.category || 'general'),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  } catch (err) {
    console.warn('[promptTemplateService] List templates exception:', err);
    return [];
  }
}

/**
 * Creates a new prompt template.
 */
export async function createPromptTemplate(
  client: SupabaseClient,
  input: PromptTemplateInput,
): Promise<{ success: boolean; template?: PromptTemplate; error?: string }> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const title = input.title.trim();
    const template = input.template.trim();
    if (!title || !template) {
      return { success: false, error: 'Title and template text are required' };
    }

    const variables = extractTemplateVariables(template);

    const { data, error } = await client
      .from('prompt_templates')
      .insert({
        user_id: user.id,
        project_id: input.projectId || null,
        title,
        description: input.description?.trim() || '',
        template,
        variables,
        category: input.category?.trim() || 'general',
      })
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || 'Insert failed' };
    }

    return {
      success: true,
      template: {
        id: String(data.id),
        userId: String(data.user_id),
        projectId: data.project_id ? String(data.project_id) : null,
        title: String(data.title),
        description: String(data.description || ''),
        template: String(data.template),
        variables: Array.isArray(data.variables) ? (data.variables as string[]) : [],
        category: String(data.category || 'general'),
        createdAt: String(data.created_at),
        updatedAt: String(data.updated_at),
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Updates an existing prompt template.
 */
export async function updatePromptTemplate(
  client: SupabaseClient,
  id: string,
  input: Partial<PromptTemplateInput>,
): Promise<{ success: boolean; template?: PromptTemplate; error?: string }> {
  try {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.description !== undefined) updates.description = input.description.trim();
    if (input.template !== undefined) {
      updates.template = input.template.trim();
      updates.variables = extractTemplateVariables(input.template.trim());
    }
    if (input.category !== undefined) updates.category = input.category.trim();
    if (input.projectId !== undefined) updates.project_id = input.projectId || null;

    const { data, error } = await client
      .from('prompt_templates')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || 'Update failed' };
    }

    return {
      success: true,
      template: {
        id: String(data.id),
        userId: String(data.user_id),
        projectId: data.project_id ? String(data.project_id) : null,
        title: String(data.title),
        description: String(data.description || ''),
        template: String(data.template),
        variables: Array.isArray(data.variables) ? (data.variables as string[]) : [],
        category: String(data.category || 'general'),
        createdAt: String(data.created_at),
        updatedAt: String(data.updated_at),
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Deletes a prompt template.
 */
export async function deletePromptTemplate(
  client: SupabaseClient,
  templateId: string,
): Promise<{ success: boolean }> {
  try {
    const { error } = await client.from('prompt_templates').delete().eq('id', templateId);
    return { success: !error };
  } catch {
    return { success: false };
  }
}

/**
 * Duplicates a prompt template.
 */
export async function duplicatePromptTemplate(
  client: SupabaseClient,
  templateId: string,
): Promise<{ success: boolean; template?: PromptTemplate }> {
  try {
    const { data: source, error } = await client.from('prompt_templates').select('*').eq('id', templateId).single();
    if (error || !source) return { success: false };

    return createPromptTemplate(client, {
      title: `${source.title} (Copy)`,
      description: source.description,
      template: source.template,
      projectId: source.project_id,
      category: source.category,
    });
  } catch {
    return { success: false };
  }
}
