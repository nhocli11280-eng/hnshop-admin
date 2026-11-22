-- Admin-only cancellation for unpaid/pending Shop orders.
-- Run this SQL in Supabase SQL Editor after deploying the website.

CREATE OR REPLACE FUNCTION public.admin_cancel_store_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF COALESCE(auth.jwt()->'app_metadata'->>'role','') <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin được hủy đơn hàng';
  END IF;

  SELECT status INTO v_status
  FROM public.store_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng';
  END IF;

  IF LOWER(COALESCE(v_status,'')) <> 'pending' THEN
    RAISE EXCEPTION 'Chỉ được hủy đơn đang chờ thanh toán';
  END IF;

  UPDATE public.store_orders
  SET status = 'cancelled'
  WHERE id = p_order_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_store_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_store_order(uuid) TO authenticated;
