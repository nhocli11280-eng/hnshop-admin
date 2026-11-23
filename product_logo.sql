-- HNShop: thêm logo riêng cho từng sản phẩm
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS logo_url text;
