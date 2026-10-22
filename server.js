const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ZIPS = require('./ph-zips.json');
const { query, one, tx } = require('./pg');
const { init } = require('./db');
const { sendOtpEmail, emailFailureMessage } = require('./email');

const app = express();
const PORT = process.env.PORT || 8000;
const riderRouter = express.Router();

// ---------- login secret ----------
// Uses JWT_SECRET if you set one; otherwise creates a random secret once and
// keeps it in .jwt_secret so logins survive restarts. Never share that file.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(__dirname, '.jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = loadSecret();

app.set('trust proxy', 1); // behind the Cloudflare tunnel, so req.ip is the real visitor
// Lets the pages work when opened from VS Code Live Server (e.g. http://localhost:5501)
// while this server runs on port 8000. Only localhost origins are allowed.
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Product photo upload (admin only). Registered before the small global JSON limit
// because images are sent as base64 and need more room.
const IMAGE_TYPES = [
  { ext: 'png', ok: (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { ext: 'jpg', ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', ok: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
];
app.post('/api/admin/upload', auth, adminOnly, express.json({ limit: '8mb' }), (req, res) => {
  const raw = String((req.body || {}).data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'Choose an image under 5 MB.');
  const kind = IMAGE_TYPES.find((t) => t.ok(buf));
  if (!kind) throw new HttpError(400, 'Only PNG, JPG or WebP images are allowed.');
  const base = text((req.body || {}).name, 60).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  const file = `${base}-${crypto.randomBytes(4).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(SITE, 'images', file), buf);
  res.status(201).json({ image: 'images/' + file });
});

app.use('/api/rider', express.json({ limit: '8mb' }), riderRouter);
app.use(express.json({ limit: '50kb' }));

// ---------- serve the website ----------
// The website files live one folder up from back-end/
const SITE = path.join(__dirname, '..');
app.get('/', (req, res) => res.sendFile(path.join(SITE, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(SITE, 'style.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(SITE, 'script.js')));
app.use('/images', express.static(path.join(SITE, 'images')));
app.get('/login', (req, res) => res.redirect(302, '/#account'));
app.get('/admin', (req, res) => res.sendFile(path.join(SITE, 'admin.html')));
app.get('/admin.css', (req, res) => res.sendFile(path.join(SITE, 'admin.css')));
app.get('/admin.js', (req, res) => res.sendFile(path.join(SITE, 'admin.js')));
app.get('/rider', (req, res) => res.sendFile(path.join(SITE, 'rider.html')));
app.get('/rider.css', (req, res) => res.sendFile(path.join(SITE, 'rider.css')));
app.get('/rider.js', (req, res) => res.sendFile(path.join(SITE, 'rider.js')));

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const GMAIL = /^[a-z0-9._%+-]+@gmail\.com$/i;
const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;
const PHONE = /^09\d{9}$/;
const cleanPhone = (v) => {
  const raw = String(v || '').replace(/[^\d+]/g, '');
  if (!raw) return '';
  if (/^\+?63\d{10}$/.test(raw)) return `0${raw.replace(/^\+?63/, '')}`;
  if (/^63\d{10}$/.test(raw)) return `0${raw.slice(2)}`;
  if (/^0\d{10}$/.test(raw)) return raw;
  if (/^\d{10}$/.test(raw)) return `0${raw}`;
  return raw;
};
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123',
  'iloveyou', 'admin123', 'letmein123', 'welcome123', 'quazar123'
]);
function passwordProblem(pw, { username = '', email = '' } = {}) {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (72 characters max).';
  if (!/[a-z]/.test(pw)) return 'Password needs a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password needs an uppercase letter.';
  if (!/\d/.test(pw)) return 'Password needs a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a symbol (for example ! @ # $).';
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(low) || /^(.)\1+$/.test(pw)) return 'That password is too common. Choose another.';
  const local = email.split('@')[0].toLowerCase();
  if ((username && low.includes(username.toLowerCase())) || (local.length >= 3 && low.includes(local))) {
    return 'Password must not contain your username or email name.';
  }
  return null;
}
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normPlace = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(city of|municipality of|city|metropolitan|metro)\b/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]{0,49}$/u;
const NAME_SUFFIX = /^[\p{L}\p{N}.]{1,10}$/u;
const cleanName = (value) => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

function readName(body) {
  const first = cleanName(body.first_name);
  const middle = cleanName(body.middle_name);
  const last = cleanName(body.last_name);
  const suffix = cleanName(body.suffix);
  if (!first) throw new HttpError(400, 'First name is required.', { field: 'first_name' });
  if (!last) throw new HttpError(400, 'Last name is required.', { field: 'last_name' });
  for (const [label, field, value] of [
    ['First name', 'first_name', first],
    ['Middle name', 'middle_name', middle],
    ['Last name', 'last_name', last]
  ]) {
    if (value && !NAME_PART.test(value)) {
      throw new HttpError(400, `${label} may only contain letters, spaces, hyphens, apostrophes and periods.`, { field });
    }
  }
  if (suffix && !NAME_SUFFIX.test(suffix)) {
    throw new HttpError(400, 'Suffix is not valid (for example Jr., Sr., III).', { field: 'suffix' });
  }
  return {
    first,
    middle: middle || null,
    last,
    suffix: suffix || null,
    full: [first, middle, last, suffix].filter(Boolean).join(' ')
  };
}

function zipMatchesAddress(code, address) {
  const names = ZIPS[code];
  if (!names) return false;
  const hay = ` ${normPlace(address)} `;
  return names.some((name) => {
    const place = normPlace(name);
    return place.length >= 3 && hay.includes(` ${place} `);
  });
}

function estimateDelivery(address, from = new Date()) {
  const place = ` ${normPlace(address)} `;
  const hasPlace = (...names) => names.some((name) => place.includes(` ${normPlace(name)} `));
  let days;
  if (hasPlace('Metro Manila', 'National Capital Region', 'NCR')) {
    days = 3;
  } else if (hasPlace(
    'Cordillera Administrative Region', 'CAR', 'Ilocos Region', 'Region I', 'Cagayan Valley', 'Region II',
    'Central Luzon', 'Region III', 'CALABARZON', 'Region IV-A', 'MIMAROPA', 'Region IV-B', 'Bicol Region', 'Region V'
  )) {
    days = 5;
  } else if (hasPlace(
    'Western Visayas', 'Region VI', 'Negros Island Region', 'Central Visayas', 'Region VII',
    'Eastern Visayas', 'Region VIII', 'Visayas', 'Zamboanga Peninsula', 'Region IX',
    'Northern Mindanao', 'Region X', 'Davao Region', 'Region XI', 'SOCCSKSARGEN', 'Region XII',
    'Caraga', 'Region XIII', 'Bangsamoro', 'BARMM', 'Mindanao'
  )) {
    days = 8;
  } else {
    return null;
  }

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(from);
  const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(dateValues.year), Number(dateValues.month) - 1, Number(dateValues.day)));
  for (let remaining = days; remaining > 0;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

function rateLimit(windowMs, max) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip);
    if (!rec || rec.reset < now) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++rec.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

const publicUser = (u) => ({
  id: u.id, username: u.username, email: u.email, phone: u.phone, role: u.role,
  full_name: u.full_name || null,
  first_name: u.first_name || null, middle_name: u.middle_name || null,
  last_name: u.last_name || null, suffix: u.suffix || null,
  rider_status: u.rider_status || null
});
const makeToken = (user) => jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

async function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Always re-read the user so role changes / deletions take effect immediately.
    const user = await one(
      `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_verified, u.full_name,
              u.first_name, u.middle_name, u.last_name, u.suffix, r.rider_status
       FROM users u LEFT JOIN riders r ON r.user_id = u.id
       WHERE u.id = $1`,
      [payload.id]
    );
    return user && user.is_verified ? user : null;
  } catch {
    return null;
  }
}

async function optionalAuth(req, res, next) {
  req.user = await userFromRequest(req);
  next();
}
async function auth(req, res, next) {
  req.user = await userFromRequest(req);
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(400, 'Invalid id.');
  return n;
};

// ---------- OTP ----------
// `q` is either the shared helpers or a transaction's helpers.
async function issueOtp(userId, q = { query, one }) {
  await q.query('UPDATE otp_codes SET used = true WHERE user_id = $1 AND used = false', [userId]);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await q.query("INSERT INTO otp_codes (user_id, code, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [userId, code]);
  return code;
}

async function emailOtp(userId, email, code) {
  try {
    await sendOtpEmail(email, code);
  } catch (error) {
    console.error('OTP email delivery failed:', {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
      message: error.message
    });
    // The code is NOT cancelled on failure, so it can still be verified (e.g. copied from the admin table).
    const detail = [error.code, error.responseCode, error.message].filter(Boolean).join(' | ');
    throw new HttpError(503, emailFailureMessage(error) + ' [' + detail + ']');
  }
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- auth routes ----------
const signupLimit = rateLimit(60 * 60 * 1000, 10);
const loginLimit = rateLimit(10 * 60 * 1000, 20);
const otpLimit = rateLimit(10 * 60 * 1000, 15);
const resendLimit = rateLimit(10 * 60 * 1000, 6);

app.post('/api/signup', signupLimit, async (req, res) => {
  const body = req.body || {};
  const username = text(body.username, 20);
  const email = text(body.email, 120).toLowerCase();
  const phone = cleanPhone(body.phone);
  const password = typeof body.password === 'string' ? body.password : '';
  const applyRider = body.apply_rider === true;
  let vehicle = null;
  let plate = null;

  if (!USERNAME.test(username)) throw new HttpError(400, 'Username must be 3-20 letters, numbers or underscores.');
  const nm = readName(body);
  if (!GMAIL.test(email)) throw new HttpError(400, 'Please sign up with a Gmail address (name@gmail.com).');
  if (!PHONE.test(phone)) throw new HttpError(400, 'Please enter a valid mobile number, e.g. 09171234567.');
  const pwProblem = passwordProblem(password, { username, email });
  if (pwProblem) throw new HttpError(400, pwProblem);
  if (applyRider) {
    vehicle = typeof body.vehicle_type === 'string' ? body.vehicle_type : '';
    plate = text(body.plate_number, 12).toUpperCase();
    if (!['motorcycle', 'bicycle', 'car', 'van'].includes(vehicle)) throw new HttpError(400, 'Choose a valid vehicle.');
    if (vehicle !== 'bicycle' && !/^[A-Z0-9 -]{4,12}$/.test(plate)) throw new HttpError(400, 'Enter a valid plate number.');
    if (vehicle === 'bicycle') plate = null;
  }

  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [email])) {
    throw new HttpError(409, 'That Gmail is already registered. Try logging in.');
  }
  if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
    throw new HttpError(409, 'That username is taken.');
  }

  const hash = bcrypt.hashSync(password, 12);
  let account;
  try {
    account = await tx(async (q) => {
      const r = await q.one(
        `INSERT INTO users (username, email, password_hash, phone, role, is_verified,
                            first_name, middle_name, last_name, suffix, full_name)
         VALUES ($1, $2, $3, $4, 'user', false, $5, $6, $7, $8, $9)
         RETURNING id`,
        [username, email, hash, phone, nm.first, nm.middle, nm.last, nm.suffix, nm.full]
      );
      if (applyRider) {
        await q.query(
          `INSERT INTO riders (user_id, vehicle_type, plate_number, rider_status, rider_applied_at)
           VALUES ($1, $2, $3, 'pending', now())`,
          [r.id, vehicle, plate]
        );
      }
      return { id: r.id, code: await issueOtp(r.id, q) };
    });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That username or Gmail is already registered.');
    throw e;
  }

  try {
    await emailOtp(account.id, email, account.code);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(
        error.status,
        `Account created, but the verification email was not sent: ${error.message} You can request a new code after fixing the issue.`,
        { needs_otp: true, email }
      );
    }
    throw error;
  }
  res.status(201).json({ needs_otp: true, email, message: 'A 6-digit verification code was emailed to you.' });
});

app.post('/api/verify-otp', otpLimit, async (req, res) => {
  const email = text((req.body || {}).email, 120).toLowerCase();
  const code = text((req.body || {}).code, 10);
  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  if (!user) throw new HttpError(400, 'Wrong or expired code.');
  if (user.is_verified) throw new HttpError(400, 'This account is already verified. Please log in.');

  const otp = await one(
    'SELECT * FROM otp_codes WHERE user_id = $1 AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1',
    [user.id]
  );
  if (!otp) throw new HttpError(400, 'That code has expired. Tap "Request a new code".');

  if (otp.attempts >= 5) {
    await query('UPDATE otp_codes SET used = true WHERE id = $1', [otp.id]);
    throw new HttpError(400, 'Too many wrong attempts. Tap "Request a new code".');
  }
  if (!sameText(otp.code, code)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw new HttpError(400, 'Wrong code. Please check your email.');
  }

  await tx(async (q) => {
    await q.query('UPDATE otp_codes SET used = true WHERE id = $1', [otp.id]);
    await q.query('UPDATE users SET is_verified = true WHERE id = $1', [user.id]);
  });

  const verifiedUser = await one(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_verified, u.full_name,
            u.first_name, u.middle_name, u.last_name, u.suffix, r.rider_status
     FROM users u LEFT JOIN riders r ON r.user_id = u.id WHERE u.id = $1`,
    [user.id]
  );
  res.json({ token: makeToken(verifiedUser), user: publicUser(verifiedUser) });
});

app.post('/api/resend-otp', resendLimit, async (req, res) => {
  const email = text((req.body || {}).email, 120).toLowerCase();
  const user = await one('SELECT id, is_verified FROM users WHERE lower(email) = $1', [email]);
  if (user && !user.is_verified) {
    const recent = await one(
      "SELECT 1 FROM otp_codes WHERE user_id = $1 AND used = false AND created_at > now() - interval '60 seconds'",
      [user.id]
    );
    if (recent) throw new HttpError(429, 'A code was requested a moment ago. Please wait a minute.');
    const code = await issueOtp(user.id);
    await emailOtp(user.id, email, code);
  }
  // Same answer whether or not the account exists.
  res.json({ ok: true, message: 'If your account is awaiting verification, a new code was emailed to you.' });
});

app.post('/api/login', loginLimit, async (req, res) => {
  const body = req.body || {};
  const identifier = text(body.identifier || body.email, 120);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) throw new HttpError(400, 'Enter your Gmail, username, or mobile number and password.');

  const phoneIdentifier = cleanPhone(identifier);
  const user = PHONE.test(phoneIdentifier)
    ? await one('SELECT * FROM users WHERE phone = $1', [phoneIdentifier])
    : await one('SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)', [identifier]);
  // Same message for "no such user" and "wrong password" so attackers can't tell which accounts exist.
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    throw new HttpError(401, 'Wrong Gmail, username, mobile number, or password.');
  }
  if (!user.is_verified) {
    return res.status(403).json({
      error: 'Please enter the 6-digit code we emailed to you.',
      needs_otp: true,
      email: user.email
    });
  }
  const sessionUser = await one(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_verified, u.full_name,
            u.first_name, u.middle_name, u.last_name, u.suffix, r.rider_status
     FROM users u LEFT JOIN riders r ON r.user_id = u.id WHERE u.id = $1`,
    [user.id]
  );
  res.json({ token: makeToken(sessionUser), user: publicUser(sessionUser) });
});

app.get('/api/login', (req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Use POST to sign in.' });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/me/name', auth, async (req, res) => {
  const nm = readName(req.body || {});
  await query(
    'UPDATE users SET first_name = $1, middle_name = $2, last_name = $3, suffix = $4, full_name = $5 WHERE id = $6',
    [nm.first, nm.middle, nm.last, nm.suffix, nm.full, req.user.id]
  );
  res.json({
    user: {
      ...publicUser(req.user),
      first_name: nm.first,
      middle_name: nm.middle,
      last_name: nm.last,
      suffix: nm.suffix,
      full_name: nm.full
    }
  });
});

app.get('/api/zip/:code', (req, res) => {
  const names = ZIPS[req.params.code];
  if (!names) return res.json({ valid: false });
  const wanted = [req.query.city, req.query.province].map(normPlace).filter(Boolean);
  const matches = !wanted.length || wanted.some((name) => names.some((place) => place.includes(name) || name.includes(place)));
  res.json({ valid: true, matches });
});

app.post('/api/me/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string') throw new HttpError(400, 'Enter a valid new password.');
  const pwProblem = passwordProblem(new_password, { username: req.user.username, email: req.user.email });
  if (pwProblem) throw new HttpError(400, pwProblem);

  const user = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!user || !bcrypt.compareSync(String(current_password || ''), user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(new_password, 12), req.user.id]);
  res.json({ message: 'Password updated.' });
});

// ---------- products ----------
// Guests get the public catalog; members-only products require an account.
app.get('/api/products', optionalAuth, async (req, res) => {
  const where = req.user ? 'p.is_active' : 'p.is_active AND NOT p.members_only';
  const rows = await query(
    `SELECT p.id, p.name, p.slug, p.brand, p.description, p.price, p.stock,
            p.image, p.members_only, p.is_featured, c.name AS category, c.slug AS category_slug,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = p.id AND o.status != 'declined'), 0)::int AS sold,
            COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id), 0) AS avg_rating,
            (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS review_count,
            ((SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.comment IS NOT NULL)
             + (SELECT COUNT(*) FROM review_replies rr JOIN reviews r2 ON r2.id = rr.review_id WHERE r2.product_id = p.id)) AS comment_count
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE ${where}
     ORDER BY p.is_featured DESC, p.id`
  );
  res.json(rows);
});

// ---------- ratings & comments ----------
const reviewLimit = rateLimit(10 * 60 * 1000, 30);

app.get('/api/products/:id/reviews', optionalAuth, async (req, res) => {
  const id = intParam(req.params.id);
  const stats = await one(
    `SELECT COUNT(*) AS count, COUNT(comment) + (
       SELECT COUNT(*) FROM review_replies rr JOIN reviews r2 ON r2.id = rr.review_id WHERE r2.product_id = $1
     ) AS comment_count, COALESCE(ROUND(AVG(rating), 1), 0) AS average
     FROM reviews WHERE product_id = $1`,
    [id]
  );
  const rows = await query(
    `SELECT r.id, r.user_id, r.rating, r.comment, r.created_at, u.username
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 ORDER BY r.id DESC LIMIT 100`,
    [id]
  );
  const replyRows = await query(
    `SELECT rr.id, rr.review_id, rr.user_id, rr.comment, rr.created_at, u.username, u.role
     FROM review_replies rr
     JOIN reviews r ON r.id = rr.review_id
     JOIN users u ON u.id = rr.user_id
     WHERE r.product_id = $1 ORDER BY rr.id`,
    [id]
  );
  const userId = req.user ? req.user.id : null;
  res.json({
    average: stats.average,
    count: stats.count,
    comment_count: stats.comment_count,
    reviews: rows.map((r) => ({
      id: r.id, username: r.username, rating: r.rating, comment: r.comment, created_at: r.created_at,
      mine: userId === r.user_id,
      replies: replyRows
        .filter((reply) => reply.review_id === r.id)
        .map((reply) => ({
          id: reply.id, username: reply.username, is_admin: reply.role === 'admin',
          comment: reply.comment, created_at: reply.created_at, mine: userId === reply.user_id
        }))
    }))
  });
});

// One review per customer per product; posting again updates their own review.
app.post('/api/products/:id/reviews', auth, reviewLimit, async (req, res) => {
  const product = await activeProduct(intParam(req.params.id));
  const rating = Number((req.body || {}).rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Please choose a rating from 1 to 5 stars.');
  const comment = text((req.body || {}).comment, 500) || null;
  await query(
    `INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = now()`,
    [product.id, req.user.id, rating, comment]
  );
  res.status(201).json({ ok: true });
});

// Customers can delete their own review; admins can delete any. Replies cascade with it.
app.delete('/api/reviews/:id', auth, async (req, res) => {
  const id = intParam(req.params.id);
  const row = await one('SELECT user_id FROM reviews WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, 'Review not found.');
  if (row.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'You can only delete your own review.');
  await query('DELETE FROM reviews WHERE id = $1', [id]);
  res.json({ ok: true });
});

app.post('/api/reviews/:id/replies', auth, reviewLimit, async (req, res) => {
  const reviewId = intParam(req.params.id);
  if (!(await one('SELECT 1 FROM reviews WHERE id = $1', [reviewId]))) throw new HttpError(404, 'Review not found.');
  const comment = text((req.body || {}).comment, 500);
  if (!comment) throw new HttpError(400, 'Please write a reply.');
  await query('INSERT INTO review_replies (review_id, user_id, comment) VALUES ($1, $2, $3)', [reviewId, req.user.id, comment]);
  res.status(201).json({ ok: true });
});

app.delete('/api/replies/:id', auth, async (req, res) => {
  const id = intParam(req.params.id);
  const row = await one('SELECT user_id FROM review_replies WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, 'Reply not found.');
  if (row.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'You can only delete your own reply.');
  await query('DELETE FROM review_replies WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ---------- cart ----------
async function getCart(userId) {
  const items = await query(
    `SELECT c.product_id, c.quantity, p.name, p.price, p.image, p.stock
     FROM cart_items c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = $1 AND p.is_active
     ORDER BY c.id`,
    [userId]
  );
  const subtotal = round2(items.reduce((sum, i) => sum + i.price * i.quantity, 0));
  return { items, subtotal };
}

async function activeProduct(id) {
  const p = await one('SELECT id, name, stock FROM products WHERE id = $1 AND is_active', [id]);
  if (!p) throw new HttpError(404, 'Product not found.');
  return p;
}

const qtyOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new HttpError(400, 'Quantity must be between 1 and 99.');
  return n;
};

app.get('/api/cart', auth, async (req, res) => res.json(await getCart(req.user.id)));

app.post('/api/cart', auth, async (req, res) => {
  const product = await activeProduct(intParam((req.body || {}).product_id));
  const add = qtyOf((req.body || {}).quantity ?? 1);
  if (product.stock < 1) throw new HttpError(409, product.name + ' is out of stock.');

  const row = await one('SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, product.id]);
  const quantity = Math.min((row ? row.quantity : 0) + add, product.stock);
  await query(
    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = excluded.quantity`,
    [req.user.id, product.id, quantity]
  );
  res.json(await getCart(req.user.id));
});

