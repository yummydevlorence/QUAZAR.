(() => {
  // Token handoff when the page was opened from Live Server (another port).
  const m = location.hash.match(/^#token=(.+)$/);
  if (!m) return;
  try { localStorage.setItem('quazar_auth_token', decodeURIComponent(m[1])); } catch {}
  history.replaceState(null, '', location.pathname);
})();
const TOKEN_KEY = 'quazar_auth_token';
const $ = (id) => document.getElementById(id);
const state = { token: '', user: null, orders: [], tab: 'todo', proofOrder: null, proofData: '', busy: false, noticeTimer: null };
let logoutTrigger = null;

const money = (v) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v) || 0);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const API_BASE = (location.protocol === 'file:' ||
  (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8000'))
  ? 'http://localhost:8000' : '';
const imageUrl = (p) => p ? `${API_BASE}/${String(p).replace(/^\/+/, '')}` : '';
const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const isCod = (o) => String(o.payment_method || '').toLowerCase() === 'cod';
const isPaid = (o) => o.payment_status === 'paid';
const ico = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  phone: ico('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  pin: ico('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
  map: ico('<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z"/><path d="M9 3v16M15 5v16"/>'),
  truck: ico('<path d="M1 3h14v13H1zM15 8h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
  camera: ico('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  box: ico('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  refresh: ico('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  out: ico('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: 'The server returned an unreadable response.' }; } }
  if (!res.ok) {
    const message = data.error || `Request failed (${res.status}).`;
    const e = new Error(res.status === 404
      ? `Rider API route not found: ${method} /api${path}. Restart the updated backend and reload this page.`
      : `${message} (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

function notice(msg, isError = false) {
  const n = $('notice');
  n.textContent = msg; n.classList.toggle('error', isError); n.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { n.hidden = true; }, 5000);
}

function showGate(message, title = 'Rider access required') {
  $('gate-title').textContent = title; $('gate-message').textContent = message;
  $('gate').hidden = false; $('app').hidden = true;
}

function openLogout() {
  const account = state.user?.full_name || state.user?.username || state.user?.email || 'your rider account';
  $('logout-message').textContent = `You are signed in as ${account}. Do you want to log out?`;
  logoutTrigger = $('logout');
  $('logout-modal').hidden = false;
  $('logout-cancel').focus();
}

function closeLogout() {
  $('logout-modal').hidden = true;
  logoutTrigger?.focus();
  logoutTrigger = null;
}

function confirmLogout() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  location.href = '/';
}

function startTrafficAvoidance() {
  const courier = document.querySelector('.courier');
  const cars = [...document.querySelectorAll('.road-car')];
  if (!courier || !cars.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let lane = 'upper';
  let movingRight = true;
  let previousX = null;
  let clearSince = 0;

  const laneOf = (car) => car.classList.contains('road-car-lower') || car.classList.contains('road-car-lower-two') ? 'lower' : 'upper';
  const blocked = (targetLane, bikeCenter, direction) => cars.some((car) => {
    if (laneOf(car) !== targetLane || Number(getComputedStyle(car).opacity) < 0.35) return false;
    const rect = car.getBoundingClientRect();
    const gap = direction === 'right' ? rect.left - bikeCenter : bikeCenter - rect.right;
    return gap > -75 && gap < 155;
  });

  function checkTraffic(now) {
    const bikeRect = courier.getBoundingClientRect();
    if (previousX !== null && Math.abs(bikeRect.left - previousX) > 0.2) movingRight = bikeRect.left > previousX;
    previousX = bikeRect.left;

    if (Number(getComputedStyle(courier).opacity) > 0.35) {
      const direction = movingRight ? 'right' : 'left';
      const preferredLane = movingRight ? 'upper' : 'lower';
      const bikeCenter = bikeRect.left + bikeRect.width / 2;
      const otherLane = lane === 'upper' ? 'lower' : 'upper';

      if (blocked(lane, bikeCenter, direction)) {
        clearSince = 0;
        if (!blocked(otherLane, bikeCenter, direction)) {
          lane = otherLane;
          courier.classList.toggle('lane-lower', lane === 'lower');
        }
      } else {
        if (!clearSince) clearSince = now;
        if (lane !== preferredLane && now - clearSince > 900 && !blocked(preferredLane, bikeCenter, direction)) {
          lane = preferredLane;
          courier.classList.toggle('lane-lower', lane === 'lower');
          clearSince = 0;
        }
      }
    }

    requestAnimationFrame(checkTraffic);
  }

  requestAnimationFrame(checkTraffic);
}

const bucket = (o) => o.status === 'approved' ? 'todo' : o.status === 'shipped' ? 'ontheway' : o.status === 'delivered' ? 'done' : null;

function render() {
  const groups = { todo: [], ontheway: [], done: [] };
  for (const o of state.orders) { const b = bucket(o); if (b) groups[b].push(o); }
  for (const k of Object.keys(groups)) $(`c-${k}`).textContent = groups[k].length;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  const list = groups[state.tab];
  const empty = { todo: 'No orders waiting for pickup.', ontheway: 'No deliveries in progress.', done: 'No delivered orders yet.' }[state.tab];
  $('list').innerHTML = list.map(card).join('') || `<div class="empty"><span class="big-ic">${I.box}</span><strong>All clear</strong>${empty}</div>`;
}

function card(o) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.shipping_address || '')}`;
  const items = (o.items || []).map((i) => `<li>${esc(i.name)} × ${Number(i.quantity)}</li>`).join('');
  const pay = isPaid(o) ? '<span class="pill paid">Paid</span>' : isCod(o) ? '<span class="pill cod">Collect cash</span>' : '<span class="pill cod">Unpaid</span>';
  const step = { approved: 0, shipped: 1, delivered: 2 }[o.status] ?? 0;
  const track = ['Pick up', 'On the way', 'Delivered'].map((l, n) => `<span class="${n <= step ? 'on' : ''} ${n === step ? 'now' : ''}">${l}</span>`).join('');
  const day = (value) => value
    ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const assigned = o.assigned_at
    ? `<div class="row"><span class="ic">${I.box}</span><span>Assigned ${esc(new Date(o.assigned_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>`
    : '';
  const eta = o.estimated_delivery
    ? `<div class="row"><span class="ic">${I.truck}</span><span>Expected delivery: ${esc(day(o.estimated_delivery))}</span></div>`
    : '';
  const failed = o.failed_at && o.status === 'approved'
    ? `<div class="row"><span class="ic">${I.pin}</span><span>Last attempt failed: ${esc(o.failure_reason || '')}</span></div>`
    : '';
  let action = '';
  if (o.status === 'approved') action = `<button class="btn" type="button" data-pickup="${o.id}">${I.truck} Start delivery</button>`;
  if (o.status === 'shipped') action = `<button class="btn" type="button" data-deliver="${o.id}">${I.camera} Mark as delivered</button><button class="btn ghost" type="button" data-fail="${o.id}">Delivery failed</button>`;
  if (o.status === 'delivered' && o.proof_image) action = `<img class="proof-thumb" src="${esc(imageUrl(o.proof_image))}" alt="Proof of delivery" loading="lazy">`;
  return `<article class="card" data-status="${esc(o.status)}">
    <div class="card-top"><strong>#QZ-${Number(o.id)}</strong>${pay}</div>
    <div class="track" aria-label="Delivery progress">${track}</div>
    <p class="who">${esc(o.shipping_name)}</p>
    <div class="row"><span class="ic">${I.phone}</span><a href="${esc(telHref(o.shipping_phone))}">${esc(o.shipping_phone)}</a></div>
    <div class="row"><span class="ic">${I.pin}</span><span>${esc(o.shipping_address)}</span></div>
    <div class="links"><a href="${esc(telHref(o.shipping_phone))}">${I.phone} Call</a><a href="${esc(maps)}" target="_blank" rel="noopener">${I.map} Open map</a></div>
    ${assigned}${eta}${failed}
    <ul class="items">${items}</ul>
    <div class="total"><span>${isPaid(o) ? 'Total (paid)' : 'Amount to collect'}</span><b>${money(o.total)}</b></div>
    ${action}</article>`;
}

async function load() {
  const data = await api('/rider/orders');
  state.orders = data;
  render();
}

async function pickup(id) {
  if (!window.confirm(`Start delivery for order #QZ-${id}?`)) return;
  try {
    const updated = await api(`/rider/orders/${id}/pickup`, { method: 'POST', body: {} });
    state.orders = state.orders.map((o) => o.id === id ? updated : o);
    state.tab = 'ontheway'; render();
    notice(`Order #QZ-${id} is on the way.`);
  } catch (e) { notice(e.message, true); }
}

async function failDelivery(id) {
  const reason = (window.prompt(`Why could order #QZ-${id} not be delivered?`) || '').trim();
  if (reason.length < 3) return;
  try {
    const updated = await api(`/rider/orders/${id}/fail`, { method: 'POST', body: { reason } });
    state.orders = state.orders.map((order) => order.id === id ? updated : order);
    state.tab = 'todo';
    render();
    notice(`Order #QZ-${id} marked as a failed delivery attempt.`);
  } catch (error) {
    notice(error.message, true);
  }
}

/* ---------- camera / proof ---------- */
function openProof(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  state.proofOrder = o; state.proofData = '';
  $('proof-title').textContent = `Order #QZ-${o.id} · ${o.shipping_name}`;
  $('proof-preview').hidden = true; $('proof-preview').removeAttribute('src');
  $('proof-input').value = ''; $('camera-label').textContent = 'Open camera';
  $('proof-error').textContent = ''; $('proof-submit').disabled = true;
  const needCash = isCod(o) && !isPaid(o);
  $('cod-wrap').hidden = !needCash; $('cod-collected').checked = false;
  $('cod-amount').textContent = money(o.total);
  $('proof-modal').hidden = false;
}
function closeProof() { $('proof-modal').hidden = true; state.proofOrder = null; state.proofData = ''; }

// shrink the photo so uploads are fast on mobile data
function compress(file, max = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo. Try again.')); };
    img.src = url;
  });
}

async function onPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  $('proof-error').textContent = '';
  try {
    state.proofData = await compress(file);
    $('proof-preview').src = state.proofData; $('proof-preview').hidden = false;
    $('camera-label').textContent = 'Retake photo';
    $('proof-submit').disabled = false;
  } catch (err) { $('proof-error').textContent = err.message; $('proof-submit').disabled = true; }
}

async function submitProof() {
  const o = state.proofOrder;
  if (!o || !state.proofData || state.busy) return;
  const needCash = isCod(o) && !isPaid(o);
  if (needCash && !$('cod-collected').checked) { $('proof-error').textContent = 'Confirm that you collected the cash first.'; return; }
  state.busy = true; $('proof-submit').disabled = true; $('proof-submit').textContent = 'Uploading…';
  try {
    const updated = await api(`/rider/orders/${o.id}/deliver`, { method: 'POST', body: { photo: state.proofData, cash_collected: needCash } });
    state.orders = state.orders.map((x) => x.id === o.id ? updated : x);
    closeProof(); state.tab = 'done'; render();
    notice(`Order #QZ-${o.id} delivered. Great job!`);
  } catch (err) {
    $('proof-error').textContent = err.message; $('proof-submit').disabled = false;
  } finally { state.busy = false; $('proof-submit').textContent = 'Confirm delivered'; }
}

function bind() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); }));
  $('list').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pickup]'); const d = e.target.closest('[data-deliver]');
    const f = e.target.closest('[data-fail]');
    if (p) pickup(Number(p.dataset.pickup));
    if (d) openProof(Number(d.dataset.deliver));
    if (f) failDelivery(Number(f.dataset.fail));
  });
  $('refresh').addEventListener('click', () => { $('refresh').classList.remove('spin'); void $('refresh').offsetWidth; $('refresh').classList.add('spin'); load().then(() => notice('Updated.')).catch((e) => notice(e.message, true)); });
  $('logout').addEventListener('click', openLogout);
  $('logout-cancel').addEventListener('click', closeLogout);
  $('logout-confirm').addEventListener('click', confirmLogout);
  $('logout-modal').addEventListener('click', (e) => { if (e.target === $('logout-modal')) closeLogout(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('logout-modal').hidden) closeLogout(); });
  $('proof-input').addEventListener('change', onPhoto);
  $('proof-close').addEventListener('click', closeProof);
  $('proof-cancel').addEventListener('click', closeProof);
  $('proof-submit').addEventListener('click', submitProof);
  $('proof-modal').addEventListener('click', (e) => { if (e.target === $('proof-modal')) closeProof(); });
}

async function init() {
  try { state.token = localStorage.getItem(TOKEN_KEY) || ''; }
  catch { return showGate('Browser storage is unavailable. Enable it and sign in again.'); }
  if (!state.token) return showGate('Sign in on the Quazar store with your rider account.');
  try {
    const { user } = await api('/me');
    state.user = user;
    if (!['rider', 'admin'].includes(user.role)) return showGate('This page is only for riders.');
    $('app').hidden = false; $('rider-name').textContent = user.full_name || user.username || 'Rider';
    bind(); await load();
    setInterval(() => { if (!document.hidden && $('proof-modal').hidden) load().catch(() => {}); }, 30000);
  } catch (e) {
    if (e.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch {} return showGate('Your session expired. Sign in again.'); }
    showGate(e.message, 'Could not load deliveries');
  }
}
startTrafficAvoidance();
init();