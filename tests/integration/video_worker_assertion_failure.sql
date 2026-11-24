-- Shared fatal branch for fixture assertions. ON_ERROR_STOP ensures psql exits
-- nonzero; unlike `\quit 1`, this works in psql 17.
\set ON_ERROR_STOP on
do $$ begin raise exception 'video worker cron fixture assertion failed'; end $$;