app.patch('/api/cart/:productId', auth, async (req, res) => {
  const product = await activeProduct(intParam(req.params.productId));
  const quantity = Math.min(qtyOf((req.body || {}).quantity), Math.max(product.stock, 1));
  await query('UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND product_id = $3', [quantity, req.user.id, product.id]);
  res.json(await getCart(req.user.id));
});

app.delete('/api/cart/:productId', auth, async (req, res) => {
  await query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, intParam(req.params.productId)]);
  res.json(await getCart(req.user.id));
});

// ---------- promo + orders ----------
async function findPromo(code) {
  if (!code) return null;
  const promo = await one(
    `SELECT id, code, discount_percent FROM promo_codes
     WHERE lower(code) = lower($1) AND is_active
       AND (expires_at IS NULL OR expires_at > now())`,
    [code]
  );
  if (!promo) throw new HttpError(400, 'That promo code is invalid or has expired.');
  return promo;
}

app.post('/api/promo', auth, async (req, res) => {
  const promo = await findPromo(text((req.body || {}).code, 40));
  if (!promo) throw new HttpError(400, 'Enter a promo code.');
  res.json({ code: promo.code, discount_percent: promo.discount_percent });
});

function createOrder(userId, info, promo) {
  return tx(async (q) => {
    const items = await q.query(
      `SELECT c.product_id, c.quantity, p.name, p.price, p.stock
       FROM cart_items c JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1 AND p.is_active`,
      [userId]
    );
    if (!items.length) throw new HttpError(400, 'Your cart is empty.');

    let subtotal = 0;
    for (const it of items) {
      if (it.quantity > it.stock) {
        throw new HttpError(409, it.stock > 0 ? `Only ${it.stock} left of ${it.name}.` : `${it.name} is out of stock.`);
      }
      subtotal += it.price * it.quantity;
    }
    subtotal = round2(subtotal);
    const discount = promo ? round2((subtotal * promo.discount_percent) / 100) : 0;
    const total = round2(subtotal - discount);

    const { id: orderId } = await q.one(
      `INSERT INTO orders (user_id, promo_code_id, status, subtotal, discount_amount, total,
                           payment_method, shipping_name, shipping_phone, shipping_address, estimated_delivery, updated_at)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING id`,
      [userId, promo ? promo.id : null, subtotal, discount, total, info.payment_method, info.name, info.phone,
        info.address, estimateDelivery(info.address)]
    );

    for (const it of items) {
      await q.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [orderId, it.product_id, it.quantity, it.price]);
      // The "stock >= quantity" guard makes two buyers racing for the last item safe.
      const r = await q.run('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1', [it.quantity, it.product_id]);
      if (r.rowCount !== 1) throw new HttpError(409, `${it.name} just ran out of stock.`);
    }
    await q.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
    return orderId;
  });
}

