-- HNShop: phần thưởng riêng và giá mỗi lượt cho Vòng quay / Túi mù
alter table public.shop_game_config
 add column if not exists wheel_prizes jsonb,
 add column if not exists blindbox_prizes jsonb,
 add column if not exists wheel_cost numeric(14,2) not null default 15000,
 add column if not exists blindbox_cost numeric(14,2) not null default 15000;

update public.shop_game_config
set wheel_prizes=coalesce(wheel_prizes,prizes),
    blindbox_prizes=coalesce(blindbox_prizes,prizes)
where id=true;

alter table public.shop_game_config
 alter column wheel_prizes set not null,
 alter column blindbox_prizes set not null;

create or replace function public.admin_get_shop_game_config()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception 'Chỉ Admin được xem cấu hình';
 end if;
 select jsonb_build_object(
  'prizes',prizes,'wheel_prizes',wheel_prizes,'blindbox_prizes',blindbox_prizes,
  'wheel_cost',wheel_cost,'blindbox_cost',blindbox_cost,
  'wheel_image_url',wheel_image_url,'blindbox_image_url',blindbox_image_url
 ) into v from public.shop_game_config where id=true;
 return v;
end; $$;

create or replace function public.admin_save_shop_game_config(p_config jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_wheel jsonb; v_blind jsonb; v_total numeric; v_count integer; v_distinct integer;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception 'Chỉ Admin được thay đổi cấu hình';
 end if;
 v_wheel:=coalesce(p_config->'wheel_prizes',p_config->'prizes');
 v_blind:=coalesce(p_config->'blindbox_prizes',p_config->'prizes');
 if jsonb_typeof(v_wheel)<>'array' or jsonb_typeof(v_blind)<>'array' then
  raise exception 'Danh sách phần thưởng không hợp lệ';
 end if;
 select coalesce(sum((x->>'weight')::numeric),0),count(*),count(distinct x->>'id')
 into v_total,v_count,v_distinct from jsonb_array_elements(v_wheel) x;
 if v_count<>6 or v_distinct<>6 or v_total<>10000 then raise exception 'Tỷ lệ Vòng quay phải đủ 6 phần thưởng và tổng đúng 100%'; end if;
 select coalesce(sum((x->>'weight')::numeric),0),count(*),count(distinct x->>'id')
 into v_total,v_count,v_distinct from jsonb_array_elements(v_blind) x;
 if v_count<>6 or v_distinct<>6 or v_total<>10000 then raise exception 'Tỷ lệ Túi mù phải đủ 6 phần thưởng và tổng đúng 100%'; end if;
 if exists(
  select 1 from (
   select x from jsonb_array_elements(v_wheel) x
   union all select x from jsonb_array_elements(v_blind) x
  ) q
  where coalesce(x->>'id','') not in ('key1','key3','key7','key30','wallet20','wallet50')
    or (x->>'weight') is null or (x->>'weight') !~ '^[0-9]+$'
    or (x->>'weight')::numeric<0 or (x->>'weight')::numeric>10000
 ) then raise exception 'Tỷ lệ phần thưởng không hợp lệ'; end if;
 if coalesce((p_config->>'wheel_cost')::numeric,0)<1
    or coalesce((p_config->>'blindbox_cost')::numeric,0)<1 then
  raise exception 'Giá mỗi lượt phải lớn hơn 0';
 end if;
 insert into public.shop_game_config(id,prizes,wheel_prizes,blindbox_prizes,wheel_cost,blindbox_cost,wheel_image_url,blindbox_image_url,updated_at)
 values(true,v_wheel,v_wheel,v_blind,(p_config->>'wheel_cost')::numeric,(p_config->>'blindbox_cost')::numeric,
  coalesce(p_config->>'wheel_image_url',''),coalesce(p_config->>'blindbox_image_url',''),now())
 on conflict(id) do update set prizes=excluded.prizes,wheel_prizes=excluded.wheel_prizes,
  blindbox_prizes=excluded.blindbox_prizes,wheel_cost=excluded.wheel_cost,blindbox_cost=excluded.blindbox_cost,
  wheel_image_url=excluded.wheel_image_url,blindbox_image_url=excluded.blindbox_image_url,updated_at=now();
 return true;
end; $$;

create or replace function public.shop_get_game_config()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'prizes',prizes,'wheel_prizes',wheel_prizes,'blindbox_prizes',blindbox_prizes,
  'wheel_cost',wheel_cost,'blindbox_cost',blindbox_cost,
  'wheel_image_url',wheel_image_url,'blindbox_image_url',blindbox_image_url
 ) from public.shop_game_config where id=true;
$$;

