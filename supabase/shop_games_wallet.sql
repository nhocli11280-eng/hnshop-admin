-- HNShop Vòng quay & Túi mù: ví khách hàng, lượt chơi và cấp key an toàn
-- Chạy toàn bộ file này trong Supabase SQL Editor trước khi sử dụng.
create table if not exists public.shop_customer_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 balance numeric(14,2) not null default 0 check(balance>=0), updated_at timestamptz not null default now()
);
create table if not exists public.shop_customer_wallet_transactions (
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,
 amount numeric(14,2) not null,balance_after numeric(14,2) not null,reason text not null,reference_id bigint,created_at timestamptz not null default now()
);
create table if not exists public.shop_game_plays (
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,
 game_type text not null check(game_type in ('wheel','blindbox')),cost numeric(14,2) not null,
 prize_type text not null check(prize_type in ('key','wallet')),prize_label text not null,prize_value numeric(14,2),key_value text,created_at timestamptz not null default now()
);
alter table public.shop_customer_wallets enable row level security;
alter table public.shop_customer_wallet_transactions enable row level security;
alter table public.shop_game_plays enable row level security;
drop policy if exists shop_wallet_read_own on public.shop_customer_wallets;
create policy shop_wallet_read_own on public.shop_customer_wallets for select to authenticated using(user_id=auth.uid());
drop policy if exists shop_wallet_transactions_read_own on public.shop_customer_wallet_transactions;
create policy shop_wallet_transactions_read_own on public.shop_customer_wallet_transactions for select to authenticated using(user_id=auth.uid());
drop policy if exists shop_game_plays_read_own on public.shop_game_plays;
create policy shop_game_plays_read_own on public.shop_game_plays for select to authenticated using(user_id=auth.uid());

create or replace function public.shop_game_wallet_balance() returns numeric
language plpgsql security definer set search_path=''
as $$ declare v_balance numeric; begin
 if auth.uid() is null then raise exception 'Vui lòng đăng nhập'; end if;
 insert into public.shop_customer_wallets(user_id) values(auth.uid()) on conflict(user_id) do nothing;
 select balance into v_balance from public.shop_customer_wallets where user_id=auth.uid(); return v_balance;
end; $$;

create or replace function public.admin_shop_wallet_adjust(p_user_id uuid,p_amount numeric,p_reason text default 'Admin điều chỉnh số dư')
returns numeric language plpgsql security definer set search_path=''
as $$ declare v_balance numeric; begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Chỉ Admin được điều chỉnh ví'; end if;
 if p_user_id is null or p_amount is null or p_amount=0 then raise exception 'Số tiền không hợp lệ'; end if;
 insert into public.shop_customer_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
 update public.shop_customer_wallets set balance=balance+p_amount,updated_at=now()
 where user_id=p_user_id and balance+p_amount>=0 returning balance into v_balance;
 if not found then raise exception 'Số dư không đủ để trừ'; end if;
 insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason)
 values(p_user_id,p_amount,v_balance,coalesce(nullif(trim(p_reason),''),'Admin điều chỉnh số dư'));
 return v_balance;
end; $$;

create or replace function public.shop_play_game(p_game_type text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid(); v_cost numeric:=15000; v_balance numeric; v_roll integer;
 v_prize_type text; v_label text; v_value numeric:=0; v_days integer;
 v_product_id bigint; v_package_id uuid; v_key_id uuid; v_key text; v_play_id bigint;
begin
 if v_uid is null then raise exception 'Vui lòng đăng nhập để tham gia'; end if;
 if p_game_type not in ('wheel','blindbox') then raise exception 'Trò chơi không hợp lệ'; end if;
 if exists(select 1 from public.shop_customer_access where user_id=v_uid and is_blocked is true) then raise exception 'Tài khoản đã bị khóa quyền truy cập Shop'; end if;
 insert into public.shop_customer_wallets(user_id) values(v_uid) on conflict(user_id) do nothing;
 select balance into v_balance from public.shop_customer_wallets where user_id=v_uid for update;
 if v_balance<v_cost then raise exception 'Ví không đủ số dư. Mỗi lượt chơi cần % đ; ví hiện có % đ',v_cost,v_balance; end if;
 v_roll=floor(random()*10000)::integer;
 if v_roll<8400 then v_prize_type:='key';v_days:=1;v_label:='Key 1 ngày';
 elsif v_roll<9000 then v_prize_type:='key';v_days:=3;v_label:='Key 3 ngày';
 elsif v_roll<9300 then v_prize_type:='key';v_days:=7;v_label:='Key 7 ngày';
 elsif v_roll<9400 then v_prize_type:='key';v_days:=30;v_label:='Key 30 ngày';
 elsif v_roll<9800 then v_prize_type:='wallet';v_value:=20000;v_label:='Tiền ví 20.000 đ';
 else v_prize_type:='wallet';v_value:=50000;v_label:='Tiền ví 50.000 đ'; end if;
 if v_prize_type='key' then
  select id into v_product_id from public.products where lower(name) like '%key chấp tố menu tím%' and is_active is true order by created_at desc limit 1;
  if v_product_id is null then raise exception 'Không tìm thấy sản phẩm Key Chấp Tố Menu Tím'; end if;
  select id into v_package_id from public.product_packages where product_id=v_product_id and is_active is true
   and name ~* ('(^|[^0-9])'||v_days::text||'[[:space:]]*(ngày|day|days|d)([^a-z]|$)') order by sort_order limit 1;
  if v_package_id is null then raise exception 'Chưa có gói Key % ngày cho sản phẩm Key Chấp Tố Menu Tím',v_days; end if;
  select id,key_value into v_key_id,v_key from public.product_keys where product_id=v_product_id and package_id=v_package_id and status='available'
   order by created_at,id for update skip locked limit 1;
  if v_key_id is null then raise exception 'Kho Key % ngày hiện đã hết',v_days; end if;
  update public.product_keys set status='delivered',delivered_at=now() where id=v_key_id;
 end if;
 update public.shop_customer_wallets set balance=balance-v_cost+case when v_prize_type='wallet' then v_value else 0 end,updated_at=now()
 where user_id=v_uid returning balance into v_balance;
 insert into public.shop_game_plays(user_id,game_type,cost,prize_type,prize_label,prize_value,key_value)
 values(v_uid,p_game_type,v_cost,v_prize_type,v_label,case when v_prize_type='wallet' then v_value else null end,v_key) returning id into v_play_id;
 insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason,reference_id)
 values(v_uid,-v_cost,v_balance,'Phí tham gia '||case when p_game_type='wheel' then 'Vòng quay' else 'Túi mù' end,v_play_id);
 if v_prize_type='wallet' then
  insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason,reference_id) values(v_uid,v_value,v_balance,v_label,v_play_id);
 end if;
 return jsonb_build_object('play_id',v_play_id,'game_type',p_game_type,'prize_type',v_prize_type,'prize_label',v_label,'prize_value',v_value,'key_value',v_key,'balance',v_balance,'cost',v_cost);
end; $$;
revoke all on function public.shop_game_wallet_balance() from public;
revoke all on function public.admin_shop_wallet_adjust(uuid,numeric,text) from public;
revoke all on function public.shop_play_game(text) from public;
grant execute on function public.shop_game_wallet_balance() to authenticated;
grant execute on function public.admin_shop_wallet_adjust(uuid,numeric,text) to authenticated;
grant execute on function public.shop_play_game(text) to authenticated;
