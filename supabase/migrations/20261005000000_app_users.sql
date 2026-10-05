-- Plaque Proof Studio sign-in accounts (username + password).
-- Passwords are stored only as bcrypt hashes. The table has row level security on and no
-- policies, so the public (publishable/anon) key cannot read it; the app server signs people
-- in through app_login(), which returns the account only for the right password.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  display_name text not null,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists app_users_username_key on public.app_users (lower(username));
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;

-- Sign in. Ten wrong passwords in a row lock the account for 15 minutes.
create or replace function public.app_login(p_username text, p_password text)
returns table (id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.app_users;
begin
  select * into u from public.app_users a where lower(a.username) = lower(btrim(p_username));
  if not found then
    -- Same work as a real check, so timing does not reveal which usernames exist.
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    return;
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    raise exception 'Too many wrong passwords. Try again in 15 minutes.' using errcode = 'P0001';
  end if;
  if u.password_hash = extensions.crypt(coalesce(p_password, ''), u.password_hash) then
    update public.app_users a set failed_attempts = 0, locked_until = null, last_login_at = now() where a.id = u.id;
    return query select u.id, u.username, u.display_name;
  else
    update public.app_users a
      set failed_attempts = case when a.failed_attempts + 1 >= 10 then 0 else a.failed_attempts + 1 end,
          locked_until = case when a.failed_attempts + 1 >= 10 then now() + interval '15 minutes' else a.locked_until end
      where a.id = u.id;
  end if;
end;
$$;
revoke all on function public.app_login(text, text) from public;
grant execute on function public.app_login(text, text) to anon, authenticated, service_role;

-- Add or update an account (run in the Supabase SQL editor; not callable with the public key):
--   select public.app_set_user('Name', 'password');
create or replace function public.app_set_user(p_username text, p_password text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if length(btrim(coalesce(p_username, ''))) = 0 or length(coalesce(p_password, '')) = 0 then
    raise exception 'Username and password are required.';
  end if;
  insert into public.app_users (username, display_name, password_hash)
  values (btrim(p_username), coalesce(nullif(btrim(p_display_name), ''), btrim(p_username)), extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict ((lower(username))) do update
    set password_hash = excluded.password_hash,
        display_name = coalesce(nullif(btrim(p_display_name), ''), public.app_users.display_name),
        failed_attempts = 0,
        locked_until = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.app_set_user(text, text, text) from public, anon, authenticated;

-- Only the app server (publishable key) and the service role sign people in.
revoke execute on function public.app_login(text, text) from authenticated;
