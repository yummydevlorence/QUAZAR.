// ============================================================
// Account Settings API  (TEMPLATE, adapt to back-end/server.js)
//
// I only had the front-end files, so this file is written against these
// ASSUMPTIONS. Rename them to match your real server.js:
//   - `pool`        : your pg Pool (from DATABASE_URL)
//   - `requireAuth` : your JWT middleware; it must set req.user = { id, ... }
//   - `bcrypt`      : bcryptjs, already in package.json
//   - users table has: id, username, email, phone, password_hash, role
//   - your existing /api/me returns { user: { id, username, email, phone, role } }
//
// How to use: copy these routes into server.js (after your auth middleware
// and express.json()), or mount this file as a router.
// Run the SQL below once in the Supabase SQL editor first.
// ============================================================
/*
create table if not exists addresses (
  id          bigserial primary key,
  user_id     bigint not null references users(id) on delete cascade,
  label       text not null default 'Home',
  name        text not null,
  phone       text not null,
  address     text not null,          -- full one-line address, built by the server
  region      text not null default '',
  province    text not null default '',   -- empty for Metro Manila
  city        text not null default '',
  barangay    text not null default '',
  postal_code text not null default '',
  street      text not null default '',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
-- If you already created the table from the earlier version, run this instead:
-- alter table addresses
--   add column if not exists region text not null default '',
--   add column if not exists province text not null default '',
--   add column if not exists city text not null default '',
--   add column if not exists barangay text not null default '',
--   add column if not exists postal_code text not null default '',
--   add column if not exists street text not null default '';
create index if not exists addresses_user_idx on addresses(user_id);

create table if not exists user_preferences (
  user_id        bigint primary key references users(id) on delete cascade,
  order_updates  boolean not null default true,
  promos         boolean not null default true,
  price_drops    boolean not null default false,
  back_in_stock  boolean not null default false,
  trending       boolean not null default false
);
*/

import express from 'express';
import bcrypt from 'bcryptjs';
// import { pool, requireAuth } from './your-existing-modules.js';

