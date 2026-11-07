// src/components/GlobalSearchModal.tsx
// Accessible global full-text search modal across all owned chats and messages (F05).

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchChatHistory, type ChatSearchResult } from '../services/conversationSearch';
import '../styles/GlobalSearchModal.css';

interface GlobalSearchModalProps {
  client: SupabaseClient;
  isOpen: boolean;
  onClose: () => void;
  onSelectResult: (conversationId: string, messageId: string | null) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  client,
  isOpen,
  onClose,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 20;

  // Focus management
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setError(null);
      setOffset(0);
      setHasMore(false);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const executeSearch = useCallback(
    async (searchQuery: string, searchOffset = 0, append = false) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setResults([]);
        setIsLoading(false);
        setHasMore(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const matches = await searchChatHistory(client, trimmed, {
          limit: PAGE_SIZE,
          offset: searchOffset,
        });

        if (append) {
          setResults((prev) => [...prev, ...matches]);
        } else {
          setResults(matches);
          setSelectedIndex(0);
        }

        setOffset(searchOffset);
        setHasMore(matches.length === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      void executeSearch(val, 0, false);
    }, 250);
  };

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    void executeSearch(query, nextOffset, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[selectedIndex];
      if (target) {
        onSelectResult(target.conversationId, target.messageId);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className='search-modal-backdrop' onClick={onClose}>
      <div
        className='search-modal-container'
        role='dialog'
        aria-label='Search conversation history'
        aria-modal='true'
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className='search-modal-header'>
          <div className='search-input-wrapper'>
            <span className='search-icon' aria-hidden='true'>🔍</span>
            <input
              ref={inputRef}
              type='text'
              className='search-modal-input'
              placeholder='Search messages and conversations across your account…'
              value={query}
              onChange={handleQueryChange}
              aria-label='Search query'
              autoComplete='off'
              spellCheck='false'
            />
            {query && (
              <button
                type='button'
                className='search-clear-btn'
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  inputRef.current?.focus();
                }}
                aria-label='Clear search'
              >
                ✕
              </button>
            )}
          </div>
          <button
            type='button'
            className='search-modal-close'
            onClick={onClose}
            aria-label='Close search modal'
          >
            Esc
          </button>
        </div>

        <div className='search-modal-body'>
          {isLoading && results.length === 0 && (
            <div className='search-state-message' role='status'>
              <div className='search-spinner' /> Searching all conversations…
            </div>
          )}

          {error && (
            <div className='search-state-message error' role='alert'>
              ⚠️ {error}
            </div>
          )}

          {!isLoading && !error && query.trim() && results.length === 0 && (
            <div className='search-state-message empty'>
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!query.trim() && results.length === 0 && (
            <div className='search-hint-message'>
              Type keywords to search past conversations, messages, and code snippets.
            </div>
          )}

          {results.length > 0 && (
            <div className='search-results-list' role='listbox' aria-label='Search results'>
              {results.map((item, idx) => (
                <div
                  key={`${item.conversationId}-${item.messageId ?? 'conv'}-${idx}`}
                  role='option'
                  aria-selected={idx === selectedIndex}
                  className={`search-result-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectResult(item.conversationId, item.messageId);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className='search-result-head'>
                    <span className='search-result-title'>{item.conversationTitle}</span>
                    {item.role && (
                      <span className={`search-role-badge ${item.role}`}>
                        {item.role === 'user' ? 'You' : 'Assistant'}
                      </span>
                    )}
                    <span className='search-result-date'>
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div
                    className='search-result-snippet'
                    dangerouslySetInnerHTML={{ __html: item.snippet }}
                  />
                </div>
              ))}

              {hasMore && (
                <div className='search-load-more-row'>
                  <button
                    type='button'
                    className='search-load-more-btn'
                    onClick={handleLoadMore}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading more…' : 'Load more results'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
