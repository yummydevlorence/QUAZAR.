// db.js - upgrades quazar.db to the new schema (safe to run on every start)
const fs = require('fs');
const bcrypt = require('bcryptjs');

// The admin account is re-created on every start if missing, and its password
// is reset from these environment variables if it was changed.
const ADMIN = {
  username: process.env.QUAZAR_ADMIN_USERNAME || process.env.ADMIN_USERNAME,
  password: process.env.QUAZAR_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD,
  email: 'admin@quazar.local'
};

function migrate(db, dbFile) {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const ordersRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
  const needUsers = !userCols.includes('username');
  const needOrders = !(ordersRow && ordersRow.sql.includes("'approved'"));

  // Keep a copy of the old database before changing its structure.
  if ((needUsers || needOrders) && dbFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbFile, dbFile.replace(/\.db$/, '') + '.backup-' + stamp + '.db');
    console.log('Database backup created before upgrade.');
  }

  db.pragma('foreign_keys = OFF');
  const run = db.transaction(() => {
    if (needUsers) {
      db.exec(`
        CREATE TABLE users_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
          email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          phone         TEXT,
          role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
          is_verified   INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, username, email, password_hash, phone, role, is_verified, created_at)
        SELECT id,
               substr(email, 1, instr(email, '@') - 1) || '_' || id,
               email,
               COALESCE(password_hash, ''),
               phone,
               CASE role WHEN 'admin' THEN 'admin' ELSE 'user' END,
               1,
               created_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    }

    if (needOrders) {
      db.exec(`
        CREATE TABLE orders_new (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id          INTEGER NOT NULL REFERENCES users(id),
          promo_code_id    INTEGER REFERENCES promo_codes(id),
          status           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'declined')),
          subtotal         REAL NOT NULL CHECK (subtotal >= 0),
          discount_amount  REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
          total            REAL NOT NULL CHECK (total >= 0),
          payment_method   TEXT,
          shipping_name    TEXT NOT NULL,
          shipping_phone   TEXT NOT NULL,
          shipping_address TEXT NOT NULL,
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT
        );
        INSERT INTO orders_new (id, user_id, promo_code_id, status, subtotal, discount_amount, total,
                                payment_method, shipping_name, shipping_phone, shipping_address, created_at, updated_at)
        SELECT id, user_id, promo_code_id,
               CASE status WHEN 'pending' THEN 'pending' WHEN 'cancelled' THEN 'declined' ELSE 'approved' END,
               subtotal, discount_amount, total, payment_method,
               shipping_name, shipping_phone, shipping_address, created_at, created_at
        FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_new RENAME TO orders;
      `);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
      CREATE TABLE IF NOT EXISTS otp_codes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code       TEXT NOT NULL,               -- 6 digits, shown to the admin so they can text it
        attempts   INTEGER NOT NULL DEFAULT 0,  -- wrong guesses so far
        used       INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id);
    `);
  });
  run();

  const broken = db.pragma('foreign_key_check');
  if (broken.length) console.warn('Foreign key problems found after upgrade:', broken);
  db.pragma('foreign_keys = ON');

  seedAdmin(db);
}

function seedAdmin(db) {
  if (!ADMIN.username || Buffer.byteLength(ADMIN.password || '') < 8 || Buffer.byteLength(ADMIN.password || '') > 72) {
    throw new Error('Set QUAZAR_ADMIN_USERNAME and a QUAZAR_ADMIN_PASSWORD of 8-72 bytes in the environment.');
  }
  const hash = bcrypt.hashSync(ADMIN.password, 12);
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(ADMIN.username);
  if (!existing) {
    db.prepare(
      "INSERT INTO users (username, email, password_hash, role, is_verified) VALUES (?, ?, ?, 'admin', 1)"
    ).run(ADMIN.username, ADMIN.email, hash);
    console.log('Admin account created: ' + ADMIN.username);
  } else if (!bcrypt.compareSync(ADMIN.password, existing.password_hash)) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin', is_verified = 1 WHERE id = ?").run(hash, existing.id);
    console.log('Admin password reset to the permanent value.');
  } else {
    db.prepare("UPDATE users SET role = 'admin', is_verified = 1 WHERE id = ?").run(existing.id);
  }
}

module.exports = { migrate, ADMIN };
