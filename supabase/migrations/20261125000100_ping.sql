-- Consulta liviana para la acción programada que evita que el proyecto
-- gratuito de Supabase se pause por inactividad (.github/workflows/keepalive.yml).
-- Es lo único que `anon` puede ejecutar: no lee ninguna tabla.

create function public.ping() returns boolean
language sql stable security invoker set search_path = ''
as $$ select true $$;

revoke all on function public.ping() from public, authenticated;
grant execute on function public.ping() to anon;

-- Las funciones de trigger heredaron EXECUTE para anon/authenticated de los
-- privilegios por defecto de Supabase. Postgres no permite llamarlas fuera de
-- un trigger, pero se quitan para que la lista de lo ejecutable sea mínima.
revoke all on function public.touch_updated_at(), public.log_change(),
  public.events_living(), public.persons_guard() from public, anon, authenticated;
