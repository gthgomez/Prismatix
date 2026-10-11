# Shared Prismatix Application Theme — Implementation Plan

Date: 2026-10-10
Spec: `docs/superpowers/specs/2026-10-10-shared-application-theme-design.md`

## Goal and constraints

Apply one semantic black-and-cyan design system across functional Prismatix UI surfaces, improve model selection and provider status clarity, and preserve all auth, routing, provider, pricing, and persistence contracts. No runtime dependencies. Work in dependency order: shared foundations, app shell, settings/pickers, auth states, then verification.

## Steps

1. **Define shared tokens and accessibility foundations**
   - Audit existing global variables and component-local overrides in `src/styles/mobile.css`, `src/components/ChatInterface.css`, and `src/components/ConversationSidebar.css`.
   - Consolidate semantic canvas/surface/text/border/focus/selection/status tokens; preserve the existing black/cyan identity and add tokens only for missing roles.
   - Add shared control/focus/status rules plus reduced-motion, reduced-transparency, and forced-colors fallbacks. Keep forms and dense lists opaque.
   - Verify at narrow widths and 200% zoom without changing application behavior.

2. **Unify chat shell, navigation, overlays, and status panels**
   - Align the chat header, composer, sidebar, account menu, context/spend panels, and dialog layers with the shared tokens and spacing/control rules.
   - Fix responsive overflow and overlay stacking/focus treatment where these existing surfaces conflict.
   - Preserve message, navigation, spend, threshold, and menu behavior.

3. **Improve model picker clarity and search**
   - Add a search field and filtered/empty states while preserving the existing model catalog, ordering options, and selection persistence.
   - Distinguish automatic selection, selected model, and keyboard focus. Use neutral model names with only a subtle provider mark.
   - Clarify “Model order” and format price labels as USD per 1M input/output tokens without changing price values or formatter inputs.
   - Add focused component tests for filtering, empty results, state distinction, ordering labels, and price presentation.

4. **Unify provider settings and truthful readiness copy**
   - Restyle the settings panel for desktop and full-screen mobile use with clear provider rows, controls, status, scrolling, and close affordance.
   - Derive OpenCode explanation only from existing `hasKey`/server metadata; retain masked key inputs and current save/error semantics.
   - Add component coverage for both reported OpenCode metadata states and preserve other provider actions.

5. **Unify authentication, reset, and loading surfaces**
   - Replace embedded divergent palette/type treatments in auth, password reset, and authenticated loading UI with the shared foundations.
   - Preserve all form actions, validation, reset links, routing, and loading transitions. Verify these screens at desktop and mobile widths.

6. **Review candidate and verify**
   - Inspect the full diff for scope, token consistency, layering, keyboard access, and preserved behavior.
   - Run targeted tests, then the full test suite, type-check, lint, and production build serially to respect host resource constraints.
   - Inspect representative desktop/mobile UI states and correct any issues found; repeat affected checks.
   - Obtain a fresh independent review of the final candidate before considering merge, then address findings and rerun impacted checks.

## Completion criteria

All six spec acceptance criteria are met; tests, type-check, lint, and build pass; UI review covers representative desktop/mobile settings and app states; and the final candidate has a clean diff with independent review evidence.
