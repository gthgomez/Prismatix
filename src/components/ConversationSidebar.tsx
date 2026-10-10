// src/components/ConversationSidebar.tsx
// PX07 conversation list: switch, New Chat, Delete Chat.

import React from 'react';
import type { ConversationSummary } from '../services/conversationService';
import '../styles/ConversationSidebar.css';

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  isLoading: boolean;
  disabled?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
}

function formatActivity(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  selectedId,
  isLoading,
  disabled = false,
  isOpen = false,
  onClose,
  onSelect,
  onNewChat,
  onDelete,
}) => {
  const handleSelect = (id: string) => {
    onSelect(id);
    onClose?.();
  };

  const handleNewChat = () => {
    onNewChat();
    onClose?.();
  };

  return (
    <>
      {isOpen && (
        <div
          className='conversation-sidebar-backdrop'
          onClick={onClose}
          aria-hidden='true'
        />
      )}
      <aside
        className={`conversation-sidebar ${isOpen ? 'open' : ''}`}
        aria-label='Conversations'
      >
        <div className='conversation-sidebar-header'>
          <button
            type='button'
            className='conversation-new-button'
            onClick={handleNewChat}
            disabled={disabled}
          >
            + New Chat
          </button>
          {onClose && (
            <button
              type='button'
              className='conversation-sidebar-close'
              onClick={onClose}
              aria-label='Close sidebar'
              title='Close sidebar'
            >
              ✕
            </button>
          )}
        </div>

        {isLoading && <div className='conversation-sidebar-status'>Loading…</div>}

        {!isLoading && conversations.length === 0 && (
          <div className='conversation-sidebar-status'>No conversations yet</div>
        )}

        <ul className='conversation-list'>
          {conversations.map((conversation) => {
            const isSelected = selectedId === conversation.id;
            return (
              <li
                key={conversation.id}
                className={`conversation-item ${isSelected ? 'selected' : ''}`}
              >
                <button
                  type='button'
                  className='conversation-item-button'
                  onClick={() => handleSelect(conversation.id)}
                  disabled={disabled}
                  aria-current={isSelected ? 'true' : undefined}
                  title={conversation.title ?? 'Untitled conversation'}
                >
                  <span className='conversation-item-title'>
                    {conversation.title ?? 'Untitled conversation'}
                  </span>
                  <span
                    className='conversation-item-activity'
                    title={new Date(Date.parse(conversation.lastActivityAt)).toLocaleString()}
                  >
                    {formatActivity(conversation.lastActivityAt)}
                  </span>
                </button>
                <button
                  type='button'
                  className='conversation-item-delete'
                  onClick={() => onDelete(conversation.id)}
                  disabled={disabled}
                  aria-label={`Delete ${conversation.title ?? 'conversation'}`}
                  title='Delete chat'
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
};
