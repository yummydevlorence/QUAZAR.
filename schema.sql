-- QuazarTech database schema (SQLite)
-- Run order: schema.sql first, then seed.sql

PRAGMA foreign_keys = ON;

-- Drop in reverse dependency order so this file can be re-run safely
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS promo_codes;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- ---------------------------------------------------------------
-- USERS: for the Login / Sign up modal
-- Never store a plain password. Store a hash (bcrypt) in password_hash.
-- facebook_id is for the "Continue with Facebook" button.
-- ---------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                       -- NULL if the user only uses Facebook
  facebook_id   TEXT UNIQUE,
  full_name     TEXT,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (password_hash IS NOT NULL OR facebook_id IS NOT NULL)
);

-- ---------------------------------------------------------------
-- CATEGORIES: Audio, Keyboards, Laptops, etc.
-- ---------------------------------------------------------------
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE                 -- url-friendly name, e.g. "audio"
);

-- ---------------------------------------------------------------
-- PRODUCTS
-- image holds the PATH used in your HTML, e.g. "images/earbus.png"
-- members_only = 1 matches your .members-only CSS class (hidden until login)
-- price is in pesos
-- ---------------------------------------------------------------
CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  brand        TEXT,
  description  TEXT,
  price        REAL NOT NULL CHECK (price >= 0),
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image        TEXT,
  members_only INTEGER NOT NULL DEFAULT 0 CHECK (members_only IN (0, 1)),
  is_featured  INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_products_category ON products(category_id);

-- ---------------------------------------------------------------
-- PROMO CODES: your "20% off QUAZAR20 through Oct. 31" banner
-- ---------------------------------------------------------------
CREATE TABLE promo_codes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  expires_at       TEXT,                    -- NULL = never expires
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------
-- CART: one row per product in a user's cart
-- ---------------------------------------------------------------
CREATE TABLE cart_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, product_id)              -- adding the same product again should update quantity
);

-- ---------------------------------------------------------------
-- ORDERS: created at checkout
-- Shipping details are copied here so old orders stay correct
-- even if the user changes their profile later.
-- ---------------------------------------------------------------
CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  promo_code_id    INTEGER REFERENCES promo_codes(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  subtotal         REAL NOT NULL CHECK (subtotal >= 0),
  discount_amount  REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total            REAL NOT NULL CHECK (total >= 0),
  payment_method   TEXT,                    -- e.g. 'cod', 'gcash', 'card'
  shipping_name    TEXT NOT NULL,
  shipping_phone   TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_user ON orders(user_id);

-- ---------------------------------------------------------------
-- ORDER ITEMS: what was in each order
-- unit_price is saved at purchase time, so later price changes
-- don't rewrite past orders.
-- ---------------------------------------------------------------
CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
