# UI/UX & Code Architecture Refactor Plan (P0 - P2)

**Document Target**: `docs/engineering/plans/2026-10-14-ui-ux-refactor-p0-p2.md`  
**Branch**: `feature/ui-ux-refactor-p0-p2`  
**Scope**: Prismatix Web UI (`src/`)

---

## 1. Overview & Strategy

This document outlines the targeted changes across the Prismatix frontend to address the P0–P2 UI/UX and architectural issues. Every change is mapped directly to specific files, functions, and style sheets so that implementation can proceed methodically without regressions.

---

## 2. Issues & Codebase Mapping

### P0.1: Body / Prose Font Readability
- **Root Cause**: `ChatInterface.css` applies `font-family: var(--font-mono)` to `.chat-container`, `.message-content`, and `.message-text`. This forces all long-form assistant answers, user questions, and paragraphs into monospace.
- **Affected Files**:
  - `src/styles/ChatInterface.css`:
    - Set `.chat-container` font to `var(--font-sans)`.
    - Ensure `.message-text` and `.formatted-message-container` use `var(--font-sans)`.
    - Explicitly preserve `var(--font-mono)` for telemetry badges (`.cost-badge`, `.message-model-pill`, `.spend-pill`), code blocks (`pre`, `code`), and input placeholders/shortcuts where intended.
  - `src/styles/mobile.css`:
    - Confirm `--font-sans` hierarchy (`'Inter', system-ui, -apple-system, sans-serif`).

### P0.2: ChatInterface Decomposition
- **Root Cause**: `src/components/ChatInterface.tsx` is an ~1,980-line monolithic component containing input composition, header toolbar, model selection popover logic, message rendering, auto-scrolling, and stream listening.
- **Action Plan**:
  - Extract the input composer into `src/components/ChatInputComposer.tsx`.
    - Holds: draft attachments (`AttachmentPreview`), file upload button (`FileUpload`), textarea with keyboard listeners (`onKeyDown`, `Shift+Enter`), send button, stop button, stream outcome pills, bounded context indicator, and validation alert.
    - Props: `input`, `onChange`, `onKeyDown`, `onSend`, `onStop`, `isStreaming`, `isWaitingFirstToken`, `draftAttachments`, `onRemoveAttachment`, `onClearAllAttachments`, `onFileSelect`, `onMultipleFiles`, `hasPendingVideoUploads`, `streamOutcome`, `contextExcludedCount`, `duplicateNotice`, `composerValidationView`, `openRoutingDebateMenu`.
  - Extract message item rendering into `src/components/ChatMessageItem.tsx`.
    - Holds: avatar, role, model pill, metadata popovers, route explanation list, debate view, cost badge, timestamps, attachment preview rows, thinking process, formatted message, and streaming pulse loader.
    - Memoized with `React.memo` so incoming SSE stream tokens update only the streaming message rather than re-rendering every message in history.
  - Refactor `src/components/ChatInterface.tsx`:
    - Retain top-level state coordination (active conversation, Supabase auth/storage integration, router stream subscription).
    - Import and render `<ChatInputComposer />` and `<ChatMessageItem />`.
    - Keep test compatibility 100% intact with `ChatInterface.continuity.test.tsx` and `ChatInterface.e2e.test.tsx`.

### P1.1: Markdown Prose Parsing & Rendering Enhancements
- **Root Cause**: `src/components/FormattedMessage.tsx` custom regex block parser works well for unit tests but can stumble on nested formatting, and lacks inline code styling distinctions.
- **Action Plan**:
  - Enhance `src/components/FormattedMessage.tsx`:
    - Improve blockquote handling, nested bullet list recognition, and ensure code blocks maintain copy button functionality.
    - Ensure clean streaming rendering (unclosed backticks handle graceful preview without layout shifts).
    - Maintain zero HTML injection (XSS security invariant tested by `FormattedMessage.test.tsx`).
    - Add unit tests verifying list nesting and multi-line markdown rendering.

### P1.2: Component Inlined `<style>` Extraction
- **Root Cause**: `AuthenticatedApp.tsx` and `Auth.tsx` embed extensive raw `<style>{`...`}</style>` blocks that modify global tags (`html, body, #root`) and inject unminified CSS into DOM runtime.
- **Affected Files**:
  - Create `src/styles/Auth.css`:
    - Move all `.auth-container`, `.auth-card`, `.form-group`, `.social-button`, etc., into `Auth.css`.
  - `src/components/Auth.tsx`:
    - Import `../styles/Auth.css`.
    - Remove inlined `<style>` tag.
  - `src/components/AuthenticatedApp.tsx`:
    - Move `.loading-screen`, `.loading-spinner-large` and container rules into `ChatInterface.css` or `mobile.css`.
    - Remove inlined `<style>` blocks.

### P2.1: Conversation Deletion Two-Step Confirmation
- **Root Cause**: In `src/components/ConversationSidebar.tsx`, clicking "Delete chat" in the action menu triggers `onDelete(id)` immediately. A miss-click permanently deletes the conversation and logs without warning.
- **Action Plan**:
  - Update `src/components/ConversationSidebar.tsx`:
    - Track `confirmDeleteId: string | null`.
    - First click changes the menu item button to `"Confirm delete?"` with destructive styling.
    - Second click commits `onDelete(id)`.
    - Blurring the menu, pressing Escape, or clicking away resets `confirmDeleteId`.
    - If needed by unit tests, ensure the trigger either honors direct deletion or the test simulates the confirmation step cleanly.
  - Update `src/components/ConversationSidebar.test.tsx` if test requires 2-step confirmation.

---

## 3. Verification & Safety Verification Gates

1. **Unit & Integration Suite**: Run `npm test -- --run` across all 62 test files (616 tests) to verify 0 regressions.
2. **Type Check**: Run `npx tsc --noEmit` to ensure type soundness across extracted components.
3. **Build Check**: Run `npm run build` to verify Vite bundle compilation and CSS asset extraction.
4. **Git & PR Protocol**: Commit changes atomically, push branch to remote `origin feature/ui-ux-refactor-p0-p2`, and open PR with `gh pr create`.
