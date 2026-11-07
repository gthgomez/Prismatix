import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '../services/conversationService';
import type { Project } from '../services/projectService';
import {
  clampChatListWidth, describeChatActivity, MAX_CHAT_LIST_WIDTH, MIN_CHAT_LIST_WIDTH,
  readChatListPreferences, saveChatListPreferences, type ChatListPreferences,
} from '../services/conversationHistory';
import '../styles/ConversationSidebar.css';

// `display` is not inherited. A parent with `display: none` (mobile hides
// `.conversation-width-option`) still leaves the child input's own computed
// display as a normal value, so the focus trap must walk ancestors. `visibility`
// is inherited, so the element's own computed value already reflects a hidden ancestor.
function isRenderedForFocus(element: HTMLElement): boolean {
  const visibility = window.getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || window.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  isLoading: boolean;
  disabled?: boolean;
  isOpen?: boolean;
  preferenceScope?: string | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
  onOpenSearch?: () => void;
  onClose?: () => void;
  onRename?: (conversationId: string, title: string) => void;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onOpenNewProject?: () => void;
  onOpenExport?: () => void;
  onOpenImport?: () => void;
  onOpenPromptLibrary?: () => void;
  onArchiveConversation?: (conversationId: string, archived: boolean) => void;
  onSetConversationTags?: (conversationId: string, tags: string[]) => void;
  onBulkArchive?: (conversationIds: string[], archived: boolean) => void;
}

// Account changes reset transient UI and load only that account's display preferences.
export const ConversationSidebar: React.FC<ConversationSidebarProps> = (props) => (
  <ChatHistory key={props.preferenceScope ?? 'anonymous'} {...props} />
);

