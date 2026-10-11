import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { MemorySettings } from "./MemorySettings";
import { memoryRequest } from "../services/memory";
vi.mock("../services/memory", () => ({ memoryRequest: vi.fn() }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.mocked(memoryRequest).mockReset());
it("moves focus to the correction editor and clears stale search after refresh", async () => {
  vi.mocked(memoryRequest).mockImplementation(async (action) => action === "list" || action === "search_memory"
    ? [{ id: "item", text: "Synthetic preference", kind: "preference", basis: "manual", sources: [] }]
    : { entitled: true, enabled: true, setting_enabled: true, forget_on_chat_delete: true, count: 1, last_saved_at: null, jobs: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MemorySettings onClose={vi.fn()} onOpenConversation={vi.fn()} />));
  const search = container.querySelector<HTMLInputElement>("input:not([type=checkbox])")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(search, "synthetic"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
  act(() => button("Correct").click());
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  expect(container.querySelector("textarea")?.value).toBe("Synthetic preference");
  await act(async () => container.querySelectorAll("form")[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(search.value).toBe("");
  act(() => root.unmount());
  container.remove();
});
it("explains the initial empty catalog separately from an empty search", async () => {
  vi.mocked(memoryRequest).mockImplementation(async (action) => action === "list" ? [] :
    { entitled: true, enabled: true, setting_enabled: true, forget_on_chat_delete: true, count: 0, last_saved_at: null, jobs: [] });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<MemorySettings onClose={vi.fn()} onOpenConversation={vi.fn()} />));
  expect(container.textContent).toContain("No saved memories yet");
  act(() => root.unmount());
});
it("loads records, pauses memory, and opens an owned source chat", async () => {
  vi.mocked(memoryRequest).mockImplementation(async (action) =>
    action === "list"
      ? [
        {
          id: "item",
          text: "I prefer concise replies",
          kind: "preference",
          basis: "user_statement",
          sources: [{ conversation_id: "chat" }],
        },
      ]
      : {
        entitled: true,
        enabled: true,
        setting_enabled: true,
        forget_on_chat_delete: true,
        count: 1,
        last_saved_at: null,
        jobs: [],
      }
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  const open = vi.fn();
  const close = vi.fn();
  await act(async () =>
    root.render(<MemorySettings onClose={close} onOpenConversation={open} />)
  );
  expect(container.textContent).toContain("I prefer concise replies");
  const source = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent === "Open source chat"
  )!;
  act(() => source.click());
  expect(open).toHaveBeenCalledWith("chat");
  expect(close).toHaveBeenCalled();
  const checkbox = container.querySelector<HTMLInputElement>(
    "input[type=checkbox]",
  )!;
  await act(async () => checkbox.click());
  expect(memoryRequest).toHaveBeenCalledWith("settings", { enabled: false });
  act(() => root.unmount());
});
it("refreshes after forgetting and preserves visible evidence on failed saves", async () => {
  let forgotten = false;
  vi.mocked(memoryRequest).mockImplementation(async (action) => {
    if (action === "forget") {
      forgotten = true;
      return {};
    }
    if (action === "retry") {
      throw new Error("Memory could not be updated. Please try again.");
    }
    if (action === "list") {
      return forgotten ? [] : [{
        id: "item",
        text: "Synthetic preference",
        kind: "fact",
        basis: "legacy",
        sources: [],
      }];
    }
    return {
      entitled: true,
      enabled: true,
      setting_enabled: true,
      forget_on_chat_delete: true,
      count: forgotten ? 0 : 1,
      last_saved_at: null,
      jobs: [{ id: "job", state: "failed" }],
    };
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MemorySettings onClose={vi.fn()} onOpenConversation={vi.fn()} />,
    )
  );
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent === label
    )!;
  await act(async () => button("Retry unfinished memory").click());
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "could not be updated",
  );
  expect(container.textContent).toContain("Synthetic preference");
  await act(async () => button("Forget").click());
  expect(memoryRequest).toHaveBeenCalledWith("forget", { id: "item" });
  expect(container.textContent).not.toContain("Synthetic preference");
  act(() => root.unmount());
});
