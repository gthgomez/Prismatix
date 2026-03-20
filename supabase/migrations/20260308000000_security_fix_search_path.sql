-- Security hardening: fix mutable search_path for core functions (Supabase Lint 0011)

ALTER FUNCTION public.increment_token_count(uuid, integer) 
  SECURITY DEFINER 
  SET search_path = public;

ALTER FUNCTION public.set_updated_at_timestamp() 
  SET search_path = public;