async function loadOrders(whereSql, params) {
  const orders = await query(
    `SELECT o.id, o.status, o.subtotal, o.discount_amount, o.total, o.payment_method, o.estimated_delivery,
            o.shipping_name, o.shipping_phone, o.shipping_address, o.created_at, o.updated_at,
            o.payment_status, o.shipped_at, o.delivered_at, o.paid_at,
            o.assigned_at, o.failed_at, o.failure_reason, o.proof_image, o.rider_id,
            COALESCE(ru.full_name, ru.username, o.rider_name) AS rider_name, ru.phone AS rider_phone,
            COALESCE(u.full_name, u.username) AS customer_name, u.username, u.email
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN users ru ON ru.id = o.rider_id
     ${whereSql}
     ORDER BY o.id DESC`,
    params
  );
  if (!orders.length) return orders;
  const items = await query(
    `SELECT oi.order_id, oi.product_id, oi.quantity, oi.unit_price, p.name
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ANY($1::int[]) ORDER BY oi.id`,
    [orders.map((o) => o.id)]
  );
  for (const o of orders) {
    o.items = items
      .filter((i) => i.order_id === o.id)
      .map(({ product_id, quantity, unit_price, name }) => ({ product_id, quantity, unit_price, name }));
  }
  return orders;
}