create or replace function public.shop_play_game(p_game_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid(); v_cost numeric; v_balance numeric; v_roll integer;
 v_prize_type text; v_label text; v_value numeric:=0; v_days integer;
 v_product_id bigint; v_package_id uuid; v_key_id uuid; v_key text; v_play_id bigint;
 v_prize jsonb; v_total integer; v_cursor integer:=0; v_cfg jsonb; v_prizes jsonb;
begin
 if v_uid is null then raise exception 'Vui lòng đăng nhập để tham gia'; end if;
 if p_game_type not in ('wheel','blindbox') then raise exception 'Trò chơi không hợp lệ'; end if;
 if exists(select 1 from public.shop_customer_access where user_id=v_uid and is_blocked is true) then
  raise exception 'Tài khoản đã bị khóa quyền truy cập Shop';
 end if;
 select case when p_game_type='wheel' then wheel_cost else blindbox_cost end,
        case when p_game_type='wheel' then wheel_prizes else blindbox_prizes end
 into v_cost,v_prizes from public.shop_game_config where id=true;
 if v_cost is null or v_prizes is null then raise exception 'Chưa cấu hình trò chơi'; end if;
 select coalesce(sum((x->>'weight')::integer),0) into v_total from jsonb_array_elements(v_prizes) x;
 if v_total<>10000 then raise exception 'Cấu hình tỷ lệ phần thưởng không hợp lệ'; end if;
 insert into public.shop_customer_wallets(user_id) values(v_uid) on conflict(user_id) do nothing;
 select balance into v_balance from public.shop_customer_wallets where user_id=v_uid for update;
 if v_balance<v_cost then raise exception 'Ví không đủ số dư. Mỗi lượt cần % đ; ví hiện có % đ',v_cost,v_balance; end if;
 v_roll=floor(random()*v_total)::integer;
 for v_prize in select value from jsonb_array_elements(v_prizes) loop
  v_cursor:=v_cursor+(v_prize->>'weight')::integer;
  if v_roll<v_cursor then exit; end if;
 end loop;
 v_prize_type:=v_prize->>'type'; v_label:=v_prize->>'label';
 v_value:=coalesce((v_prize->>'value')::numeric,0); v_days:=coalesce((v_prize->>'days')::integer,0);
 if v_prize_type='key' then
  select id into v_product_id from public.products
  where lower(name) like '%key chấp tố menu tím%' and is_active is true order by created_at desc limit 1;
  if v_product_id is null then raise exception 'Không tìm thấy sản phẩm Key Chấp Tố Menu Tím'; end if;
  select id into v_package_id from public.product_packages
  where product_id=v_product_id and is_active is true
   and name ~* ('(^|[^0-9])'||v_days::text||'[[:space:]]*(ngày|day|days|d)([^a-z]|$)')
  order by sort_order limit 1;
  if v_package_id is null then raise exception 'Chưa có gói Key % ngày cho sản phẩm Key Chấp Tố Menu Tím',v_days; end if;
  select id,key_value into v_key_id,v_key from public.product_keys
  where product_id=v_product_id and package_id=v_package_id and status='available'
  order by created_at,id for update skip locked limit 1;
  if v_key_id is null then raise exception 'Kho Key % ngày hiện đã hết',v_days; end if;
  update public.product_keys set status='delivered',delivered_at=now() where id=v_key_id;
 elsif v_prize_type<>'wallet' then
  raise exception 'Loại phần thưởng không hợp lệ';
 end if;
 update public.shop_customer_wallets
 set balance=balance-v_cost+case when v_prize_type='wallet' then v_value else 0 end,updated_at=now()
 where user_id=v_uid returning balance into v_balance;
 insert into public.shop_game_plays(user_id,game_type,cost,prize_type,prize_label,prize_value,key_value)
 values(v_uid,p_game_type,v_cost,v_prize_type,v_label,
  case when v_prize_type='wallet' then v_value else null end,v_key) returning id into v_play_id;
 insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason,reference_id)
 values(v_uid,-v_cost,v_balance-case when v_prize_type='wallet' then v_value else 0 end,
  'Phí tham gia '||case when p_game_type='wheel' then 'Vòng quay' else 'Túi mù' end,v_play_id);
 if v_prize_type='wallet' and v_value>0 then
  insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason,reference_id)
  values(v_uid,v_value,v_balance,v_label,v_play_id);
 end if;
 return jsonb_build_object('play_id',v_play_id,'game_type',p_game_type,'prize_type',v_prize_type,
  'prize_label',v_label,'prize_value',v_value,'key_value',v_key,'balance',v_balance,'cost',v_cost);
end; $$;

revoke all on function public.admin_get_shop_game_config() from public;
revoke all on function public.admin_save_shop_game_config(jsonb) from public;
revoke all on function public.shop_get_game_config() from public;
revoke all on function public.shop_play_game(text) from public;
grant execute on function public.admin_get_shop_game_config() to authenticated;
grant execute on function public.admin_save_shop_game_config(jsonb) to authenticated;
grant execute on function public.shop_get_game_config() to anon,authenticated;
grant execute on function public.shop_play_game(text) to authenticated;