export function accountSettingsRouter(pool, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, phone: u.phone, role: u.role });
  const PHONE = /^(\+?63|0)9\d{9}$/;
  const fail = (res, status, error) => res.status(status).json({ error });
  const commonPasswords = new Set([
    'password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123',
    'iloveyou', 'admin123', 'letmein123', 'welcome123', 'quazar123'
  ]);
  const passwordProblem = (password, { username = '', email = '' } = {}) => {
    if (password.length < 10) return 'Password must be at least 10 characters.';
    if (Buffer.byteLength(password) > 72) return 'Password is too long (72 characters max).';
    if (!/[a-z]/.test(password)) return 'Password needs a lowercase letter.';
    if (!/[A-Z]/.test(password)) return 'Password needs an uppercase letter.';
    if (!/\d/.test(password)) return 'Password needs a number.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password needs a symbol (for example ! @ # $).';
    const low = password.toLowerCase();
    if (commonPasswords.has(low) || /^(.)\1+$/.test(password)) return 'That password is too common. Choose another.';
    const local = email.split('@')[0].toLowerCase();
    if ((username && low.includes(username.toLowerCase())) || (local.length >= 3 && low.includes(local))) {
      return 'Password must not contain your username or email name.';
    }
    return null;
  };

  // ---- profile ----
  router.patch('/me', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const phone = String(req.body.phone || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail(res, 400, 'Username must be 3-20 letters, numbers or underscores.');
    if (phone && !PHONE.test(phone.replace(/[\s-]/g, ''))) return fail(res, 400, 'Enter a valid mobile number.');
    try {
      const { rows } = await pool.query(
        'update users set username = $1, phone = $2 where id = $3 returning *',
        [username, phone || null, req.user.id]
      );
      res.json({ user: publicUser(rows[0]) });
    } catch (e) {
      if (e.code === '23505') return fail(res, 409, 'That username or mobile number is already taken.');
      console.error(e); fail(res, 500, 'Could not update your profile.');
    }
  });

  // ---- password ----
  router.post('/me/password', async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (typeof new_password !== 'string') return fail(res, 400, 'Enter a valid new password.');
    const pwProblem = passwordProblem(new_password, { username: req.user.username, email: req.user.email });
    if (pwProblem) return fail(res, 400, pwProblem);
    const { rows } = await pool.query('select password_hash from users where id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(current_password || ''), rows[0].password_hash))) {
      return fail(res, 400, 'Current password is incorrect.');
    }
    await pool.query('update users set password_hash = $1 where id = $2', [await bcrypt.hash(new_password, 12), req.user.id]);
    res.json({ message: 'Password updated.' });
  });

  // ---- delete account ----
  router.delete('/me', async (req, res) => {
    if (req.user.role === 'admin') return fail(res, 403, 'Administrator accounts cannot be deleted here.');
    const { rows } = await pool.query('select password_hash from users where id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(req.body?.password || ''), rows[0].password_hash))) {
      return fail(res, 400, 'Password is incorrect.');
    }
    // If orders.user_id has a foreign key to users, make it ON DELETE SET NULL
    // so order history is kept, or delete/anonymise orders here instead.
    await pool.query('delete from users where id = $1', [req.user.id]);
    res.json({ message: 'Account deleted.' });
  });

  // ---- addresses ----
  const readAddress = (body) => {
    const a = {
      label: ['Home', 'Work', 'Other'].includes(body.label) ? body.label : 'Home',
      name: String(body.name || '').trim(),
      phone: String(body.phone || '').trim(),
      region: String(body.region || '').trim().slice(0, 80),
      province: String(body.province || '').trim().slice(0, 80),
      city: String(body.city || '').trim().slice(0, 80),
      barangay: String(body.barangay || '').trim().slice(0, 80),
      postal_code: String(body.postal_code || '').trim(),
      street: String(body.street || '').trim().slice(0, 150),
      is_default: Boolean(body.is_default)
    };
    if (a.name.length < 2 || a.name.length > 80) return { error: 'Enter the receiver name.' };
    if (!PHONE.test(a.phone.replace(/[\s-]/g, ''))) return { error: 'Enter a valid mobile number.' };
    if (!a.region || !a.city || !a.barangay) return { error: 'Select your region, city and barangay.' };
    if (!/^\d{4}$/.test(a.postal_code)) return { error: 'Enter a 4-digit postal code.' };
    if (a.street.length < 3) return { error: 'Enter your street name, building and house number.' };
    // The one-line address is always built here, never trusted from the browser.
    a.address = `${[a.street, a.barangay, a.city, a.province, a.region, a.postal_code].filter(Boolean).join(', ')}, Philippines`;
    return { a };
  };

  router.get('/addresses', async (req, res) => {
    const { rows } = await pool.query(
      `select id, label, name, phone, address, region, province, city, barangay, postal_code, street, is_default
       from addresses where user_id = $1 order by is_default desc, id`,
      [req.user.id]
    );
    res.json(rows);
  });

  router.post('/addresses', async (req, res) => {
    const { a, error } = readAddress(req.body || {});
    if (error) return fail(res, 400, error);
    const count = (await pool.query('select count(*)::int n from addresses where user_id = $1', [req.user.id])).rows[0].n;
    if (count >= 10) return fail(res, 400, 'You can save up to 10 addresses.');
    const makeDefault = a.is_default || count === 0;
    if (makeDefault) await pool.query('update addresses set is_default = false where user_id = $1', [req.user.id]);
    const { rows } = await pool.query(
      `insert into addresses (user_id, label, name, phone, address, region, province, city, barangay, postal_code, street, is_default)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [req.user.id, a.label, a.name, a.phone, a.address, a.region, a.province, a.city, a.barangay, a.postal_code, a.street, makeDefault]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/addresses/:id', async (req, res) => {
    const { a, error } = readAddress(req.body || {});
    if (error) return fail(res, 400, error);
    if (a.is_default) await pool.query('update addresses set is_default = false where user_id = $1', [req.user.id]);
    const { rows } = await pool.query(
      `update addresses set label=$1, name=$2, phone=$3, address=$4, region=$5, province=$6, city=$7,
         barangay=$8, postal_code=$9, street=$10, is_default = is_default or $11
       where id=$12 and user_id=$13 returning *`,
      [a.label, a.name, a.phone, a.address, a.region, a.province, a.city, a.barangay, a.postal_code, a.street, a.is_default, req.params.id, req.user.id]
    );
    if (!rows[0]) return fail(res, 404, 'Address not found.');
    res.json(rows[0]);
  });

  router.post('/addresses/:id/default', async (req, res) => {
    const owned = await pool.query('select 1 from addresses where id=$1 and user_id=$2', [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, 'Address not found.');
    await pool.query('update addresses set is_default = (id = $1) where user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  router.delete('/addresses/:id', async (req, res) => {
    const { rows } = await pool.query('delete from addresses where id=$1 and user_id=$2 returning is_default', [req.params.id, req.user.id]);
    if (!rows[0]) return fail(res, 404, 'Address not found.');
    if (rows[0].is_default) {
      await pool.query(
        'update addresses set is_default = true where id = (select id from addresses where user_id=$1 order by id limit 1)',
        [req.user.id]
      );
    }
    res.json({ ok: true });
  });

  // ---- notification preferences ----
  const PREF_KEYS = ['order_updates', 'promos', 'price_drops', 'back_in_stock', 'trending'];

  router.get('/me/preferences', async (req, res) => {
    await pool.query('insert into user_preferences (user_id) values ($1) on conflict do nothing', [req.user.id]);
    const { rows } = await pool.query('select * from user_preferences where user_id = $1', [req.user.id]);
    const out = {};
    PREF_KEYS.forEach((k) => { out[k] = rows[0][k]; });
    res.json(out);
  });

  router.patch('/me/preferences', async (req, res) => {
    const changes = PREF_KEYS.filter((k) => typeof req.body?.[k] === 'boolean');
    if (!changes.length) return fail(res, 400, 'No valid preference supplied.');
    await pool.query('insert into user_preferences (user_id) values ($1) on conflict do nothing', [req.user.id]);
    // column names come from the fixed PREF_KEYS whitelist above, never from user input
    const sets = changes.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`update user_preferences set ${sets} where user_id = $1`, [req.user.id, ...changes.map((k) => req.body[k])]);
    res.json({ ok: true });
  });

  return router;
}

// In server.js:  app.use('/api', accountSettingsRouter(pool, requireAuth));
// NOTE: if your server.js already defines GET /api/me, keep it. Express matches
// routes by method, so the new PATCH/DELETE /api/me do not conflict with it.