app.post('/api/orders', auth, async (req, res) => {
  const b = req.body || {};
  const info = {
    name: text(b.shipping_name, 80),
    phone: cleanPhone(b.shipping_phone),
    address: text(b.shipping_address, 300),
    postal: text(b.shipping_postal, 20),
    payment_method: ['cod', 'gcash'].includes(b.payment_method) ? b.payment_method : null
  };
  if (info.name.length < 2) throw new HttpError(400, 'Please enter the receiver name.');
  if (!PHONE.test(info.phone)) throw new HttpError(400, 'Please enter a valid contact number.');
  if (info.address.length < 8) throw new HttpError(400, 'Please enter the full delivery address.');
  if (!/^\d{4}$/.test(info.postal)) throw new HttpError(400, 'Postal code must be exactly 4 digits.');
  if (!ZIPS[info.postal]) throw new HttpError(400, 'That postal code does not exist in our Philippine postal code list.');
  if (!zipMatchesAddress(info.postal, info.address)) {
    throw new HttpError(400, 'That postal code does not match the city or province in your address. Please check it.');
  }
  if (!info.payment_method) throw new HttpError(400, 'Choose a payment method.');

  const promo = await findPromo(text(b.promo_code, 40));
  const orderId = await createOrder(req.user.id, info, promo);
  res.status(201).json({ order: (await loadOrders('WHERE o.id = $1', [orderId]))[0] });
});

