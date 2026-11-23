-- Ví nạp tiền cho Vòng quay & Túi mù: khách gửi yêu cầu, Admin xác nhận mới cộng tiền.
create table if not exists public.shop_wallet_topups (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 amount numeric(14,2) not null check(amount >= 10000 and amount <= 10000000),
 note text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id),
 admin_note text
);
create index if not exists shop_wallet_topups_user_created_idx
 on public.shop_wallet_topups(user_id,created_at desc);
create index if not exists shop_wallet_topups_status_created_idx
 on public.shop_wallet_topups(status,created_at desc);
alter table public.shop_wallet_topups enable row level security;
drop policy if exists shop_wallet_topups_read_own on public.shop_wallet_topups;
create policy shop_wallet_topups_read_own on public.shop_wallet_topups
 for select to authenticated using(user_id=auth.uid());

create or replace function public.shop_request_wallet_topup(p_amount numeric,p_note text default '')
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_id bigint;
begin
 if auth.uid() is null then raise exception 'Vui lòng đăng nhập'; end if;
 if p_amount is null or p_amount < 10000 or p_amount > 10000000 or p_amount <> round(p_amount) then
  raise exception 'Số tiền nạp từ 10.000 đến 10.000.000 đồng, không có số lẻ';
 end if;
 if exists(select 1 from public.shop_customer_access where user_id=auth.uid() and is_blocked is true) then
  raise exception 'Tài khoản đã bị khóa quyền truy cập Shop';
 end if;
 insert into public.shop_wallet_topups(user_id,amount,note)
 values(auth.uid(),p_amount,left(coalesce(p_note,''),200)) returning id into v_id;
 return v_id;
end; $$;

create or replace function public.shop_list_my_wallet_topups()
returns table(id bigint,amount numeric,note text,status text,created_at timestamptz,admin_note text)
language sql security definer set search_path=''
as $$
 select t.id,t.amount,t.note,t.status,t.created_at,t.admin_note
 from public.shop_wallet_topups t
 where t.user_id=auth.uid()
 order by t.created_at desc limit 30;
$$;

create or replace function public.admin_list_shop_wallet_topups()
returns table(id bigint,user_id uuid,username text,email text,amount numeric,note text,status text,created_at timestamptz,admin_note text)
language plpgsql security definer set search_path=''
as $$
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
  raise exception 'Chỉ Admin được xem yêu cầu nạp ví';
 end if;
 return query
 select t.id,t.user_id,
  coalesce(nullif(u.raw_user_meta_data->>'username',''),u.email,'Khách hàng'),
  u.email,t.amount,t.note,t.status,t.created_at,t.admin_note
 from public.shop_wallet_topups t
 join auth.users u on u.id=t.user_id
 order by case when t.status='pending' then 0 else 1 end,t.created_at desc
 limit 300;
end; $$;

create or replace function public.admin_review_shop_wallet_topup(p_topup_id bigint,p_approve boolean,p_admin_note text default '')
returns numeric language plpgsql security definer set search_path=''
as $$
declare v_topup public.shop_wallet_topups%rowtype; v_balance numeric;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
  raise exception 'Chỉ Admin được xác nhận nạp ví';
 end if;
 select * into v_topup from public.shop_wallet_topups where id=p_topup_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu nạp ví'; end if;
 if v_topup.status <> 'pending' then raise exception 'Yêu cầu này đã được xử lý'; end if;
 if p_approve is true then
  insert into public.shop_customer_wallets(user_id) values(v_topup.user_id) on conflict(user_id) do nothing;
  update public.shop_customer_wallets set balance=balance+v_topup.amount,updated_at=now()
   where user_id=v_topup.user_id returning balance into v_balance;
  insert into public.shop_customer_wallet_transactions(user_id,amount,balance_after,reason,reference_id)
   values(v_topup.user_id,v_topup.amount,v_balance,'Admin xác nhận nạp ví #'||v_topup.id,v_topup.id);
  update public.shop_wallet_topups set status='approved',reviewed_at=now(),reviewed_by=auth.uid(),
   admin_note=left(coalesce(p_admin_note,''),200) where id=p_topup_id;
  return v_balance;
 else
  update public.shop_wallet_topups set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),
   admin_note=left(coalesce(p_admin_note,''),200) where id=p_topup_id;
  return null;
 end if;
end; $$;

revoke all on function public.shop_request_wallet_topup(numeric,text) from public;
revoke all on function public.shop_list_my_wallet_topups() from public;
revoke all on function public.admin_list_shop_wallet_topups() from public;
revoke all on function public.admin_review_shop_wallet_topup(bigint,boolean,text) from public;
grant execute on function public.shop_request_wallet_topup(numeric,text) to authenticated;
grant execute on function public.shop_list_my_wallet_topups() to authenticated;
grant execute on function public.admin_list_shop_wallet_topups() to authenticated;
grant execute on function public.admin_review_shop_wallet_topup(bigint,boolean,text) to authenticated;
