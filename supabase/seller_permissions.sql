-- HNShop: per-Seller permissions
-- Run in Supabase SQL Editor as project owner.

create table if not exists public.seller_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_use_key_stock boolean not null default false,
  can_sell_keys boolean not null default false,
  can_view_orders boolean not null default false,
  can_kick_customers boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.seller_permissions enable row level security;
revoke all on public.seller_permissions from anon, authenticated;

create or replace function public.admin_list_seller_permissions()
returns table(
  user_id uuid,
  username text,
  can_use_key_stock boolean,
  can_sell_keys boolean,
  can_view_orders boolean,
  can_kick_customers boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Chỉ Admin được quản lý quyền Seller';
  end if;

  return query
  select u.id,
         coalesce(u.raw_user_meta_data->>'username', split_part(u.email,'@',1))::text,
         coalesce(p.can_use_key_stock,false),
         coalesce(p.can_sell_keys,false),
         coalesce(p.can_view_orders,false),
         coalesce(p.can_kick_customers,false)
  from auth.users u
  left join public.seller_permissions p on p.user_id=u.id
  where coalesce(u.raw_app_meta_data->>'role','')='sell'
  order by coalesce(u.raw_user_meta_data->>'username', split_part(u.email,'@',1));
end;
$$;

create or replace function public.admin_set_seller_permission(
  p_user_id uuid,
  p_permission text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Chỉ Admin được cấp hoặc thu hồi quyền';
  end if;
  if p_permission is null or p_permission not in ('key_stock','sell_keys','view_orders','kick_customers') then
    raise exception 'Loại quyền không hợp lệ';
  end if;

  select coalesce(u.raw_app_meta_data->>'role','') into v_role
  from auth.users u where u.id=p_user_id;
  if v_role is distinct from 'sell' then
    raise exception 'Tài khoản không phải Seller đang hoạt động';
  end if;

  insert into public.seller_permissions(user_id,updated_by)
  values(p_user_id,auth.uid())
  on conflict(user_id) do update set updated_by=excluded.updated_by,updated_at=now();

  if p_permission='key_stock' then
    update public.seller_permissions set can_use_key_stock=p_enabled,updated_by=auth.uid(),updated_at=now() where user_id=p_user_id;
  elsif p_permission='sell_keys' then
    update public.seller_permissions set can_sell_keys=p_enabled,updated_by=auth.uid(),updated_at=now() where user_id=p_user_id;
  elsif p_permission='view_orders' then
    update public.seller_permissions set can_view_orders=p_enabled,updated_by=auth.uid(),updated_at=now() where user_id=p_user_id;
  else
    update public.seller_permissions set can_kick_customers=p_enabled,updated_by=auth.uid(),updated_at=now() where user_id=p_user_id;
  end if;
  return true;
end;
$$;

create or replace function public.sell_get_my_permissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text; v_result jsonb;
begin
  v_role:=coalesce(auth.jwt()->'app_metadata'->>'role','');
  if v_role='admin' then
    return jsonb_build_object('key_stock',true,'sell_keys',true,'view_orders',true,'kick_customers',true);
  end if;
  if v_role<>'sell' or auth.uid() is null then
    raise exception 'Không có quyền truy cập';
  end if;
  select jsonb_build_object(
    'key_stock',coalesce(p.can_use_key_stock,false),
    'sell_keys',coalesce(p.can_sell_keys,false),
    'view_orders',coalesce(p.can_view_orders,false),
    'kick_customers',coalesce(p.can_kick_customers,false)
  ) into v_result
  from (select auth.uid() as user_id) me
  left join public.seller_permissions p on p.user_id=me.user_id;
  return coalesce(v_result,jsonb_build_object('key_stock',false,'sell_keys',false,'view_orders',false));
end;
$$;

create or replace function public.sell_get_key_stock_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text; v_allowed boolean;
begin
  v_role:=coalesce(auth.jwt()->'app_metadata'->>'role','');
  if v_role='admin' then v_allowed:=true;
  elsif v_role='sell' then
    select coalesce(p.can_use_key_stock,false) into v_allowed
    from (select auth.uid() as user_id) me
    left join public.seller_permissions p on p.user_id=me.user_id;
    v_allowed:=coalesce(v_allowed,false);
  else
    v_allowed:=false;
  end if;
  if not v_allowed then raise exception 'Bạn chưa được cấp quyền sử dụng kho key'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id',x.product_id,'product_name',x.product_name,
      'package_id',x.package_id,'package_name',x.package_name,
      'available',x.available,'delivered',x.delivered
    ) order by x.product_name,x.package_name)
    from (
      select pk.product_id,p.name as product_name,pk.package_id,pp.name as package_name,
        count(*) filter(where pk.status='available')::bigint as available,
        count(*) filter(where pk.status='delivered')::bigint as delivered
      from public.product_keys pk
      join public.products p on p.id=pk.product_id
      left join public.product_packages pp on pp.id=pk.package_id
      group by pk.product_id,p.name,pk.package_id,pp.name
    ) x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.sell_list_shop_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_view boolean := false;
  v_sell boolean := false;
  v_result jsonb;
