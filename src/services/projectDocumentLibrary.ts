// src/services/projectDocumentLibrary.ts
// F21: Persistent project file library.
// Provides durable workspace document storage, text extraction, and lifecycle management.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProjectDocument {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  filePath?: string | null;
  fileType: string;
  sizeBytes: number;
  extractedText?: string | null;
  metadata: {
    pageCount?: number;
    sheetCount?: number;
    chunkCount?: number;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunk {
  id?: string;
  documentId: string;
  projectId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'document.txt';
}

/**
 * Splits text into overlapping chunks for search indexing (~1500 chars per chunk).
 */
export function chunkDocumentText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = options.chunkSize || 1500;
  const overlap = options.overlap || 200;

  if (!text || text.trim().length === 0) return [];
  if (text.length <= chunkSize) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    // If not at the very end, try breaking cleanly on a newline or space
    if (end < text.length) {
      const lastBreak = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf('. '), chunk.lastIndexOf(' '));
      if (lastBreak > chunkSize * 0.6) {
        chunk = chunk.slice(0, lastBreak + 1);
      }
    }

    const trimmed = chunk.trim();
    if (trimmed) chunks.push(trimmed);

    start += Math.max(1, chunk.length - overlap);
  }

  return chunks;
}

/**
 * Lists all documents associated with a project.
 */
export async function listProjectDocuments(
  client: SupabaseClient,
  projectId: string,
): Promise<ProjectDocument[]> {
  try {
    const { data, error } = await client
      .from('project_documents')
      .select('id, project_id, user_id, name, file_path, file_type, size_bytes, metadata, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.warn('[projectDocumentLibrary] list error:', error?.message);
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      userId: String(row.user_id),
      name: String(row.name),
      filePath: row.file_path ? String(row.file_path) : null,
      fileType: String(row.file_type || 'text/plain'),
      sizeBytes: Number(row.size_bytes || 0),
      metadata: (row.metadata as ProjectDocument['metadata']) || {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  } catch (err) {
    console.warn('[projectDocumentLibrary] list exception:', err);
    return [];
  }
}

/**
 * Ingests a new document into a project, uploads original file bytes to Storage,
 * extracts chunks, and persists both.
 */
export async function addProjectDocument(
  client: SupabaseClient,
  options: {
    projectId: string;
    name: string;
    fileType?: string;
    sizeBytes?: number;
    extractedText: string;
    fileBytes?: Blob | Uint8Array | ArrayBuffer | string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ success: boolean; document?: ProjectDocument; error?: string }> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const docId = generateUuid();
    const cleanName = options.name.trim();
    const chunks = chunkDocumentText(options.extractedText);
    let filePath: string | null = null;

    // 1. Upload original file bytes to Supabase Storage if provided
    if (options.fileBytes) {
      const safeFilename = sanitizeFileName(cleanName);
      const storageKey = `${user.id}/${options.projectId}/${docId}/${safeFilename}`;

      try {
        const { error: uploadErr } = await client.storage
          .from('project-documents')
          .upload(storageKey, options.fileBytes, {
            contentType: options.fileType || 'application/octet-stream',
            upsert: true,
          });

        if (uploadErr) {
          return { success: false, error: `Storage upload failed: ${uploadErr.message}` };
        }
        filePath = storageKey;
      } catch (uploadEx) {
        return {
          success: false,
          error: `Storage upload exception: ${uploadEx instanceof Error ? uploadEx.message : String(uploadEx)}`,
        };
      }
    }

    const docMetadata = {
      ...(options.metadata || {}),
      chunkCount: chunks.length,
      charCount: options.extractedText.length,
      status: 'ready',
    };

    // 2. Insert document record
    const { error: docErr } = await client.from('project_documents').insert({
      id: docId,
      project_id: options.projectId,
      user_id: user.id,
      name: cleanName,
      file_path: filePath,
      file_type: options.fileType || 'text/plain',
      size_bytes: options.sizeBytes || options.extractedText.length,
      extracted_text: options.extractedText,
      metadata: docMetadata,
    });

    if (docErr) {
      // Compensate: purge uploaded storage file if database insert fails
      if (filePath && client?.storage) {
        try {
          await client.storage.from('project-documents').remove([filePath]);
        } catch {
          // Best-effort cleanup
        }
      }
      return { success: false, error: docErr.message };
    }

    // 3. Insert chunks for grounding search
    if (chunks.length > 0) {
      const chunkRows = chunks.map((content, idx) => ({
        id: generateUuid(),
        document_id: docId,
        project_id: options.projectId,
        user_id: user.id,
        chunk_index: idx,
        content,
        token_count: Math.ceil(content.length / 4),
        metadata: {
          docName: cleanName,
          chunkIndex: idx,
          totalChunks: chunks.length,
          ...(options.metadata?.pageNumber ? { pageNumber: options.metadata.pageNumber } : {}),
        },
      }));

      const { error: chunkErr } = await client.from('project_document_chunks').insert(chunkRows);
      if (chunkErr) {
        // Compensate: purge document record and storage file on indexing failure
        try {
          await client.from('project_documents').delete().eq('id', docId);
          if (filePath && client?.storage) {
            await client.storage.from('project-documents').remove([filePath]);
          }
        } catch {
          // Best-effort rollback
        }
        return { success: false, error: `Document chunk indexing failed: ${chunkErr.message}` };
      }
    }

    return {
      success: true,
      document: {
        id: docId,
        projectId: options.projectId,
        userId: user.id,
        name: cleanName,
        filePath,
        fileType: options.fileType || 'text/plain',
        sizeBytes: options.sizeBytes || options.extractedText.length,
        extractedText: options.extractedText,
        metadata: docMetadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to ingest document' };
  }
}

/**
 * Downloads the original project document file from storage.
 */
export async function downloadProjectDocumentFile(
  client: SupabaseClient,
  filePath: string,
): Promise<{ data: Blob | null; error?: string }> {
  try {
    const { data, error } = await client.storage.from('project-documents').download(filePath);
    if (error || !data) {
      return { data: null, error: error?.message || 'Download failed' };
    }
    return { data, error: undefined };
  } catch (err: any) {
    return { data: null, error: err.message || 'Download exception' };
  }
}

/**
 * Deletes a project document (cascades chunks automatically via foreign key)
 * and purges original storage object if present.
 */
export async function deleteProjectDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<boolean> {
  try {
    // 1. Fetch file_path before deleting if storage lookup is supported
    let filePath: string | null = null;
    try {
      if (typeof client?.from === 'function') {
        const query = client.from('project_documents');
        if (typeof query?.select === 'function') {
          const res = await query.select('file_path').eq('id', documentId);
          const data = res?.data as any;
          filePath = (Array.isArray(data) ? data[0]?.file_path : data?.file_path) || null;
        }
      }
    } catch {
      // Ignore if mock client does not support select
    }

    if (filePath && client?.storage) {
      try {
        const { error: removeErr } = await client.storage.from('project-documents').remove([filePath]);
        if (removeErr) {
          console.warn('[projectDocumentLibrary] Storage file remove failed:', removeErr);
          // If storage deletion fails, abort database deletion to prevent permanently orphaned files in storage
          return false;
        }
      } catch (storageErr) {
        console.warn('[projectDocumentLibrary] Storage file remove warning:', storageErr);
        return false;
      }
    }

    // 2. Delete database record
    const { error } = await client.from('project_documents').delete().eq('id', documentId);
    return !error;
  } catch {
    return false;
  }
}
