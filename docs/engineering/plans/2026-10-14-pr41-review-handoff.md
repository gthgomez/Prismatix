# PR #41 Review — Issues & Fix Handoff

**PR**: https://github.com/gthgomez/Prismatix/pull/41 (`feature/ui-ux-refactor-p0-p2`, head `4e69c79`)
**Reviewed**: 2026-10-14
**Verdict**: **Do not merge as-is.** Tests/tsc/build pass, but the PR has one likely visual regression, one ineffective optimization, two plan items that were not implemented, and a PR description that overstates what changed.

Reference plan: `docs/engineering/plans/2026-10-14-ui-ux-refactor-p0-p2.md`

---

## Summary table

| # | Severity | Issue | File(s) |
|---|----------|-------|---------|
| 1 | **High** | Removed per-route `html/body/#root` overflow rules — chat view lost `overflow: hidden` | `AuthenticatedApp.tsx`, `mobile.css` |
| 2 | **High** | Global `.loading-spinner` / `@keyframes` collision between `Auth.css` and `ChatInterface.css` | `src/styles/Auth.css` |
| 3 | Medium | `React.memo` on `ChatMessageItem` is defeated by unstable props | `ChatInterface.tsx`, `ChatMessageItem.tsx` |
| 4 | Medium | P2.1 delete confirmation **not implemented** (PR body implies it was handled) | `ConversationSidebar.tsx` |
| 5 | Medium | P1.1 markdown improvements **not implemented** | `FormattedMessage.tsx` |
| 6 | Low | P0.1 font change was a no-op (already `--font-sans`); PR body claims it "standardized" fonts | PR description |
| 7 | Low | 10 dead imports left in `ChatInterface.tsx` | `ChatInterface.tsx` |
| 8 | Low | `ChatInputComposer` imports types back from `ChatInterface` (circular module edge) | `ChatInputComposer.tsx` |
| 9 | Low | Plan doc says tests would be added; none were | tests |

---

## 1. Lost route-specific overflow rules (High)

**What happened**: The old `AuthenticatedApp.tsx` injected different global rules per state:
- Chat (authenticated): `html, body, #root { overflow: hidden; height: 100% }`
- Auth / Reset: `overflow: auto`

All four `<style>` blocks were deleted, but only the loading-screen rules were moved to `mobile.css`. `mobile.css` sets `height: 100%` but **no overflow** for `html/body/#root/.app`. Result: the chat page can now get document-level scrolling / double scrollbars and rubber-banding on mobile, breaking the fixed header + inner `.chat-messages` scroll design. Unit tests (jsdom) cannot catch this.

**Fix** (route-scoped class, no runtime `<style>`):
1. In `AuthenticatedApp.tsx`, add a modifier class per branch:
   - chat: `<div className="app app--chat">`
   - auth/reset: `<div className="app app--scroll">`
2. In `src/styles/mobile.css`:
   ```css
   html, body, #root { margin: 0; padding: 0; height: 100%; }
   body:has(.app--chat) { overflow: hidden; }
   .app--chat { height: 100%; overflow: hidden; }
   .app--scroll { min-height: 100%; overflow: auto; }
   ```
   If `:has()` support is a concern, instead toggle a class on `document.body` in a `useEffect` inside `AuthenticatedApp` (add on mount, remove on cleanup).
3. **Verify manually** in a browser (desktop + mobile viewport): chat page has exactly one scroll region (`.chat-messages`); auth page scrolls when the window is short.

## 2. Global `.loading-spinner` collision (High)

**What happened**: `Auth.css` defines `.loading-spinner` (border `rgba(255,255,255,0.3)`, top `var(--color-text)`) plus `@keyframes spin`/`float`. `ChatInterface.css:1780` also defines `.loading-spinner` (different colors) and `@keyframes spin`. Previously Auth's rules only existed while `<Auth>` was mounted; now `Auth.css` is statically imported (via `AuthenticatedApp`) and is **always** in the bundle, so whichever file loads later wins — the send-button spinner styling now depends on import order. Also, the loading screen's `float`/`spin` animations now silently depend on `Auth.css`.

**Fix**:
1. In `Auth.css`, scope the spinner: rename to `.auth-submit .loading-spinner` (or `.auth-spinner` and update `Auth.tsx` markup accordingly).
2. Move shared keyframes (`spin`, `float`, `fadeIn`) into `mobile.css` (global tokens file) once; delete duplicates from `Auth.css` and `ChatInterface.css:1785`.
3. Check `ResetPassword.tsx` — it may use the same class names; grep `loading-spinner` across `src/components`.

## 3. `ChatMessageItem` memo is ineffective (Medium)

**What happened**: In `ChatInterface.tsx` the map passes:
- `onToggleMetadata={() => setExpandedMetadataIdx(...)}` — new function every render
- `messageRef={(el) => {...}}` — new function every render
- `isStreaming` / `isWaitingFirstToken` to **every** item

So every item re-renders on every stream token — the claimed P0 perf win doesn't exist.

**Fix**:
1. Change props to stable shapes:
   - `onToggleMetadata: (index: number) => void` — pass a single `useCallback` from parent: `const toggleMetadata = useCallback((i) => setExpandedMetadataIdx(p => p === i ? null : i), [])`.
   - `registerRef: (index: number, el: HTMLDivElement | null) => void` — one `useCallback` writing to `messageRefs.current[i]`.
