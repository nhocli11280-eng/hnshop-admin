-- HNShop: khóa khách khỏi Shop và phân quyền Seller kích/mở khóa khách.
-- Chạy bằng project owner trong Supabase SQL Editor nếu cần triển khai lại.

begin;

alter table public.seller_permissions
  add column if not exists can_kick_customers boolean not null default false;

drop function if exists public.admin_list_seller_permissions();
create function public.admin_list_seller_permissions()
returns table(user_id uuid,username text,can_use_key_stock boolean,can_sell_keys boolean,can_view_orders boolean,can_kick_customers boolean)
language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Chỉ Admin được quản lý quyền Seller';
  end if;
  return query
  select u.id,coalesce(u.raw_user_meta_data->>'username',split_part(u.email,'@',1))::text,
    coalesce(p.can_use_key_stock,false),coalesce(p.can_sell_keys,false),
    coalesce(p.can_view_orders,false),coalesce(p.can_kick_customers,false)
  from auth.users u left join public.seller_permissions p on p.user_id=u.id
  where coalesce(u.raw_app_meta_data->>'role','')='sell'
  order by coalesce(u.raw_user_meta_data->>'username',split_part(u.email,'@',1));
end;
$$;

create or replace function public.admin_set_seller_permission(p_user_id uuid,p_permission text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_role text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Chỉ Admin được cấp hoặc thu hồi quyền'; end if;
  if p_permission is null or p_permission not in ('key_stock','sell_keys','view_orders','kick_customers') then raise exception 'Loại quyền không hợp lệ'; end if;
  select coalesce(u.raw_app_meta_data->>'role','') into v_role from auth.users u where u.id=p_user_id;
  if v_role is distinct from 'sell' then raise exception 'Tài khoản không phải Seller đang hoạt động'; end if;
  insert into public.seller_permissions(user_id,updated_by) values(p_user_id,auth.uid())
  on conflict(user_id) do update set updated_by=excluded.updated_by,updated_at=now();
  update public.seller_permissions set
    can_use_key_stock=case when p_permission='key_stock' then p_enabled else can_use_key_stock end,
    can_sell_keys=case when p_permission='sell_keys' then p_enabled else can_sell_keys end,
    can_view_orders=case when p_permission='view_orders' then p_enabled else can_view_orders end,
    can_kick_customers=case when p_permission='kick_customers' then p_enabled else can_kick_customers end,
    updated_by=auth.uid(),updated_at=now() where user_id=p_user_id;
  return true;
end;
$$;

create or replace function public.sell_get_my_permissions()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role text; v_result jsonb;
begin
  v_role:=coalesce(auth.jwt()->'app_metadata'->>'role','');
  if v_role='admin' then return jsonb_build_object('key_stock',true,'sell_keys',true,'view_orders',true,'kick_customers',true); end if;
  if v_role<>'sell' or auth.uid() is null then raise exception 'Không có quyền truy cập'; end if;
  select jsonb_build_object('key_stock',coalesce(p.can_use_key_stock,false),
    'sell_keys',coalesce(p.can_sell_keys,false),'view_orders',coalesce(p.can_view_orders,false),
    'kick_customers',coalesce(p.can_kick_customers,false))
  into v_result from (select auth.uid() as user_id) me
  left join public.seller_permissions p on p.user_id=me.user_id;
  return coalesce(v_result,jsonb_build_object('key_stock',false,'sell_keys',false,'view_orders',false,'kick_customers',false));
end;
$$;

create or replace function public.sell_list_shop_customers()
returns table(user_id uuid,username text,email text,is_blocked boolean,created_at timestamptz)
language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'sell'
     or not exists(select 1 from public.seller_permissions p where p.user_id=auth.uid() and p.can_kick_customers is true) then
    raise exception 'Admin chưa cấp quyền kích khách khỏi Shop';
  end if;
  return query select c.user_id,c.username,c.email,c.is_blocked,c.created_at
  from public.shop_customer_access c order by c.created_at desc;
end;
$$;

create or replace function public.sell_set_shop_customer_blocked(p_user_id uuid,p_blocked boolean)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'sell'
     or not exists(select 1 from public.seller_permissions p where p.user_id=auth.uid() and p.can_kick_customers is true) then
    raise exception 'Admin chưa cấp quyền kích/mở khóa khách khỏi Shop';
  end if;
  update public.shop_customer_access set is_blocked=p_blocked,updated_at=now() where user_id=p_user_id;
  return found;
end;
$$;

create or replace function public.assert_shop_customer_active()
returns void language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập để sử dụng Shop'; end if;
  if exists(select 1 from public.shop_customer_access c where c.user_id=auth.uid() and c.is_blocked is true) then
    raise exception 'Tài khoản đã bị kích khỏi Shop. Vui lòng liên hệ Admin hoặc Seller để được mở khóa.';
  end if;
end;
$$;

create or replace function public.guard_blocked_shop_customer_write()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is not null and new.user_id=auth.uid()
     and exists(select 1 from public.shop_customer_access c where c.user_id=auth.uid() and c.is_blocked is true) then
    raise exception 'Tài khoản đã bị kích khỏi Shop. Không thể mua key hoặc sử dụng dịch vụ.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_blocked_store_orders on public.store_orders;
create trigger trg_guard_blocked_store_orders before insert on public.store_orders
for each row execute function public.guard_blocked_shop_customer_write();
drop trigger if exists trg_guard_blocked_shop_topups on public.shop_wallet_topups;
create trigger trg_guard_blocked_shop_topups before insert on public.shop_wallet_topups
for each row execute function public.guard_blocked_shop_customer_write();
drop trigger if exists trg_guard_blocked_shop_game_plays on public.shop_game_plays;
create trigger trg_guard_blocked_shop_game_plays before insert on public.shop_game_plays
for each row execute function public.guard_blocked_shop_customer_write();
drop trigger if exists trg_guard_blocked_shop_wallets on public.shop_customer_wallets;
create trigger trg_guard_blocked_shop_wallets before update on public.shop_customer_wallets
for each row execute function public.guard_blocked_shop_customer_write();

create or replace function public.shop_game_wallet_balance()
returns numeric language plpgsql security definer set search_path=''
as $$
declare v_balance numeric;
begin
  perform public.assert_shop_customer_active();
  insert into public.shop_customer_wallets(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select balance into v_balance from public.shop_customer_wallets where user_id=auth.uid();
  return v_balance;
end;
$$;

create or replace function public.shop_list_my_wallet_topups()
returns table(id bigint,amount numeric,note text,transfer_note text,status text,created_at timestamptz,expires_at timestamptz,admin_note text)
language plpgsql security definer set search_path=''
as $$
begin
  perform public.assert_shop_customer_active();
  return query select t.id::bigint,t.amount::numeric,t.note::text,t.transfer_note::text,t.status::text,
    t.created_at::timestamptz,t.expires_at::timestamptz,t.admin_note::text
  from public.shop_wallet_topups t where t.user_id=auth.uid() order by t.created_at desc limit 30;
end;
$$;

create or replace function public.get_my_store_orders()
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare result jsonb;
begin
  perform public.assert_shop_customer_active();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'total',o.total,'status',o.status,'transfer_note',o.transfer_note,'created_at',o.created_at,'paid_at',o.paid_at,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('product_name',i.product_name,'package_name',i.package_name,
      'quantity',i.quantity,'price',i.price,'keys',(select coalesce(jsonb_agg(k.key_value order by k.delivered_at),'[]'::jsonb)
      from public.product_keys k where k.store_order_id=o.id and k.product_id=i.product_id and k.package_id=i.package_id)
    )),'[]'::jsonb) from public.store_order_items i where i.order_id=o.id)
  ) order by o.created_at desc),'[]'::jsonb)
  into result from public.store_orders o where o.user_id=auth.uid();
  return result;
