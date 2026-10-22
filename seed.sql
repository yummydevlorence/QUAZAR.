-- Sample data for QuazarTech. Prices and stock are PLACEHOLDERS: change them.

INSERT INTO categories (name, slug) VALUES
  ('Audio',                 'audio'),
  ('Keyboards & Peripherals','keyboards-peripherals'),
  ('Smartphones',           'smartphones'),
  ('Laptops & Tablets',     'laptops-tablets'),
  ('Smart Home',            'smart-home'),
  ('Accessories',           'accessories');

-- Products made from the images you uploaded.
-- Image paths assume the files are moved into the images/ folder.
INSERT INTO products
  (category_id, name, slug, brand, description, price, stock, image, members_only, is_featured)
VALUES
  ((SELECT id FROM categories WHERE slug = 'audio'),
   'True Wireless Earbuds', 'true-wireless-earbuds', 'Noise',
   'Compact true wireless earbuds with a charging case.',
   1499.00, 25, 'images/earbus.png', 0, 1),

  ((SELECT id FROM categories WHERE slug = 'keyboards-peripherals'),
   'Wireless Mechanical Keyboard', 'wireless-mechanical-keyboard', NULL,
   'Compact mechanical keyboard with backlit keys and an aluminum frame.',
   3499.00, 15, 'images/keyboard.png', 0, 1),

  ((SELECT id FROM categories WHERE slug = 'audio'),
   'Portable Bluetooth Speaker', 'portable-bluetooth-speaker', 'Zealot',
   'Rugged portable Bluetooth speaker with FM radio.',
   1299.00, 30, 'images/speaker.png', 0, 1),

  ((SELECT id FROM categories WHERE slug = 'keyboards-peripherals'),
   'Wired Gaming Mouse', 'wired-gaming-mouse', NULL,
   'Ergonomic wired gaming mouse with adjustable DPI and LED side lighting.',
   899.00, 20, 'images/computermouse-removebg-preview.png', 0, 1);

-- Your promo banner: 20% off QUAZAR20 through Oct. 31
INSERT INTO promo_codes (code, discount_percent, expires_at) VALUES
  ('QUAZAR20', 20, '2026-10-31 23:59:59');
