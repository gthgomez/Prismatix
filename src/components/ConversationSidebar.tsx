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
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
}

function formatActivity(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString();
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  selectedId,
  isLoading,
  disabled = false,
  onSelect,
  onNewChat,
  onDelete,
}) => {
  return (
    <aside className='conversation-sidebar' aria-label='Conversations'>
      <button
        type='button'
        className='conversation-new-button'
        onClick={onNewChat}
        disabled={disabled}
      >
        + New Chat
      </button>

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
                onClick={() => onSelect(conversation.id)}
                disabled={disabled}
                aria-current={isSelected ? 'true' : undefined}
                title={conversation.title ?? 'Untitled conversation'}
              >
                <span className='conversation-item-title'>
                  {conversation.title ?? 'Untitled conversation'}
                </span>
                <span className='conversation-item-activity'>
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
  );
};