app.get('/api/orders', auth, async (req, res) => res.json(await loadOrders('WHERE o.user_id = $1', [req.user.id])));

// ---------- admin ----------
app.get('/api/admin/orders', auth, adminOnly, async (req, res) => res.json(await loadOrders('', [])));

app.get('/api/admin/riders', auth, adminOnly, async (req, res) => res.json(await query(
  `SELECT u.id, u.username, COALESCE(u.full_name, u.username) AS full_name, u.email, u.phone,
          r.vehicle_type, r.plate_number, r.rider_status, r.rider_applied_at,
          (SELECT COUNT(*) FROM orders o WHERE o.rider_id = u.id AND o.status IN ('approved', 'shipped'))::int AS active_jobs
   FROM riders r JOIN users u ON u.id = r.user_id
   ORDER BY r.rider_applied_at DESC`
)));

const RIDER_ACTIONS = {
  approve: { riderStatus: 'approved', userRole: 'rider', condition: "r.rider_status IS NOT NULL AND u.role <> 'admin'" },
  reject: { riderStatus: 'rejected', userRole: 'user', condition: "r.rider_status IS NOT NULL AND u.role <> 'admin'" },
  revoke: { riderStatus: 'rejected', userRole: 'user', condition: "u.role = 'rider'" }
};

