-- Historical version retained: the original scheduled a placeholder endpoint.
-- It is intentionally inert for new replays. The already-applied migration and
-- shipped SQL remain in Git history. Existing jobs are addressed by the later
-- forward repair; do not restore the old definition during staging rollback.
select 1;
