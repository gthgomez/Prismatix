import React, { useEffect, useRef, useState } from "react";
import {
  type MemoryRecord,
  memoryRequest,
  type MemoryStatus,
} from "../services/memory";
import "./MemorySettings.css";

export function MemorySettings({ onClose, onOpenConversation }: {
  onClose: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const refresh = async () => {
    const nextStatus = await memoryRequest<MemoryStatus>("status");
    const nextItems = await memoryRequest<MemoryRecord[]>("list");
    if (!alive.current) return;
    setStatus(nextStatus);
    setItems(nextItems);
    setMore(nextItems.length === 50);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Memory is unavailable.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void run(refresh);
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      alive.current = false;
      document.body.style.overflow = overflow;
      previous?.focus();
    };
    // Load once per dialog; actions explicitly refresh the server state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (action: string, args: Record<string, unknown> = {}) =>
    run(async () => {
      await memoryRequest(action, args);
      await refresh();
    });
  return (
    <div className="provider-settings-backdrop" onClick={onClose}>
      <div
        className="provider-settings memory-settings"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-heading"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const nodes = Array.from(
              panel.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
              ),
            );
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === panel.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2 id="memory-heading">Memory</h2>
          <button onClick={onClose} aria-label="Close memory">Close</button>
        </header>
        <p>
          Saved information can be recalled across your chats and models.
          Memories are evidence from your messages; they may need correction.
        </p>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Updating memory…</p>}
        {status && (
          <>
            <label>
              <input
                type="checkbox"
                checked={status.setting_enabled}
                disabled={busy || !status.entitled}
                onChange={(e) =>
                  void change("settings", { enabled: e.target.checked })}
              />Enable saving and recall
            </label>
            {!status.entitled && (
              <p>Memory access has not been enabled for your account.</p>
            )}
            {!status.enabled && status.entitled && (
              <p>Memory is paused. Your saved records remain available here.</p>
            )}
            <label>
              <input
                type="checkbox"
                checked={status.forget_on_chat_delete}
                disabled={busy}
                onChange={(e) =>
                  void change("settings", {
                    forgetOnChatDelete: e.target.checked,
                  })}
              />Forget derived memories when their last source chat is deleted
            </label>
            <p>
              {status.count} saved records{status.last_saved_at
                ? ` · Last updated ${
                  new Date(status.last_saved_at).toLocaleString()
                }`
                : ""}
            </p>
            {status.jobs.length > 0 && (
              <section aria-label="Memory processing">
                <p>
                  Processing:{" "}
                  {status.jobs.map((j) => j.state).join(", ")}. New turns also
                  resume unfinished work.
                </p>
                <button
                  disabled={busy || !status.enabled}
                  onClick={() => void change("retry")}
                >
                  Retry unfinished memory
                </button>
              </section>
            )}
          </>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!query.trim()) {
                await refresh();
                return;
              }
              const found = await memoryRequest<MemoryRecord[]>(
                "search_memory",
                { query: query.trim(), limit: 8 },
              );
              if (alive.current) {
                setItems(found);
                setMore(false);
              }
            });
          }}
        >
          <label>
            Search memories<input
              value={query}
              maxLength={512}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button disabled={busy}>Search</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setQuery("");
              void run(refresh);
            }}
          >
            Show all
          </button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await memoryRequest(editing ? "correct" : "remember", {
                ...(editing ? { id: editing } : {}),
                text: draft.trim(),
              });
              if (alive.current) {
                setEditing(null);
                setDraft("");
              }
              await refresh();
            });
          }}
        >
          <label>
            {editing ? "Correct memory" : "Remember something"}
            <textarea
              value={draft}
              maxLength={500}
              disabled={busy || !status?.enabled}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !status?.enabled || draft.trim().length < 3}
          >
            {editing ? "Save correction" : "Remember"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft("");
              }}
            >
              Cancel correction
            </button>
          )}
        </form>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <p>{item.text}</p>
              <small>
                {item.basis === "legacy"
                  ? "Legacy summary · unverified"
                  : item.basis === "manual"
                  ? "Saved by you"
                  : "From your message"}
              </small>
              <div>
                {Array.from(
                  new Set(
                    item.sources.map((s) => s.conversation_id).filter((
                      id,
                    ): id is string => Boolean(id)),
                  ),
                ).map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      onOpenConversation(id);
                      onClose();
                    }}
                  >
                    Open source chat
                  </button>
                ))}
                <button
                  disabled={busy || !status?.enabled}
                  onClick={() => {
                    setEditing(item.id);
                    setDraft(item.text.length <= 500 ? item.text : "");
                  }}
                >
                  Correct
                </button>
                <button
                  disabled={busy}
                  onClick={() => void change("forget", { id: item.id })}
                >
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!busy && items.length === 0 && <p>No matching memories.</p>}
        {more && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const last = items[items.length - 1];
                if (!last) return;
                const page = await memoryRequest<MemoryRecord[]>("list", {
                  before: last.id,
                });
                if (alive.current) {
                  setItems((previous) => [...previous, ...page]);
                  setMore(page.length === 50);
                }
              })}
          >
            Load more memories
          </button>
        )}
      </div>
    </div>
  );
}
