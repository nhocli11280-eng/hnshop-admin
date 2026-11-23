-- Read-only dashboard summary for Sell accounts.
-- Run this file in Supabase SQL Editor once.

CREATE OR REPLACE FUNCTION public.sell_get_admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF COALESCE(auth.jwt()->'app_metadata'->>'role', '') NOT IN ('sell', 'admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập';
  END IF;

  SELECT jsonb_build_object(
    'total_products', (SELECT COUNT(*) FROM public.products),
    'active_products', (SELECT COUNT(*) FROM public.products WHERE is_active IS DISTINCT FROM false),
    'total_categories', (SELECT COUNT(*) FROM public.categories),
    'total_orders',
      (SELECT COUNT(*) FROM public.orders) +
      (SELECT COUNT(*) FROM public.store_orders),
    'pending_orders',
      (SELECT COUNT(*) FROM public.orders
       WHERE LOWER(COALESCE(status, '')) IN ('pending', 'unpaid', 'processing')) +
      (SELECT COUNT(*) FROM public.store_orders
       WHERE LOWER(COALESCE(status, '')) IN ('pending', 'unpaid', 'processing')),
    'total_revenue',
      (SELECT COALESCE(SUM(total), 0) FROM public.orders) +
      (SELECT COALESCE(SUM(total), 0) FROM public.store_orders
       WHERE LOWER(COALESCE(status, '')) = 'fulfilled'),
    'total_customers', (SELECT COUNT(*) FROM public.shop_customer_access),
    'available_keys', (SELECT COUNT(*) FROM public.product_keys WHERE status = 'available'),
    'delivered_keys', (SELECT COUNT(*) FROM public.product_keys WHERE status = 'delivered'),
    'shop_orders', (SELECT COUNT(*) FROM public.store_orders),
    'recent_orders', (
      SELECT COALESCE(jsonb_agg(to_jsonb(recent_row) ORDER BY recent_row.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM (
          SELECT
            'Đơn thường'::text AS source,
            o.id::text AS id,
            COALESCE(c.name, '—')::text AS customer_name,
            o.total,
            o.status,
            o.created_at
          FROM public.orders o
          LEFT JOIN public.customers c ON c.id = o.customer_id
          UNION ALL
          SELECT
            'Shop'::text AS source,
            so.id::text AS id,
            COALESCE(so.customer_name, 'Khách mua key')::text AS customer_name,
            so.total,
            so.status,
            so.created_at
          FROM public.store_orders so
        ) combined
        ORDER BY created_at DESC
        LIMIT 10
      ) recent_row
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_get_admin_dashboard_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_get_admin_dashboard_summary() TO authenticated;
