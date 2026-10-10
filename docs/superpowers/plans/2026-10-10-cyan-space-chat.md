# Cyan Space Chat Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Repair chat overflow and give Prismatix a coherent black-and-cyan space atmosphere.

**Architecture:** Keep the existing React web app and its persistent composer. Put decoration in a clipped, noninteractive background layer; simplify the empty state and adapt the header to the available chat width. Routing, authentication, storage, spend accounting, and provider contracts remain intact.

**Tech Stack:** React 18, TypeScript, CSS, Vite, Vitest.

**Spec:** The screenshot/source critique in the conversation, approved by the owner's instruction to implement, push, and create a PR.

## Global Constraints

- Keep Prismatix branding, near-black surfaces, and the existing `#4ECDC4` interaction accent.
- Use cyan atmospheric light, sparse stars, and subtle directional motion; do not copy reference wording.
- Keep the composer mounted through the first response and New Chat transitions.
- Keep cost, context, routing, provider settings, reset, history, and account controls available.
- Provide solid glass fallbacks, visible keyboard focus, reduced motion/transparency, and forced-color behavior.
- No new runtime dependencies, provider requests, credentials, or backend changes.
- Work in an isolated task branch; preserve other checkouts and publish a PR without merging.

## Review Focus

- Narrow chat width with the desktop sidebar open: controls must fit and remain available.
- Short mobile viewport / keyboard: the composer and error actions must remain reachable.
- Long messages, code, model names, and attachments: overflow must be contained at the owning region.
- First response / New Chat: textarea identity and attachment state must survive the visual transition.
- Reduced motion, solid fallback, and keyboard focus: decoration must not be required to operate the chat.

## Task 1: Chat presentation and layout

**Files:**
- Create: `src/components/ChatBackdrop.tsx`, `src/styles/ChatBackdrop.css`.
- Modify: `src/components/ChatInterface.tsx`, `src/styles/ChatInterface.css`.
- Modify: `src/styles/mobile.css`, `src/styles/ConversationSidebar.css`.
- Test: `src/components/ChatInterface.e2e.test.tsx`.

**Interfaces:**
- Consumes: existing composer, `ContextStatus`, `SpendTracker`, model-menu and sidebar handlers.
- Produces: decorative `ChatBackdrop(): JSX.Element`; existing public chat props remain unchanged.

- [x] Run the existing suite with one worker and record baseline failures if any.
- [x] Add a failing integration test for an accessible message input and an automatic-routing label that does not imply a manually selected model; verify failure.
- [x] Add regression coverage for changing routing mode and preserving the composer through streaming and history toggles.
- [x] Implement the clipped backdrop, simplified greeting/suggestions, persistent composer, compact header, semantic colors, and available-width responsive rules.
- [x] Run the full suite, type-check, and production build with bounded workers.
- [x] Inspect desktop/sidebar/compact/short layouts in a local preview using synthetic data, including overflow and keyboard focus; inspect accessibility fallback rules in source.
- [x] Review the diff and report unavailable independent review evidence honestly.

Publication follows explicit staging, staged-diff inspection, commit inspection, task-branch push, and PR CI inspection. GitHub records the publication result.

## Validation evidence

- VERIFIED: baseline 51 files / 543 tests passed; final suite 51 files / 545 tests passed with one worker. New tests cover routing mode, draft resize bounds, and persistent textarea identity through streaming/history/New Chat.
- VERIFIED: type-check, production build, lint (zero errors; 44 warnings), stale-model budget, and whitespace check passed.
- OBSERVED: local Chromium layouts at 1280×585, 1000×740 with sidebar, 640×480, 360×740, 320×568, and 360×320 had no horizontal page overflow. Routing/spend popovers fit their chat region. Suggested drafts resized; long drafts remained in a scrollable composer region; keyboard focus was visible.
- UNKNOWN: physical mobile keyboard behavior, browser emulation of reduced-motion/transparency/forced colors, and authenticated live provider behavior were not exercised. Fallback rules were inspected in source; no live provider requests were sent.
- Independent review is pending: available host memory stayed below the owner's 3 GiB review-agent floor. Publish as a draft until fresh review is available; do not merge.