begin
  v_role:=coalesce(auth.jwt()->'app_metadata'->>'role','');
  if v_role='admin' then
    v_view:=true; v_sell:=true;
  elsif v_role='sell' then
    select coalesce(p.can_view_orders,false),coalesce(p.can_sell_keys,false)
      into v_view,v_sell
    from (select auth.uid() as user_id) me
    left join public.seller_permissions p on p.user_id=me.user_id;
    v_view:=coalesce(v_view,false); v_sell:=coalesce(v_sell,false);
  else
    raise exception 'Không có quyền xem đơn hàng';
  end if;
  if not v_view and not v_sell then raise exception 'Bạn chưa được cấp quyền xem hoặc xử lý đơn hàng'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',o.id,'total',o.total,'status',o.status,
      'transfer_note',o.transfer_note,'created_at',o.created_at,'paid_at',o.paid_at,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_name',i.product_name,'package_name',i.package_name,
          'quantity',i.quantity,'price',i.price
        ))
        from public.store_order_items i where i.order_id=o.id
      ),'[]'::jsonb)
    ) order by o.created_at desc
  ),'[]'::jsonb) into v_result
  from public.store_orders o
  where v_view or (v_sell and o.status='pending');
  return v_result;
end;
$$;

-- Server-side guard: a Seller cannot deliver inventory keys without the grant,
-- even if they call the payment-confirmation RPC directly.
create or replace function public.guard_seller_key_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text; v_allowed boolean := false;
begin
  v_role:=coalesce(auth.jwt()->'app_metadata'->>'role','');
  if v_role='sell' and new.status='delivered' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select coalesce(p.can_sell_keys,false) into v_allowed
    from (select auth.uid() as user_id) me
    left join public.seller_permissions p on p.user_id=me.user_id;
    if not coalesce(v_allowed,false) then
      raise exception 'Admin chưa cấp quyền Bán key cho tài khoản Seller này';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_seller_key_delivery on public.product_keys;
create trigger trg_guard_seller_key_delivery
before insert or update on public.product_keys
for each row execute function public.guard_seller_key_delivery();

revoke all on function public.admin_list_seller_permissions() from public;
revoke all on function public.admin_set_seller_permission(uuid,text,boolean) from public;
revoke all on function public.sell_get_my_permissions() from public;
revoke all on function public.sell_get_key_stock_summary() from public;
revoke all on function public.sell_list_shop_orders() from public;
grant execute on function public.admin_list_seller_permissions() to authenticated;
grant execute on function public.admin_set_seller_permission(uuid,text,boolean) to authenticated;
grant execute on function public.sell_get_my_permissions() to authenticated;
grant execute on function public.sell_get_key_stock_summary() to authenticated;
grant execute on function public.sell_list_shop_orders() to authenticated;


-- Seller permission: kick/block customers from the Shop. Only blocks Shop access;
-- it does not delete the customer account or erase orders.
create or replace function public.sell_set_shop_customer_blocked(
  p_user_id uuid,
  p_blocked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_allowed boolean := false;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then
    v_allowed:=true;
  elsif coalesce(auth.jwt()->'app_metadata'->>'role','')='sell' then
    select coalesce(p.can_kick_customers,false) into v_allowed
    from (select auth.uid() as user_id) me
    left join public.seller_permissions p on p.user_id=me.user_id;
  end if;
  if not coalesce(v_allowed,false) then
    raise exception 'Admin chưa cấp quyền Kích khách khỏi Shop';
  end if;
  update public.shop_customer_access
  set is_blocked=p_blocked
  where user_id=p_user_id;
  return found;
end;
$$;

revoke all on function public.sell_set_shop_customer_blocked(uuid,boolean) from public;
grant execute on function public.sell_set_shop_customer_blocked(uuid,boolean) to authenticated;
