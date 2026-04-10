-- Routing evaluation columns on cost_logs
-- Enables measuring whether heuristic routing decisions are correct over time.

alter table public.cost_logs
  add column if not exists complexity_score integer,
  add column if not exists route_rationale text;

comment on column public.cost_logs.complexity_score is 'Heuristic complexity score (0–100) computed by determineRoute at request time';
comment on column public.cost_logs.route_rationale is 'Short tag describing why the model was chosen, e.g. "manual_override", "high_complexity", "code_detected", "fast_path"';
