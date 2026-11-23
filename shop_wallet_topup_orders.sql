-- Nâng cấp đơn nạp ví: mã chuyển khoản tự động + hạn hiển thị 10 phút.
-- Đơn vẫn ở trạng thái pending sau 10 phút để Admin có thể kiểm tra giao dịch thực tế.
alter table public.shop_wallet_topups
 add column if not exists transfer_note text,
 add column if not exists expires_at timestamptz;

update public.shop_wallet_topups
set transfer_note=coalesce(nullif(transfer_note,''),'HNSHOPNAP'||lpad(id::text,8,'0')),
    expires_at=coalesce(expires_at,created_at+interval '10 minutes')
where transfer_note is null or expires_at is null;

alter table public.shop_wallet_topups
 alter column transfer_note set not null,
 alter column expires_at set not null;

drop function if exists public.shop_list_my_wallet_topups();
create function public.shop_list_my_wallet_topups()
returns table(
 id bigint,amount numeric,note text,transfer_note text,status text,
 created_at timestamptz,expires_at timestamptz,admin_note text
)
language sql security definer set search_path=''
as $$
 select t.id::bigint,t.amount::numeric,t.note::text,t.transfer_note::text,t.status::text,t.created_at::timestamptz,t.expires_at::timestamptz,t.admin_note::text
 from public.shop_wallet_topups t
 where t.user_id=auth.uid()
 order by t.created_at desc limit 30;
$$;

create or replace function public.shop_request_wallet_topup(p_amount numeric,p_note text default '')
returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_id bigint; v_created timestamptz;
begin
 if auth.uid() is null then raise exception 'Vui lòng đăng nhập'; end if;
 if p_amount is null or p_amount < 10000 or p_amount > 10000000 or p_amount <> round(p_amount) then
  raise exception 'Số tiền nạp từ 10.000 đến 10.000.000 đồng, không có số lẻ';
 end if;
 if exists(select 1 from public.shop_customer_access where user_id=auth.uid() and is_blocked is true) then
  raise exception 'Tài khoản đã bị khóa quyền truy cập Shop';
 end if;
 insert into public.shop_wallet_topups(user_id,amount,note,transfer_note,expires_at)
 values(auth.uid(),p_amount,left(coalesce(p_note,''),200),'PENDING',now()+interval '10 minutes')
 returning id,created_at into v_id,v_created;
 update public.shop_wallet_topups
 set transfer_note='HNSHOPNAP'||lpad(v_id::text,8,'0'),
     expires_at=v_created+interval '10 minutes'
 where id=v_id;
 return v_id;
end; $$;

drop function if exists public.admin_list_shop_wallet_topups();
create function public.admin_list_shop_wallet_topups()
returns table(
 id bigint,user_id uuid,username text,email text,amount numeric,note text,
 status text,created_at timestamptz,admin_note text,transfer_note text,expires_at timestamptz
)
language plpgsql security definer set search_path=''
as $$
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
  raise exception 'Chỉ Admin được xem yêu cầu nạp ví';
 end if;
 return query
 select t.id,t.user_id,
  coalesce(nullif(u.raw_user_meta_data->>'username',''),u.email::text,'Khách hàng')::text,
  u.email::text,t.amount::numeric,t.note::text,t.status::text,t.created_at::timestamptz,t.admin_note::text,t.transfer_note::text,t.expires_at::timestamptz
 from public.shop_wallet_topups t
 join auth.users u on u.id=t.user_id
 order by case when t.status='pending' then 0 else 1 end,t.created_at desc
 limit 300;
end; $$;

revoke all on function public.shop_list_my_wallet_topups() from public;
revoke all on function public.shop_request_wallet_topup(numeric,text) from public;
revoke all on function public.admin_list_shop_wallet_topups() from public;
grant execute on function public.shop_list_my_wallet_topups() to authenticated;
grant execute on function public.shop_request_wallet_topup(numeric,text) to authenticated;
grant execute on function public.admin_list_shop_wallet_topups() to authenticated;

-- Bật Realtime để trang Quản lý đơn hàng Admin nhận đơn nạp mới ngay.
do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='shop_wallet_topups'
    )
 then
  execute 'alter publication supabase_realtime add table public.shop_wallet_topups';
 end if;
end $$;
