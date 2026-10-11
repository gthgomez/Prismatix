# Shared Prismatix Application Theme

Date: 2026-10-10

## Goal

Make Prismatix feel like one finished application across chat, navigation, model selection, provider configuration, account and context menus, dialogs, authentication, password recovery, and loading states. Preserve the black-and-cyan space identity already introduced in PR #28 while making controls, status messages, and dense settings easy to scan and operate.

## Design direction

Use the existing semantic color variables in `src/styles/mobile.css` as the source of truth and extend them only where a missing semantic role requires it. Apply shared tokens consistently to all functional application surfaces rather than repeating local palettes in components. Keep the page canvas dark and quiet; use solid, progressively elevated surfaces for cards, popovers, and dialogs. Reserve cyan for primary actions, focus, links, and selected states. Provider identity colors may appear as small secondary marks, never as competing surfaces or model-name colors. Use the established text hierarchy and a consistent sans-serif UI face; reserve monospace for technical values where it helps recognition.

Glass and blur are decorative accents only. Keep dense lists and forms on solid backgrounds, limit prominent blurred layers to two at a time, and provide readable opaque fallbacks. Use consistent control heights, border radii, spacing, hover/pressed/disabled states, and focus rings across screens. At narrow widths, settings become a full-screen sheet and menus remain within the viewport; desktop settings use a bounded panel with a clear title, close action, and section hierarchy.

## Shared interaction and accessibility rules

- Preserve visible keyboard focus and complete keyboard access for menus, dialogs, selectors, and forms. Closing a dialog returns focus to its opener.
- Make interactive targets at least 44 CSS pixels where layout permits, without making dense desktop rows unnecessarily tall.
- Support 200% zoom, narrow viewports, reduced motion, reduced transparency, and forced-colors/high-contrast settings. Never encode selection, readiness, warning, or error by color alone.
- Keep text and controls legible over their surfaces. Decorative stars, trails, glows, and blur must not compete with content or reduce contrast.
- Use shared semantic status treatments for success/ready, neutral/off, warning/setup-needed, and error. Pair status colors with a label or icon and use the same wording wherever the same state appears.

## Surface-specific behavior and presentation

### Chat, sidebar, and application shell

Retain the space horizon as a restrained background treatment. Apply the same canvas, elevated surfaces, typography, borders, focus, and selected-navigation treatment to the chat header, conversation sidebar, composer, account menu, and responsive navigation. Keep the composer the most visually prominent working surface; maintain readable placeholder text and clear send/disabled states. Ensure popovers and dialogs layer above one another predictably, including context warnings opened near provider settings.

### Model selection

Use one neutral model-list treatment for every provider; remove provider-specific model-name colors and reserve provider color for a subtle indicator. Make selected and keyboard-highlighted states distinct and consistent with the shared cyan selection treatment. Clarify automatic selection versus an explicitly selected model, and make the current choice easy to identify. Add a search field that filters the available model list and a clear no-results state. Label ordering in plain language (“Model order”). Present price consistently as USD per million input/output tokens, and retain the underlying pricing values and formatter semantics.

### Provider settings

Use the shared panel, section, field, button, disclosure, and status styles. On desktop, show a bounded settings panel; on mobile, use a viewport-filling sheet with a persistent close affordance and usable scrolling. Each provider row should make its current enabled/configuration state and next action clear without implying connectivity that the app does not know.

Use only the existing provider metadata to describe OpenCode: when the server reports a configured key, explain that the deployment supplies credentials and the user need not add one; when it reports no configured server key, state that setup is required. Do not claim OpenCode is always usable when the existing state says otherwise. Keep API-key inputs masked, preserve current save/error behavior, and never expose key values in status text.

### Context, spend, and dialogs

Bring context warnings, spend details, confirmation dialogs, and other popovers onto the shared surface, typography, spacing, layering, and status system. Keep warnings informative and actionable, with concise copy and an obvious close/continue action appropriate to existing behavior. Do not change thresholds, calculations, or data handling.

### Authentication, password recovery, and loading

Apply the same canvas, typography, form fields, buttons, focus, and status language as the authenticated application. Keep these screens focused and calm, with a consistent brand mark and clear hierarchy. Preserve all existing authentication, reset-link, validation, and loading behavior.

### Public demo route

Keep the public demo route’s distinct portfolio content and art direction. Align only shared brand foundations where it is appropriate; a full marketing-page redesign is outside this task.

## Scope boundaries

This task is a UI consistency and usability pass. Do not change routing, authentication semantics, provider APIs or readiness contracts, model availability, pricing data, storage keys, persistence behavior, backend/schema, or secret handling. Do not add runtime dependencies or introduce a global light theme. Retain existing features and business rules while improving their presentation and discoverability.

## Acceptance criteria

1. Functional app surfaces use a coherent semantic palette, typography, control styling, spacing, and status vocabulary, with cyan consistently marking focus, primary action, and selection.
2. The model picker distinguishes automatic, selected, and focused states; search filters models; an empty result is communicated; model ordering and USD-per-million input/output pricing are clear.
3. Provider settings are usable at desktop and mobile widths, and OpenCode copy reflects the existing server-key metadata without overstating readiness or revealing secrets.
4. Forms, lists, menus, dialogs, and status messages remain legible and usable with keyboard focus, reduced motion/transparency, forced colors, and 200% zoom.
5. Authentication, reset, provider, routing, pricing, and persistence behavior remain unchanged.
6. Relevant existing automated checks pass, and the implementation is reviewed against representative desktop and mobile layouts before completion.
