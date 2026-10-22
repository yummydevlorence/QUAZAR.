// Copies the data from your old SQLite file into Supabase.
//
// Usage (from the project folder, after running supabase-schema.sql in Supabase):
//   node database/migrate-to-supabase.js                 -> uses back-end/quazar.db
//   node database/migrate-to-supabase.js path/to/file.db -> uses another file
//   add  --replace  to wipe the Supabase tables first (only if they already hold data)
//
// It never changes the SQLite file. It runs as ONE transaction: if anything fails,
// nothing is written to Supabase.
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node, nothing to install
const { pool } = require('../back-end/pg');

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'back-end', 'quazar.db'));

const ts = (v) => (v ? String(v).replace(' ', 'T') + 'Z' : null); // SQLite stores UTC
const bool = (v) => v === 1 || v === true;

// table -> [columns, converters]. Order matters (parents before children).
const TABLES = [
  ['categories', ['id', 'name', 'slug'], {}],
  ['users', ['id', 'username', 'email', 'password_hash', 'phone', 'role', 'is_verified', 'created_at'],
    { is_verified: bool, created_at: ts }],
  ['promo_codes', ['id', 'code', 'discount_percent', 'expires_at', 'is_active'], { expires_at: ts, is_active: bool }],
  ['products', ['id', 'category_id', 'name', 'slug', 'brand', 'description', 'price', 'stock', 'image', 'members_only', 'is_featured', 'is_active', 'created_at'],
    { members_only: bool, is_featured: bool, is_active: bool, created_at: ts }],
  ['cart_items', ['id', 'user_id', 'product_id', 'quantity', 'added_at'], { added_at: ts }],
  ['orders', ['id', 'user_id', 'promo_code_id', 'status', 'subtotal', 'discount_amount', 'total', 'payment_method',
    'shipping_name', 'shipping_phone', 'shipping_address', 'created_at', 'updated_at'], { created_at: ts, updated_at: ts }],
  ['order_items', ['id', 'order_id', 'product_id', 'quantity', 'unit_price'], {}],
  ['otp_codes', ['id', 'user_id', 'code', 'attempts', 'used', 'expires_at', 'created_at'],
    { used: bool, expires_at: ts, created_at: ts }],
  ['reviews', ['id', 'product_id', 'user_id', 'rating', 'comment', 'created_at'], { created_at: ts }],
  ['review_replies', ['id', 'review_id', 'user_id', 'comment', 'created_at'], { created_at: ts }]
];

async function main() {
  const lite = new DatabaseSync(file, { readOnly: true });
  console.log('Reading ' + file);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = (await client.query('SELECT (SELECT count(*) FROM users) AS u, (SELECT count(*) FROM products) AS p')).rows[0];
    if (Number(existing.u) + Number(existing.p) > 0) {
      if (!replace) {
        throw new Error(`Supabase already has data (${existing.u} users, ${existing.p} products). Re-run with --replace to wipe it first.`);
      }
      await client.query('TRUNCATE review_replies, reviews, otp_codes, order_items, orders, cart_items, products, promo_codes, users, categories RESTART IDENTITY CASCADE');
      console.log('Existing Supabase data wiped.');
    }

    for (const [table, cols, conv] of TABLES) {
      const hasTable = lite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!hasTable) { console.log(`  ${table}: not in SQLite file, skipped`); continue; }
      const have = lite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const use = cols.filter((c) => have.includes(c));
      const rows = lite.prepare(`SELECT ${use.join(', ')} FROM ${table} ORDER BY id`).all();
      const sql = `INSERT INTO ${table} (${use.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${use.map((_, i) => '$' + (i + 1)).join(', ')})`;
      for (const r of rows) await client.query(sql, use.map((c) => (conv[c] ? conv[c](r[c]) : r[c])));
      console.log(`  ${table}: ${rows.length} rows`);
    }

    // Identity counters must continue after the highest copied id.
    for (const [table] of TABLES) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`
      );
    }

    await client.query('COMMIT');
    console.log('Done. Your data is now in Supabase.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed, nothing was written: ' + e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    lite.close();
  }
}
main();