end;
$$;

create or replace function public.get_store_order(p_access_token_hash text)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare result jsonb;
begin
  select jsonb_build_object('id',o.id,'total',o.total,'status',o.status,'transfer_note',o.transfer_note,
    'created_at',o.created_at,'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',i.product_id,'product_name',i.product_name,'package_id',i.package_id,'package_name',i.package_name,
      'quantity',i.quantity,'price',i.price,'keys',(select coalesce(jsonb_agg(k.key_value order by k.delivered_at),'[]'::jsonb)
      from public.product_keys k where k.store_order_id=o.id and k.product_id=i.product_id and k.package_id=i.package_id)
    )),'[]'::jsonb) from public.store_order_items i where i.order_id=o.id)
  ) into result from public.store_orders o
  where o.access_token_hash=p_access_token_hash
    and not exists(select 1 from public.shop_customer_access c where c.user_id=o.user_id and c.is_blocked is true);
  return result;
end;
$$;

revoke all on function public.assert_shop_customer_active() from public,anon,authenticated;
revoke all on function public.guard_blocked_shop_customer_write() from public,anon,authenticated;
revoke all on function public.sell_list_shop_customers() from public,anon;
revoke all on function public.sell_set_shop_customer_blocked(uuid,boolean) from public,anon;
revoke all on function public.admin_list_seller_permissions() from public,anon;
revoke all on function public.admin_set_seller_permission(uuid,text,boolean) from public,anon;
revoke all on function public.sell_get_my_permissions() from public,anon;
revoke all on function public.shop_game_wallet_balance() from public,anon;
revoke all on function public.shop_list_my_wallet_topups() from public,anon;
revoke all on function public.get_my_store_orders() from public,anon;
revoke all on function public.admin_list_shop_customers() from public,anon;
revoke all on function public.admin_set_shop_customer_blocked(uuid,boolean) from public,anon;
grant execute on function public.sell_list_shop_customers() to authenticated;
grant execute on function public.sell_set_shop_customer_blocked(uuid,boolean) to authenticated;
grant execute on function public.admin_list_seller_permissions() to authenticated;
grant execute on function public.admin_set_seller_permission(uuid,text,boolean) to authenticated;
grant execute on function public.sell_get_my_permissions() to authenticated;
grant execute on function public.shop_game_wallet_balance() to authenticated;
grant execute on function public.shop_list_my_wallet_topups() to authenticated;
grant execute on function public.get_my_store_orders() to authenticated;
grant execute on function public.admin_list_shop_customers() to authenticated;
grant execute on function public.admin_set_shop_customer_blocked(uuid,boolean) to authenticated;

commit;
