-- HNShop Sellkey staff roles
-- Run this script in Supabase SQL Editor as project owner.
-- Only users with app_metadata.role = 'admin' can manage Sellkey accounts.

create or replace function public.admin_list_sell_staff()
returns table (
  email text,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Admin permission required';
  end if;

  return query
  select u.email::text,
         coalesce(u.raw_app_meta_data ->> 'role', '') = 'sell'
         and (u.banned_until is null or u.banned_until < now()) as active
  from auth.users u
  where coalesce(u.raw_app_meta_data ->> 'role', '') in ('sell', 'disabled')
  order by u.email;
end;
$$;

create or replace function public.admin_set_sell_role(
  p_email text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Admin permission required';
  end if;

  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'Email is required';
  end if;

  select u.id, coalesce(u.raw_app_meta_data ->> 'role', '')
    into v_user_id, v_role
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    return false;
  end if;

  -- Never allow this staff-management function to downgrade another Admin.
  if v_role = 'admin' then
    raise exception 'Cannot change an Admin account';
  end if;

  update auth.users
  set raw_app_meta_data =
        jsonb_set(
          coalesce(raw_app_meta_data, '{}'::jsonb),
          '{role}',
          to_jsonb(case when p_enabled then 'sell' else 'disabled' end),
          true
        ),
      banned_until = case
        when p_enabled then null
        else now() + interval '100 years'
      end,
      updated_at = now()
  where id = v_user_id;

  return true;
end;
$$;

revoke all on function public.admin_list_sell_staff() from public;
revoke all on function public.admin_set_sell_role(text, boolean) from public;
grant execute on function public.admin_list_sell_staff() to authenticated;
grant execute on function public.admin_set_sell_role(text, boolean) to authenticated;