2. Only pass streaming flags to the last item: `isStreaming={isLast && isStreaming}`, `isWaitingFirstToken={isLast && isWaitingFirstToken}`; drop `isLastMessage` or keep it but it’s then constant for older rows.
3. `defaultModelColor` is fine (string). Keep `key={idx}` only if messages lack ids; prefer a stable id if `Message` has one.
4. Add a test: render 3 messages, spy on a render counter (e.g. `vi.fn()` inside a wrapped component or React Profiler), append a stream token to the last message, assert earlier items did not re-render.

## 4. P2.1 delete confirmation not implemented (Medium)

`ConversationSidebar.tsx:192-193` still calls `onDelete(conversation.id)` on the first click. The PR body says "Preserved menu-isolated chat deletion flows", which reads as if P2 was addressed.

**Fix**:
1. Add `const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)`.
2. Delete menuitem: first click → `setConfirmDeleteId(id)` and label becomes `Confirm delete?` with a danger class (`conversation-item-delete--confirm`); second click → `dismissMenu(true); setConfirmDeleteId(null); onDelete(id)`.
3. Reset `confirmDeleteId` whenever `menuId` changes / menu closes (Escape, blur, outside pointer) — e.g. `useEffect(() => setConfirmDeleteId(null), [menuId])`.
4. Update `ConversationSidebar.test.tsx` test **"invokes onNewChat and onDelete"** (~line 221): click delete twice; add assertions that one click does **not** call `onDelete` and that Escape resets the confirm state.
5. Add the danger style in `ConversationSidebar.css`.

## 5. P1.1 markdown improvements not implemented (Medium)

`FormattedMessage.tsx` is unchanged. Known gaps: multi-line blockquotes become separate `<blockquote>`s; `>` without trailing space isn’t recognized; indented/nested list items flatten; tables render as raw text; `parseInline` treats `*` inside words (e.g. `a*b*c`) as italic.

**Fix (keep zero-dependency + XSS-safe; must keep `FormattedMessage.test.tsx` green, incl. the XSS test)**:
1. Blockquotes: accumulate consecutive `>`-prefixed lines (regex `/^>\s?/`) into one `<blockquote>`.
2. Nested lists: compute indent (`line.length - line.trimStart().length`); when indent increases by ≥2, open a child `<ul>/<ol>` inside the previous `<li>`. A small stack of `{indent, ordered, items}` is enough.
3. Tables: detect a header row + `|---|` separator; render `<table className='formatted-table'>` with cells passed through `parseInline`; wrap in an `overflow-x: auto` div.
4. Italic: require non-word boundaries: `(?<![\w*])\*[^*\s][^*]*\*(?![\w*])`.
5. Add tests for each case. If this grows too big, the alternative is `react-markdown` + `remark-gfm` (no `rehype-raw`, to stay XSS-safe) — that's a dependency decision for the owner.

## 6. Font "standardization" was a no-op (Low)

`.chat-container` and `.formatted-message-container` were already `var(--font-sans)` on `main` before this PR (an earlier upstream commit fixed it). No CSS font change exists in the diff. **Fix**: correct the PR description; optionally replace the hardcoded mono stack at `ChatInterface.css:488` (`.debate-panel-model`) with `var(--font-mono)`.

## 7. Dead imports (Low)

`tsconfig.json` has `noUnusedLocals: false`, so tsc didn't flag them. Each of these now appears only on its import line in `ChatInterface.tsx`: `FileUpload`, `AttachmentPreview`, `CostBadge`, `PrismatixPulse`, `ThinkingProcess`, `DebateView`, `FormattedMessage`, `RouteExplanationList`, `assistantModelPillDisplay`, `shouldShowDebateBadges`. **Fix**: remove them (keep `buildRouteExplanationRows`/others only if still used — grep first), then run `npm run lint` (not run in the original PR).

## 8. Circular type import (Low)

`ChatInputComposer.tsx` imports `SendBlockedReason` / `StreamOutcomeState` from `./ChatInterface`, which imports `ChatInputComposer`. Type-only, so it works, but it’s fragile. **Fix**: move `SendBlockedReason`, `StreamOutcomeState`, `SEND_BLOCKED_TITLES`, and `PromptStarter` into `src/components/chatTypes.ts` and import from there in both files.

## 9. Missing tests (Low)

Add focused tests for `ChatInputComposer` (send disabled reasons, stop button shown only while streaming, prompt starter click calls handler) and `ChatMessageItem` (metadata popover toggle, image-unavailable placeholder), plus those listed in #3–#5.

---

## Suggested order for the next model

1. #1 and #2 (visual regressions) → manual browser check.
2. #7, #8 (mechanical cleanup) → `npm run lint`.
3. #3 (memo) + test.
4. #4 (delete confirm) + test update.
5. #5 (markdown) + tests.
6. Update PR #41 description to accurately reflect what changed (#6).

## Verification gates (all required before merge)

```
npx tsc --noEmit
npm run lint
npm test -- --run          # baseline: 62 files / 616 tests passing
npm run build
```
Plus a manual browser pass of: auth page scroll, loading screen animation, chat page single-scroll layout, send-button spinner, delete confirm flow, markdown sample with nested list + table + multi-line quote.