function ChatHistory({
  conversations,
  selectedId,
  isLoading,
  disabled = false,
  isOpen = false,
  preferenceScope,
  hasMore = false,
  isLoadingMore = false,
  loadMoreError = null,
  onLoadMore,
  onOpenSearch,
  onClose,
  onRename,
  onSelect,
  onNewChat,
  onDelete,
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onOpenNewProject,
  onOpenExport,
  onOpenImport,
  onOpenPromptLibrary,
  onArchiveConversation,
  onSetConversationTags,
  onBulkArchive: _onBulkArchive,
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editSession = useRef<{ id: string; original: string } | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState(() => readChatListPreferences(preferenceScope));
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [resizeStart, setResizeStart] = useState<{ x: number; width: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!isOpen || window.innerWidth > 768) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);

  const trimmedQuery = query.trim().toLowerCase();

  // Extract all distinct tags across conversations
  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    for (const c of conversations) {
      if (Array.isArray(c.tags)) {
        for (const t of c.tags) {
          if (t.trim()) tagsSet.add(t.trim());
        }
      }
    }
    return Array.from(tagsSet);
  }, [conversations]);

  const visible = useMemo(() => {
    return conversations.filter((c) => {
      // 1. Text search filter
      if (trimmedQuery && !(c.title ?? 'Untitled conversation').toLowerCase().includes(trimmedQuery)) {
        return false;
      }
      // 2. Archived status filter
      if (statusFilter === 'active' && c.archived === true) {
        return false;
      }
      if (statusFilter === 'archived' && c.archived !== true) {
        return false;
      }
      // 3. Tag filter
      if (selectedTag && (!Array.isArray(c.tags) || !c.tags.includes(selectedTag))) {
        return false;
      }
      return true;
    });
  }, [conversations, trimmedQuery, statusFilter, selectedTag]);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const key = `prismatix:pinned-chats:${preferenceScope ?? 'anonymous'}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      try {
        const key = `prismatix:pinned-chats:${preferenceScope ?? 'anonymous'}`;
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleDelete = (id: string) => {
    setPinnedIds((prev) => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter((p) => p !== id);
      try {
        const key = `prismatix:pinned-chats:${preferenceScope ?? 'anonymous'}`;
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    onDelete(id);
  };

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const pinnedRows = useMemo(
    () => {
      const now = new Date();
      return visible
        .filter((c) => pinnedSet.has(c.id))
        .map((conversation) => ({
          conversation,
          activity: describeChatActivity(conversation.lastActivityAt, now),
          isPinned: true,
        }));
    },
    [visible, pinnedSet],
  );
  const unpinnedRows = useMemo(
    () => {
      const now = new Date();
      return visible
        .filter((c) => !pinnedSet.has(c.id))
        .map((conversation) => ({
          conversation,
          activity: describeChatActivity(conversation.lastActivityAt, now),
          isPinned: false,
        }));
    },
    [visible, pinnedSet],
  );

  const allRenderedRows = useMemo(
    () => [...pinnedRows, ...unpinnedRows],
    [pinnedRows, unpinnedRows],
  );

  const updatePreferences = (next: ChatListPreferences) => {
    setPreferences(next);
    saveChatListPreferences(preferenceScope, next);
  };
  const dismissMenu = (restoreFocus = false) => {
    if (restoreFocus && menuId) actionButtons.current.get(menuId)?.focus();
    setMenuId(null);
    setConfirmDeleteId(null);
  };

  useEffect(() => {
    setConfirmDeleteId(null);
  }, [menuId]);

  useEffect(() => {
    if (!menuId) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!menuRef.current?.contains(event.target) && !actionButtons.current.get(menuId)?.contains(event.target)) setMenuId(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuId]);

  useEffect(() => {
    if (disabled || !visible.some(c => c.id === menuId)) setMenuId(null);
  }, [disabled, menuId, visible]);

  useEffect(() => {
    if (!resizeStart) return;
    let width = resizeStart.width;
    const move = (event: PointerEvent) => {
      width = clampChatListWidth(resizeStart.width + event.clientX - resizeStart.x);
      setPreferences(previous => ({ ...previous, width }));
    };
    const end = () => {
      saveChatListPreferences(preferenceScope, { ...preferencesRef.current, width });
      setResizeStart(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
    // Preserve the pointer-down origin while width changes during the drag.
  }, [resizeStart, preferenceScope]);

  const finishRename = (save: boolean) => {
    const session = editSession.current;
    if (!session) return;
    editSession.current = null;
    setEditingId(null);
    const title = editDraft.trim();
    if (save && !disabled && title && title !== session.original) onRename?.(session.id, title);
    queueMicrotask(() => titleButtons.current.get(session.id)?.focus());
  };

  const navigateTitles = (event: React.KeyboardEvent, id: string) => {
    const ids = allRenderedRows.map(r => r.conversation.id);
    const index = ids.indexOf(id);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
      : event.key === 'ArrowDown' ? Math.min(index + 1, ids.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : -1;
    if (target >= 0) { event.preventDefault(); titleButtons.current.get(ids[target]!)?.focus(); }
  };

  const renderConversationRow = ({
    conversation,
    activity,
    isPinned,
  }: {
    conversation: ConversationSummary;
    activity: { group: string; label: string; full: string };
    isPinned: boolean;
  }) => {
    const title = conversation.title?.trim() || 'Untitled conversation';
    return (
      <li
        key={conversation.id}
        className={`conversation-item ${selectedId === conversation.id ? 'selected' : ''} ${menuId === conversation.id ? 'has-menu' : ''} ${isPinned ? 'pinned' : ''}`}
      >
        {editingId === conversation.id ? (
          <input
            type='text'
            className='conversation-rename-input'
            aria-label='Rename chat'
            autoFocus
            maxLength={120}
            disabled={disabled}
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            onBlur={() => finishRename(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finishRename(event.key === 'Enter');
              }
            }}
          />
        ) : (
          <button
            type='button'
            className='conversation-item-button'
            disabled={disabled}
            ref={(node) => {
              if (node) titleButtons.current.set(conversation.id, node);
              else titleButtons.current.delete(conversation.id);
            }}
            aria-current={selectedId === conversation.id ? 'true' : undefined}
            title={title}
            onKeyDown={(event) => navigateTitles(event, conversation.id)}
            onClick={() => {
              setMenuId(null);
              onSelect(conversation.id);
              onClose?.();
            }}
          >
            <span className='conversation-item-title'>
              {isPinned && <span className='conversation-pin-badge' aria-label='Pinned'>📌 </span>}
              {conversation.archived && <span className='conversation-pin-badge' aria-label='Archived'>📦 </span>}
              {title}
              {Array.isArray(conversation.tags) && conversation.tags.length > 0 && (
                <span style={{ display: 'inline-flex', gap: '0.2rem', marginLeft: '0.35rem' }}>
                  {conversation.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: '0.65rem',
                        background: 'rgba(255,255,255,0.08)',
                        padding: '0.05rem 0.3rem',
                        borderRadius: '3px',
                        color: '#4ecdc4',
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className='conversation-item-activity' title={activity.full}>
              {activity.label}
            </span>
          </button>
        )}
        {editingId !== conversation.id && (
          <button
            type='button'
            className='conversation-actions-trigger'
            disabled={disabled}
            ref={(node) => {
              if (node) actionButtons.current.set(conversation.id, node);
              else actionButtons.current.delete(conversation.id);
            }}
            aria-label={`Actions for ${title}`}
            aria-haspopup='menu'
            aria-expanded={menuId === conversation.id}
            onClick={() => setMenuId((previous) => (previous === conversation.id ? null : conversation.id))}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMenuId(conversation.id);
              }
            }}
          >
            <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <circle cx='5' cy='12' r='1.5' />
              <circle cx='12' cy='12' r='1.5' />
              <circle cx='19' cy='12' r='1.5' />
            </svg>
          </button>
        )}
        {menuId === conversation.id && (
          <div
            className='conversation-actions-menu'
            role='menu'
            aria-label={`Actions for ${title}`}
            ref={menuRef}
            onBlur={(event) => {
              const next = event.relatedTarget;
              const trigger = actionButtons.current.get(conversation.id);
              if (!(next instanceof Node) || (!event.currentTarget.contains(next) && !trigger?.contains(next))) setMenuId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                dismissMenu(true);
              }
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                  ? buttons.length - 1
                  : event.key === 'ArrowDown'
                  ? (current + 1) % buttons.length
                  : event.key === 'ArrowUp'
                  ? (current + buttons.length - 1) % buttons.length
                  : -1;
              if (next >= 0) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            <button
              type='button'
              role='menuitem'
              className='conversation-item-pin'
              disabled={disabled}
              onClick={() => {
                togglePin(conversation.id);
                setMenuId(null);
              }}
            >
              {isPinned ? 'Unpin chat' : 'Pin chat'}
            </button>
            {onRename && (
              <button
                type='button'
                role='menuitem'
                className='conversation-item-rename'
                disabled={disabled}
                onClick={() => {
                  editSession.current = { id: conversation.id, original: title };
                  setEditingId(conversation.id);
                  setEditDraft(title);
                  setMenuId(null);
                  setConfirmDeleteId(null);
                }}
              >
                Rename
              </button>
            )}
            {onArchiveConversation && (
              <button
                type='button'
                role='menuitem'
                className='conversation-item-archive'
                disabled={disabled}
                onClick={() => {
                  onArchiveConversation(conversation.id, !conversation.archived);
                  setMenuId(null);
                }}
              >
                {conversation.archived ? 'Unarchive chat' : 'Archive chat'}
              </button>
            )}
            {onSetConversationTags && (
              <button
                type='button'
                role='menuitem'
                className='conversation-item-tag'
                disabled={disabled}
                onClick={() => {
                  const tagInput = window.prompt(
                    'Enter tags (comma separated):',
                    (conversation.tags || []).join(', '),
                  );
                  if (tagInput !== null) {
                    const parsed = tagInput
                      .split(',')
                      .map((t) => t.trim().replace(/^#/, ''))
                      .filter(Boolean);
                    onSetConversationTags(conversation.id, parsed);
                  }
                  setMenuId(null);
                }}
              >
                Tags...
              </button>
            )}
            <button
              type='button'
              role='menuitem'
              className={`conversation-item-delete ${confirmDeleteId === conversation.id ? 'confirm' : ''}`}
              disabled={disabled}
              onClick={() => {
                if (confirmDeleteId === conversation.id) {
                  dismissMenu(true);
                  handleDelete(conversation.id);
                } else {
                  setConfirmDeleteId(conversation.id);
                }
              }}
            >
              {confirmDeleteId === conversation.id ? 'Confirm delete?' : 'Delete chat'}
            </button>
          </div>
        )}
      </li>
    );
  };

  return <>
    {isOpen && <div className='conversation-sidebar-backdrop' onClick={onClose} aria-hidden='true' />}
    <aside ref={drawerRef} className={`conversation-sidebar ${isOpen ? 'open' : ''} ${resizeStart ? 'is-resizing' : ''}`}
      data-density={preferences.density} aria-label='Conversations'
      style={{ '--chat-list-width': `${preferences.width}px` } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen && !event.defaultPrevented) {
          event.stopPropagation();
          onClose?.();
        }
        if (event.key !== 'Tab' || !isOpen || window.innerWidth > 768 || !drawerRef.current) return;
        const nodes = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )).filter(isRenderedForFocus);
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}>
      <div className='conversation-sidebar-controls'>
        <div className='conversation-sidebar-heading'>
          <h2>Chats</h2>
          <button type='button' className='conversation-display-toggle' aria-label='Chat display options'
            aria-expanded={showPreferences} onClick={() => setShowPreferences(previous => !previous)}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><path d='M4 7h16M4 17h16M9 4v6m6 4v6' /></svg>
          </button>
          {onClose && <button type='button' className='conversation-sidebar-close' onClick={onClose} aria-label='Close sidebar'>✕</button>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 'var(--spacing-xs)' }}>
          <button
            type='button'
            className='conversation-new-button'
            style={{ flex: 1 }}
            disabled={disabled}
            onClick={() => { setMenuId(null); onNewChat(); onClose?.(); }}
          >
            + New Chat
          </button>
          {onOpenExport && (
            <button
              type='button'
              className='btn-secondary'
              style={{ padding: '0 0.5rem', fontSize: '0.75rem', minHeight: '38px', borderRadius: 'var(--radius-sm)' }}
              title='Export conversation(s)'
              onClick={onOpenExport}
            >
              Export
            </button>
          )}
          {onOpenImport && (
            <button
              type='button'
              className='btn-secondary'
              style={{ padding: '0 0.5rem', fontSize: '0.75rem', minHeight: '38px', borderRadius: 'var(--radius-sm)' }}
              title='Import conversation(s)'
              onClick={onOpenImport}
            >
              Import
            </button>
          )}
          {onOpenPromptLibrary && (
            <button
              type='button'
              className='btn-secondary'
              style={{ padding: '0 0.5rem', fontSize: '0.75rem', minHeight: '38px', borderRadius: 'var(--radius-sm)' }}
              title='Prompt templates'
              onClick={onOpenPromptLibrary}
            >
              Prompts
            </button>
          )}
        </div>

        <div className='project-filter-row' style={{ padding: '0.35rem 0', borderBottom: 'none' }}>
          <select
            className='project-select'
            value={activeProjectId || ''}
            onChange={(e) => onSelectProject?.(e.target.value ? e.target.value : null)}
            aria-label='Filter by project workspace'
          >
            <option value=''>All workspaces</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {onOpenNewProject && (
            <button
              type='button'
              className='project-add-btn'
              title='Create project workspace'
              onClick={onOpenNewProject}
              aria-label='Create project workspace'
            >
              +
            </button>
          )}
        </div>
        <div className='conversation-search-wrap'>
          <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><circle cx='10' cy='10' r='6' /><path d='m15 15 6 6' /></svg>
          <input type='search' className='conversation-search' placeholder='Filter loaded chats…' aria-label='Filter loaded chats' value={query}
            onChange={event => { setQuery(event.target.value); setMenuId(null); }} onKeyDown={event => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              }
            }} />
          {onOpenSearch && (
            <button
              type='button'
              className='conversation-search-global-trigger'
              onClick={onOpenSearch}
              title='Full history search (Ctrl+K)'
              aria-label='Search all past conversations and messages'
            >
              Full Search
            </button>
          )}
        </div>

        {/* F18: Status Filters (Active / Archived / All) & Tag Filters */}
        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.35rem', marginBottom: '0.35rem' }}>
          <button
            type='button'
            style={{
              flex: 1,
              padding: '0.25rem 0.4rem',
              fontSize: '0.72rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              background: statusFilter === 'active' ? 'var(--color-primary, #4ecdc4)' : 'rgba(255,255,255,0.05)',
              color: statusFilter === 'active' ? '#0f172a' : 'inherit',
              fontWeight: statusFilter === 'active' ? 600 : 400,
            }}
            onClick={() => setStatusFilter('active')}
          >
            Active
          </button>
          <button
            type='button'
            style={{
              flex: 1,
              padding: '0.25rem 0.4rem',
              fontSize: '0.72rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              background: statusFilter === 'archived' ? 'var(--color-primary, #4ecdc4)' : 'rgba(255,255,255,0.05)',
              color: statusFilter === 'archived' ? '#0f172a' : 'inherit',
              fontWeight: statusFilter === 'archived' ? 600 : 400,
            }}
            onClick={() => setStatusFilter('archived')}
          >
            Archived
          </button>
          <button
            type='button'
            style={{
              flex: 1,
              padding: '0.25rem 0.4rem',
              fontSize: '0.72rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              background: statusFilter === 'all' ? 'var(--color-primary, #4ecdc4)' : 'rgba(255,255,255,0.05)',
              color: statusFilter === 'all' ? '#0f172a' : 'inherit',
              fontWeight: statusFilter === 'all' ? 600 : 400,
            }}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
        </div>

        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', padding: '0.2rem 0', marginBottom: '0.35rem' }}>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.4rem',
                borderRadius: '3px',
                cursor: 'pointer',
                background: selectedTag === null ? 'rgba(78, 205, 196, 0.2)' : 'transparent',
                color: selectedTag === null ? '#4ecdc4' : 'var(--color-text-dim, #9ca3af)',
              }}
              onClick={() => setSelectedTag(null)}
            >
              All tags
            </span>
            {allTags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  background: selectedTag === t ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255,255,255,0.05)',
                  color: selectedTag === t ? '#4ecdc4' : 'var(--color-text-dim, #9ca3af)',
                }}
                onClick={() => setSelectedTag(selectedTag === t ? null : t)}
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        {showPreferences && <div className='conversation-display-options'>
          <label>Row density<select aria-label='Chat row density' value={preferences.density}
            onChange={event => updatePreferences({ ...preferences, density: event.target.value === 'comfortable' ? 'comfortable' : 'compact' })}>
            <option value='compact'>Compact</option><option value='comfortable'>Comfortable</option>
          </select></label>
          <label className='conversation-width-option'>Sidebar width <span>{preferences.width}px</span>
            <input type='range' aria-label='Sidebar width' min={MIN_CHAT_LIST_WIDTH} max={MAX_CHAT_LIST_WIDTH} step={1} value={preferences.width}
              onChange={event => updatePreferences({ ...preferences, width: clampChatListWidth(Number(event.target.value)) })} />
          </label>
        </div>}
      </div>
      <div className='conversation-history-scroll'>
        {isLoading && <div className='conversation-sidebar-status' role='status'>Loading…</div>}
        {!isLoading && conversations.length === 0 && <div className='conversation-sidebar-status'>No conversations yet</div>}
        {!isLoading && conversations.length > 0 && visible.length === 0 && <div className='conversation-sidebar-status' role='status'>No matching chats</div>}
        {trimmedQuery && (
          <div className='conversation-search-note'>
            <span>Showing {visible.length} of {conversations.length} loaded chats.</span>
            {onOpenSearch && (
              <button
                type='button'
                className='conversation-search-note-action'
                onClick={onOpenSearch}
              >
                Search all messages →
              </button>
            )}
          </div>
        )}
        <ul className='conversation-list'>
          {pinnedRows.length > 0 && (
            <>
              <li className='conversation-group-heading conversation-pinned-heading'>📌 Pinned</li>
              {pinnedRows.map(renderConversationRow)}
            </>
          )}
          {unpinnedRows.map((row, index) => (
            <React.Fragment key={row.conversation.id}>
              {(index === 0 || unpinnedRows[index - 1]!.activity.group !== row.activity.group) && (
                <li className='conversation-group-heading'>{row.activity.group}</li>
              )}
              {renderConversationRow(row)}
            </React.Fragment>
          ))}
        </ul>
        {hasMore && (
          <div className='conversation-pagination-row'>
            <button
              type='button'
              className='conversation-load-more-btn'
              disabled={isLoadingMore || disabled}
              onClick={onLoadMore}
            >
              {isLoadingMore ? 'Loading older chats…' : 'Load more chats'}
            </button>
          </div>
        )}
        {loadMoreError && (
          <div className='conversation-load-more-error' role='alert'>
            <span>{loadMoreError}</span>
            {onLoadMore && (
              <button
                type='button'
                className='conversation-load-more-retry'
                onClick={onLoadMore}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <div className='conversation-resize-handle' role='separator' aria-label='Resize chats sidebar' aria-orientation='vertical'
        aria-valuemin={MIN_CHAT_LIST_WIDTH} aria-valuemax={MAX_CHAT_LIST_WIDTH} aria-valuenow={preferences.width} tabIndex={0}
        onPointerDown={event => { if (event.button === 0) { event.preventDefault(); setResizeStart({ x: event.clientX, width: preferences.width }); } }}
        onKeyDown={event => {
          const width = event.key === 'Home' ? MIN_CHAT_LIST_WIDTH : event.key === 'End' ? MAX_CHAT_LIST_WIDTH
            : event.key === 'ArrowLeft' ? preferences.width - 10 : event.key === 'ArrowRight' ? preferences.width + 10 : null;
          if (width !== null) { event.preventDefault(); updatePreferences({ ...preferences, width: clampChatListWidth(width) }); }
        }} />
    </aside>
  </>;
}
