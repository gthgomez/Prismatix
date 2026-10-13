import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '../services/conversationService';
import {
  clampChatListWidth, describeChatActivity, MAX_CHAT_LIST_WIDTH, MIN_CHAT_LIST_WIDTH,
  readChatListPreferences, saveChatListPreferences, type ChatListPreferences,
} from '../services/conversationHistory';
import '../styles/ConversationSidebar.css';

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  isLoading: boolean;
  disabled?: boolean;
  isOpen?: boolean;
  preferenceScope?: string | null;
  onClose?: () => void;
  onRename?: (conversationId: string, title: string) => void;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
}

// Account changes reset transient UI and load only that account's display preferences.
export const ConversationSidebar: React.FC<ConversationSidebarProps> = (props) => (
  <ChatHistory key={props.preferenceScope ?? 'anonymous'} {...props} />
);

function ChatHistory({ conversations, selectedId, isLoading, disabled = false, isOpen = false,
  preferenceScope, onClose, onRename, onSelect, onNewChat, onDelete }: ConversationSidebarProps) {
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editSession = useRef<{ id: string; original: string } | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState(() => readChatListPreferences(preferenceScope));
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [resizeStart, setResizeStart] = useState<{ x: number; width: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const trimmedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => conversations.filter(c => !trimmedQuery || (c.title ?? 'Untitled conversation').toLowerCase().includes(trimmedQuery)), [conversations, trimmedQuery]);
  const now = new Date();
  const rows = visible.map(conversation => ({ conversation, activity: describeChatActivity(conversation.lastActivityAt, now) }));

  const updatePreferences = (next: ChatListPreferences) => {
    setPreferences(next);
    saveChatListPreferences(preferenceScope, next);
  };
  const dismissMenu = (restoreFocus = false) => {
    if (restoreFocus && menuId) actionButtons.current.get(menuId)?.focus();
    setMenuId(null);
  };

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
    const ids = visible.map(c => c.id);
    const index = ids.indexOf(id);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
      : event.key === 'ArrowDown' ? Math.min(index + 1, ids.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : -1;
    if (target >= 0) { event.preventDefault(); titleButtons.current.get(ids[target]!)?.focus(); }
  };

  return <>
    {isOpen && <div className='conversation-sidebar-backdrop' onClick={onClose} aria-hidden='true' />}
    <aside className={`conversation-sidebar ${isOpen ? 'open' : ''} ${resizeStart ? 'is-resizing' : ''}`}
      data-density={preferences.density} aria-label='Conversations'
      style={{ '--chat-list-width': `${preferences.width}px` } as React.CSSProperties}>
      <div className='conversation-sidebar-controls'>
        <div className='conversation-sidebar-heading'>
          <h2>Chats</h2>
          <button type='button' className='conversation-display-toggle' aria-label='Chat display options'
            aria-expanded={showPreferences} onClick={() => setShowPreferences(previous => !previous)}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><path d='M4 7h16M4 17h16M9 4v6m6 4v6' /></svg>
          </button>
          {onClose && <button type='button' className='conversation-sidebar-close' onClick={onClose} aria-label='Close sidebar'>✕</button>}
        </div>
        <button type='button' className='conversation-new-button' disabled={disabled} onClick={() => { setMenuId(null); onNewChat(); onClose?.(); }}>+ New Chat</button>
        <div className='conversation-search-wrap'>
          <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><circle cx='10' cy='10' r='6' /><path d='m15 15 6 6' /></svg>
          <input type='search' className='conversation-search' placeholder='Search chats…' aria-label='Search chats' value={query}
            onChange={event => { setQuery(event.target.value); setMenuId(null); }} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
        </div>
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
        {trimmedQuery && <div className='conversation-search-note'>Matching titles in loaded history</div>}
        <ul className='conversation-list'>
          {rows.map(({ conversation, activity }, index) => {
            const title = conversation.title?.trim() || 'Untitled conversation';
            return <React.Fragment key={conversation.id}>
              {(index === 0 || rows[index - 1]!.activity.group !== activity.group) && <li className='conversation-group-heading'>{activity.group}</li>}
              <li className={`conversation-item ${selectedId === conversation.id ? 'selected' : ''} ${menuId === conversation.id ? 'has-menu' : ''}`}>
                {editingId === conversation.id ? <input type='text' className='conversation-rename-input' aria-label='Rename chat' autoFocus
                  maxLength={120} disabled={disabled} value={editDraft} onChange={event => setEditDraft(event.target.value)}
                  onBlur={() => finishRename(true)} onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finishRename(event.key === 'Enter'); }
                  }} /> : <button type='button' className='conversation-item-button' disabled={disabled}
                    ref={node => { if (node) titleButtons.current.set(conversation.id, node); else titleButtons.current.delete(conversation.id); }}
                    aria-current={selectedId === conversation.id ? 'true' : undefined} title={title}
                    onKeyDown={event => navigateTitles(event, conversation.id)}
                    onClick={() => { setMenuId(null); onSelect(conversation.id); onClose?.(); }}>
                    <span className='conversation-item-title'>{title}</span>
                    <span className='conversation-item-activity' title={activity.full}>{activity.label}</span>
                  </button>}
                {editingId !== conversation.id && <button type='button' className='conversation-actions-trigger' disabled={disabled}
                  ref={node => { if (node) actionButtons.current.set(conversation.id, node); else actionButtons.current.delete(conversation.id); }}
                  aria-label={`Actions for ${title}`} aria-haspopup='menu' aria-expanded={menuId === conversation.id}
                  onClick={() => setMenuId(previous => previous === conversation.id ? null : conversation.id)}
                  onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuId(conversation.id); } }}>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><circle cx='5' cy='12' r='1.5' /><circle cx='12' cy='12' r='1.5' /><circle cx='19' cy='12' r='1.5' /></svg>
                </button>}
                {menuId === conversation.id && <div className='conversation-actions-menu' role='menu' aria-label={`Actions for ${title}`} ref={menuRef}
                  onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuId(null); }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); dismissMenu(true); }
                    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current + buttons.length - 1) % buttons.length : -1;
                    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
                  }}>
                  {onRename && <button type='button' role='menuitem' className='conversation-item-rename' disabled={disabled}
                    onClick={() => { editSession.current = { id: conversation.id, original: title }; setEditingId(conversation.id); setEditDraft(title); setMenuId(null); }}>Rename</button>}
                  <button type='button' role='menuitem' className='conversation-item-delete' disabled={disabled}
                    onClick={() => { dismissMenu(true); onDelete(conversation.id); }}>Delete chat</button>
                </div>}
              </li>
            </React.Fragment>;
          })}
        </ul>
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