app.post('/api/admin/riders/:id/:action', auth, adminOnly, async (req, res) => {
  const action = RIDER_ACTIONS[req.params.action];
  if (!action) throw new HttpError(400, 'Unknown rider action.');
  const id = intParam(req.params.id);
  await tx(async (q) => {
    const rider = await q.one(
      `SELECT r.user_id FROM riders r JOIN users u ON u.id = r.user_id
       WHERE r.user_id = $1 AND ${action.condition} FOR UPDATE OF r, u`,
      [id]
    );
    if (!rider) throw new HttpError(404, 'Rider application not found.');
    await q.query('UPDATE riders SET rider_status = $1 WHERE user_id = $2', [action.riderStatus, id]);
    await q.query('UPDATE users SET role = $1 WHERE id = $2', [action.userRole, id]);
  });
  res.json({ ok: true });
});

const NEXT_ORDER_STATUSES = {
  pending: ['approved', 'declined'],
  approved: ['shipped'],
  shipped: ['delivered']
};

function updateOrder(orderId, updates) {
  return tx(async (q) => {
    const order = await q.one('SELECT id, status, rider_id, shipping_address FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order) throw new HttpError(404, 'Order not found.');

    const hasStatus = updates.status !== undefined;
    const hasPaymentStatus = updates.payment_status !== undefined;
    if (!hasStatus && !hasPaymentStatus) throw new HttpError(400, 'Provide a status or payment_status update.');

    if (hasStatus && !(NEXT_ORDER_STATUSES[order.status] || []).includes(updates.status)) {
      throw new HttpError(400, `Cannot change a ${order.status} order to ${updates.status}.`);
    }
    if (hasStatus && updates.status === 'shipped' && !order.rider_id) {
      throw new HttpError(400, 'Assign a rider before sending this order out for delivery.');
    }
    const resultingStatus = hasStatus ? updates.status : order.status;
    if (hasPaymentStatus && (updates.payment_status !== 'paid' || resultingStatus === 'declined')) {
      throw new HttpError(400, 'Invalid payment update.');
    }

    if (hasStatus && updates.status === 'declined') {
      const items = await q.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
      for (const it of items) {
        await q.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [it.quantity, it.product_id]);
      }
    }

    await q.query(
      `UPDATE orders
       SET status = COALESCE($1, status),
           payment_status = COALESCE($2, payment_status),
           shipped_at = CASE WHEN $1 = 'shipped' THEN now() ELSE shipped_at END,
           delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
           paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
           estimated_delivery = CASE WHEN $1 = 'shipped' THEN $4::date ELSE estimated_delivery END,
           updated_at = now()
       WHERE id = $3`,
      [hasStatus ? updates.status : null, hasPaymentStatus ? updates.payment_status : null, orderId,
        hasStatus && updates.status === 'shipped' ? estimateDelivery(order.shipping_address) : null]
    );
  });
}

app.patch('/api/admin/orders/:id', auth, adminOnly, async (req, res) => {
  const updates = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const id = intParam(req.params.id);
  await updateOrder(id, updates);
  res.json((await loadOrders('WHERE o.id = $1', [id]))[0]);
});

app.post('/api/admin/orders/:id/assign', auth, adminOnly, async (req, res) => {
  const id = intParam(req.params.id);
  const riderId = intParam((req.body || {}).rider_id);
  await tx(async (q) => {
    const order = await q.one(
      'SELECT id, status, payment_method, payment_status, rider_id FROM orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!order) throw new HttpError(404, 'Order not found.');
    if (!['approved', 'shipped'].includes(order.status)) {
      throw new HttpError(400, 'Only approved orders that have not been delivered can be assigned a rider.');
    }
    if (String(order.payment_method || '').toLowerCase() !== 'cod' && order.payment_status !== 'paid') {
      throw new HttpError(400, 'Payment must be verified before a rider can be assigned.');
    }
    const rider = await q.one(
      `SELECT u.id, COALESCE(u.full_name, u.username) AS name
       FROM users u JOIN riders r ON r.user_id = u.id
       WHERE u.id = $1 AND u.role = 'rider' AND r.rider_status = 'approved'`,
      [riderId]
    );
    if (!rider) throw new HttpError(400, 'That rider is not an approved rider.');
    if (order.rider_id === rider.id) throw new HttpError(400, 'This order is already assigned to that rider.');
    await q.query(
      `UPDATE orders SET rider_id = $1, rider_name = $2, assigned_at = now(), assigned_by = $3,
              failed_at = NULL, failure_reason = NULL, updated_at = now()
       WHERE id = $4`,
      [rider.id, rider.name, req.user.id, id]
    );
  });
  res.json((await loadOrders('WHERE o.id = $1', [id]))[0]);
});
// Signups waiting for email verification
app.get('/api/admin/otps', auth, adminOnly, async (req, res) => {
  const rows = await query(
    `SELECT u.id AS user_id, u.username, u.email, u.phone, u.created_at,
            o.code, o.expires_at, o.attempts,
            CASE WHEN o.expires_at > now() THEN 1 ELSE 0 END AS active
     FROM users u
     LEFT JOIN otp_codes o ON o.id = (SELECT MAX(id) FROM otp_codes WHERE user_id = u.id AND used = false)
     WHERE NOT u.is_verified
     ORDER BY u.id DESC`
  );
  res.json(rows);
});

app.post('/api/admin/users/:id/otp', auth, adminOnly, async (req, res) => {
  const user = await one('SELECT id, email, is_verified FROM users WHERE id = $1', [intParam(req.params.id)]);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.is_verified) throw new HttpError(400, 'That user is already verified.');
  const code = await issueOtp(user.id);
  await emailOtp(user.id, user.email, code);
  res.json({ ok: true, message: 'A verification code was emailed to the customer.' });
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  res.json(await query('SELECT id, username, full_name, email, phone, role, is_verified, created_at FROM users ORDER BY id DESC'));
});

