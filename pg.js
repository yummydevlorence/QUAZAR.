// pg.js - the single connection to your Supabase (Postgres) database.
// Reads DATABASE_URL from back-end/.env (or from the real environment).
const path = require('path');
const { Pool, types } = require('pg');

// Load back-end/.env (simple KEY=value lines; works on any Node version).
try {
  for (const line of require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {
  /* no .env file: rely on real environment variables */
}

// Return numbers as JavaScript numbers (the website expects numbers, not strings).
types.setTypeParser(20, (v) => parseInt(v, 10));      // bigint (COUNT, SUM)
types.setTypeParser(1700, (v) => parseFloat(v));      // numeric (prices)
types.setTypeParser(1082, (v) => v);                  // date (YYYY-MM-DD)

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing. Put your Supabase connection string in back-end/.env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  max: 10
});
pool.on('error', (e) => console.error('Database connection error:', e.message));

// query(sql, params) -> array of rows
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
// one(sql, params) -> first row or undefined
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

// tx(async (q) => { ... }) runs everything in one transaction.
// Inside, use q.query(...) / q.one(...) just like above. Any throw rolls back.
async function tx(fn) {
  const client = await pool.connect();
  const q = {
    query: async (sql, params = []) => (await client.query(sql, params)).rows,
    one: async (sql, params = []) => (await client.query(sql, params)).rows[0],
    run: (sql, params = []) => client.query(sql, params)   // full result (rowCount etc.)
  };
  try {
    await client.query('BEGIN');
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, tx };
