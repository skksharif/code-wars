-- Minimal stand-in for the parts of a Supabase project that the migrations
-- depend on, so they can run on plain Postgres (PGlite) in tests.
-- It mirrors Supabase's permissive defaults on purpose: new tables and
-- functions in public are granted to anon and authenticated, so the tests
-- prove that our own revokes and RLS policies are what protect the data.

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