// Remove an unverified signup (spam / mistakes). Verified users and the admin are protected.
app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  const result = await query("DELETE FROM users WHERE id = $1 AND NOT is_verified AND role = 'user' RETURNING id", [intParam(req.params.id)]);
  if (!result.length) throw new HttpError(400, 'Only unverified signups can be removed.');
  res.json({ ok: true });
});

function riderOnly(req, res, next) {
  if (!['rider', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Riders only.' });
  next();
}

riderRouter.get('/orders', auth, riderOnly, async (req, res) => {
  const whereSql = req.user.role === 'admin'
    ? "WHERE o.status IN ('approved', 'shipped', 'delivered') AND o.rider_id IS NOT NULL"
    : "WHERE o.rider_id = $1 AND o.status IN ('approved', 'shipped', 'delivered')";
  res.json(await loadOrders(whereSql, req.user.role === 'admin' ? [] : [req.user.id]));
});

riderRouter.post('/orders/:id/pickup', auth, riderOnly, async (req, res) => {
  const id = intParam(req.params.id);
  await tx(async (q) => {
    const order = await q.one('SELECT id, status, rider_id, shipping_address FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'approved') throw new HttpError(400, 'Order is not ready for pickup.');
    if (!order.rider_id) throw new HttpError(400, 'This order has not been assigned to a rider yet.');
    if (req.user.role !== 'admin' && order.rider_id !== req.user.id) {
      throw new HttpError(403, 'This delivery is assigned to another rider.');
    }
    await q.query(
      `UPDATE orders SET status = 'shipped', shipped_at = now(), failed_at = NULL, failure_reason = NULL,
              estimated_delivery = $2::date, updated_at = now() WHERE id = $1`,
      [id, estimateDelivery(order.shipping_address)]
    );
  });
  res.json((await loadOrders('WHERE o.id = $1', [id]))[0]);
});

riderRouter.post('/orders/:id/fail', auth, riderOnly, async (req, res) => {
  const id = intParam(req.params.id);
  const reason = text((req.body || {}).reason, 200);
  if (reason.length < 3) throw new HttpError(400, 'Please tell us why the delivery failed.');
  await tx(async (q) => {
    const order = await q.one('SELECT id, status, rider_id FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'shipped') throw new HttpError(400, 'Only orders that are out for delivery can fail.');
    if (!order.rider_id) throw new HttpError(400, 'This order has not been assigned to a rider.');
    if (req.user.role !== 'admin' && order.rider_id !== req.user.id) {
      throw new HttpError(403, 'This delivery is assigned to another rider.');
    }
    await q.query(
      "UPDATE orders SET status = 'approved', shipped_at = NULL, failed_at = now(), failure_reason = $1, updated_at = now() WHERE id = $2",
      [reason, id]
    );
  });
  res.json((await loadOrders('WHERE o.id = $1', [id]))[0]);
});

riderRouter.post('/orders/:id/deliver', auth, riderOnly, async (req, res) => {
  const id = intParam(req.params.id);
  const photo = typeof req.body?.photo === 'string' ? req.body.photo : '';
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match) throw new HttpError(400, 'A valid delivery photo is required.');
  const imageBuffer = Buffer.from(match[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
    throw new HttpError(400, 'Photo must be under 5 MB.');
  }
  const imageType = IMAGE_TYPES.find((type) => type.ok(imageBuffer));
  const expectedExtension = match[1] === 'jpeg' ? 'jpg' : match[1];
  if (!imageType || imageType.ext !== expectedExtension) throw new HttpError(400, 'The uploaded photo is not a valid image.');
  const filename = `proof-${id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${expectedExtension}`;
  const relativePath = `images/proofs/${filename}`;
  const absolutePath = path.join(SITE, 'images', 'proofs', filename);
  const isCodOrderPaid = req.body.cash_collected === true;

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, imageBuffer, { flag: 'wx' });
  try {
    await tx(async (q) => {
      const order = await q.one('SELECT id, status, payment_method, payment_status, rider_id FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!order) throw new HttpError(404, 'Order not found.');
      if (order.status !== 'shipped') throw new HttpError(400, 'Order is not out for delivery.');
      if (!order.rider_id) throw new HttpError(400, 'This order has not been assigned to a rider.');
      if (req.user.role !== 'admin' && order.rider_id !== req.user.id) {
        throw new HttpError(403, 'This delivery is assigned to another rider.');
      }
      const collectedCod = String(order.payment_method || '').toLowerCase() === 'cod'
        && order.payment_status !== 'paid' && isCodOrderPaid;
      if (String(order.payment_method || '').toLowerCase() === 'cod'
          && order.payment_status !== 'paid' && !collectedCod) {
        throw new HttpError(400, 'Confirm that you collected the cash before completing delivery.');
      }
      await q.query(
        `UPDATE orders
         SET status = 'delivered', delivered_at = now(), proof_image = $1,
             rider_id = COALESCE(rider_id, $2), rider_name = COALESCE(rider_name, $3),
             payment_status = CASE WHEN $4 THEN 'paid' ELSE payment_status END,
             paid_at = CASE WHEN $4 THEN COALESCE(paid_at, now()) ELSE paid_at END,
             updated_at = now()
         WHERE id = $5`,
        [relativePath, req.user.id, req.user.username, collectedCod, id]
      );
    });
  } catch (error) {
    try {
      await fs.promises.unlink(absolutePath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Could not remove unused delivery proof:', cleanupError.message);
    }
    throw error;
  }
  res.json((await loadOrders('WHERE o.id = $1', [id]))[0]);
});

// ---------- admin: products ----------
const ADMIN_PRODUCT_SQL = `SELECT p.id, p.name, p.slug, p.brand, p.description, p.price, p.stock, p.image,
                                  p.members_only, p.is_featured, p.is_active, p.category_id, c.name AS category,
                                  COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id), 0) AS avg_rating,
                                  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS review_count,
                                  ((SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.comment IS NOT NULL)
                                   + (SELECT COUNT(*) FROM review_replies rr JOIN reviews r2 ON r2.id = rr.review_id WHERE r2.product_id = p.id)) AS comment_count
                           FROM products p JOIN categories c ON c.id = p.category_id`;

app.get('/api/admin/products/:id/reviews', auth, adminOnly, async (req, res) => {
  const id = intParam(req.params.id);
  const product = await one('SELECT id, name FROM products WHERE id = $1', [id]);
  if (!product) throw new HttpError(404, 'Product not found.');
  const reviews = await query(
    `SELECT r.id, r.user_id, r.rating, r.comment, r.created_at, u.username
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 ORDER BY r.id DESC`,
    [id]
  );
  const replies = await query(
    `SELECT rr.id, rr.review_id, rr.user_id, rr.comment, rr.created_at, u.username, u.role
     FROM review_replies rr
     JOIN reviews r ON r.id = rr.review_id
     JOIN users u ON u.id = rr.user_id
     WHERE r.product_id = $1 ORDER BY rr.id`,
    [id]
  );
  res.json({
    product,
    reviews: reviews.map((review) => ({
      ...review,
      replies: replies.filter((reply) => reply.review_id === review.id).map((reply) => ({
        id: reply.id, user_id: reply.user_id, username: reply.username, is_admin: reply.role === 'admin',
        comment: reply.comment, created_at: reply.created_at
      }))
    }))
  });
});

app.get('/api/admin/categories', auth, adminOnly, async (req, res) => {
  res.json(await query('SELECT id, name, slug FROM categories ORDER BY name'));
});

app.get('/api/admin/products', auth, adminOnly, async (req, res) => {
  res.json(await query(ADMIN_PRODUCT_SQL + ' ORDER BY p.id DESC'));
});

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const flag = (v) => v === true || v === 1 || v === '1';

async function readProduct(b, partial) {
  const out = {};
  const has = (k) => !partial || b[k] !== undefined;
  if (has('name')) {
    out.name = text(b.name, 100);
    if (out.name.length < 2) throw new HttpError(400, 'Enter a product name.');
  }
  if (has('category_id')) {
    out.category_id = intParam(b.category_id);
    if (!(await one('SELECT 1 FROM categories WHERE id = $1', [out.category_id]))) throw new HttpError(400, 'Choose a category.');
  }
  if (has('price')) {
    out.price = Number(b.price);
    if (!Number.isFinite(out.price) || out.price < 0 || out.price > 10000000) throw new HttpError(400, 'Enter a valid price.');
    out.price = round2(out.price);
  }
  if (has('stock')) {
    out.stock = Number(b.stock);
    if (!Number.isInteger(out.stock) || out.stock < 0 || out.stock > 100000) throw new HttpError(400, 'Stock must be a whole number, 0 or more.');
  }
  if (has('brand')) out.brand = text(b.brand, 60) || null;
  if (has('description')) out.description = text(b.description, 500) || null;
  if (has('image')) {
    out.image = text(b.image, 200) || null;
    if (out.image && !/^images\/[A-Za-z0-9._-]+$/.test(out.image)) throw new HttpError(400, 'Invalid image path.');
  }
  for (const k of ['is_featured', 'is_active', 'members_only']) if (b[k] !== undefined) out[k] = flag(b[k]);
  return out;
}

app.post('/api/admin/products', auth, adminOnly, async (req, res) => {
  const p = await readProduct(req.body || {}, false);
  let slug = slugify(p.name) || 'product';
  const base = slug;
  for (let i = 2; await one('SELECT 1 FROM products WHERE slug = $1', [slug]); i++) slug = base + '-' + i;
  const r = await one(
    `INSERT INTO products (category_id, name, slug, brand, description, price, stock, image, members_only, is_featured, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [p.category_id, p.name, slug, p.brand, p.description, p.price, p.stock, p.image,
     p.members_only || false, p.is_featured === undefined ? true : p.is_featured, p.is_active === undefined ? true : p.is_active]
  );
  res.status(201).json(await one(ADMIN_PRODUCT_SQL + ' WHERE p.id = $1', [r.id]));
});

app.patch('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await one('SELECT 1 FROM products WHERE id = $1', [id]))) throw new HttpError(404, 'Product not found.');
  const p = await readProduct(req.body || {}, true);
  const keys = Object.keys(p); // only the fixed column names produced by readProduct()
  if (keys.length) {
    await query(
      `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
      [...keys.map((k) => p[k]), id]
    );
  }
  res.json(await one(ADMIN_PRODUCT_SQL + ' WHERE p.id = $1', [id]));
});

// ---------- fallbacks ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`QuazarTech running at http://localhost:${PORT} (database: Supabase)`));
  })
  .catch((e) => {
    console.error('Could not start: ' + e.message);
    process.exit(1);
  });