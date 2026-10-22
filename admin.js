(() => {
  // Token handoff when the page was opened from Live Server (another port).
  const m = location.hash.match(/^#token=(.+)$/);
  if (!m) return;
  try { localStorage.setItem('quazar_auth_token', decodeURIComponent(m[1])); } catch {}
  history.replaceState(null, '', location.pathname);
})();
const TOKEN_KEY = 'quazar_auth_token';
const $ = (id) => document.getElementById(id);
const state = {
  token: '', user: null, orders: [], products: [], categories: [], users: [], otps: [], riders: [],
  view: 'dashboard', orderFilter: 'all', selectedOrder: null, search: '',
  uploadPromise: null, noticeTimer: null, reviewProductId: null
};

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ORDER_STATUSES = ['pending', 'approved', 'shipped', 'delivered', 'declined'];
const statusName = (status) => ({ pending: 'Pending', approved: 'Approved', shipped: 'Out for delivery', delivered: 'Arrived', declined: 'Declined' }[status] || status);
const statusClass = (status) => `status-${ORDER_STATUSES.includes(status) ? status : 'pending'}`;
const isPaid = (order) => order.payment_status === 'paid';
const paymentBadge = (order) => order.status === 'declined' ? '' : `<span class="status-badge ${isPaid(order) ? 'status-paid' : 'status-unpaid'}">${isPaid(order) ? 'Paid' : 'Unpaid'}</span>`;
const ICON_STAR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" fill="currentColor"/></svg>';
const ICON_COMMENT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor"/></svg>';
const ICON_REPLY = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9V5l-8 7 8 7v-4c5 0 8.5 1.5 11 5-1-6-4.5-10-11-11z" fill="currentColor"/></svg>';
const starText = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const API_BASE = (location.protocol === 'file:' ||
  (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8000'))
  ? 'http://localhost:8000' : '';
const imageUrl = (image) => image ? `${API_BASE}/${String(image).replace(/^\/+/, '')}` : '';

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  const responseText = await response.text();
  if (responseText) {
    try { data = JSON.parse(responseText); } catch { data = { error: 'The server returned an unreadable response.' }; }
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showNotice(message, isError = false) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function showGate(message, title = 'Admin access required') {
  $('gate-title').textContent = title;
  $('gate-message').textContent = message;
  $('access-gate').hidden = false;
  document.querySelector('.admin-shell').hidden = true;
}

function dateValue(value) {
  if (!value) return null;
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeTime = false) {
  const date = dateValue(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en', includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const labels = {
    dashboard: ['Forecasting & Demand', 'Recent order activity and demand outlook'],
    products: ['Products', 'Manage catalog, inventory, and storefront visibility'],
    orders: ['Orders', 'Approve orders, send them out for delivery, and track payment'],
    users: ['Users', 'Customer accounts and verification'],
    riders: ['Riders', 'Review rider applications and manage your delivery team'],
    reports: ['Reports', 'Sales and product demand from order history'],
    settings: ['Settings', 'Administrator account and session']
  };
  $('view-title').textContent = labels[view][0];
  $('view-subtitle').textContent = labels[view][1];
  $('sidebar').classList.remove('open');
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'orders') renderOrders();
  if (state.view === 'products') renderProducts();
  if (state.view === 'users') renderUsers();
  if (state.view === 'riders') renderRiders();
  renderRiderBadge();
  if (state.view === 'reports') renderReports();
  if (state.view === 'settings') renderSettings();
}

function eligibleOrders() {
  return state.orders.filter((order) => order.status !== 'declined');
}

function getDemandSeries() {
  const today = new Date();
  const midnight = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const pastKeys = [];
  const futureKeys = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(midnight);
    day.setUTCDate(day.getUTCDate() - offset);
    pastKeys.push(day.toISOString().slice(0, 10));
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = new Date(midnight);
    day.setUTCDate(day.getUTCDate() + offset);
    futureKeys.push(day.toISOString().slice(0, 10));
  }
  const byDay = new Map(pastKeys.map((key) => [key, 0]));
  for (const order of eligibleOrders()) {
    const key = String(order.created_at || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    byDay.set(key, byDay.get(key) + (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  }
  const actual = pastKeys.map((key) => byDay.get(key));
  const dailyAverage = actual.reduce((sum, count) => sum + count, 0) / actual.length;
  const forecast = futureKeys.map(() => dailyAverage);
  return { pastKeys, futureKeys, actual, forecast, estimate: Math.round(dailyAverage * 7) };
}

function drawDemandChart() {
  const canvas = $('demand-chart');
  if (!canvas || canvas.closest('[hidden]')) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const { pastKeys, futureKeys, actual, estimate } = getDemandSeries();
  const width = rect.width;
  const height = rect.height;
  const left = 30;
  const right = 8;
  const top = 12;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(5, ...actual, estimate / 7) * 1.25;
  const chartValues = [...actual, ...Array(7).fill(estimate / 7)];
  const step = plotWidth / (chartValues.length - 1);
  context.clearRect(0, 0, width, height);
  context.font = '9px DM Sans, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let line = 0; line <= 4; line += 1) {
    const y = top + plotHeight * (line / 4);
    const label = Math.round(maxValue * (1 - line / 4));
    context.strokeStyle = '#edf2ee';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillStyle = '#87988e';
    context.fillText(String(label), left - 7, y);
  }
  for (let index = 0; index < chartValues.length; index += 1) {
    const x = left + index * step;
    const date = new Date(`${(pastKeys[index] || futureKeys[index - pastKeys.length])}T00:00:00`);
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#829388';
    context.fillText(new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date), x, height - bottom + 7);
  }
  context.fillStyle = 'rgba(54, 147, 97, .11)';
  context.beginPath();
  actual.forEach((value, index) => {
    const x = left + index * step;
    const y = top + plotHeight * (1 - value / maxValue);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineTo(left + (actual.length - 1) * step, top + plotHeight);
  context.lineTo(left, top + plotHeight);
  context.closePath();
  context.fill();

  context.strokeStyle = '#32875a';
  context.lineWidth = 2;
  context.beginPath();
  actual.forEach((value, index) => {
    const x = left + index * step;
    const y = top + plotHeight * (1 - value / maxValue);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  actual.forEach((value, index) => {
    const x = left + index * step;
    const y = top + plotHeight * (1 - value / maxValue);
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fillStyle = '#32875a';
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.stroke();
  });

  const barWidth = Math.max(3, Math.min(10, step * .5));
  for (let index = 0; index < 7; index += 1) {
    const seriesIndex = pastKeys.length + index;
    const x = left + seriesIndex * step - barWidth / 2;
    const barHeight = plotHeight * ((estimate / 7) / maxValue);
    context.fillStyle = '#a8d0b5';
    context.fillRect(x, top + plotHeight - barHeight, barWidth, barHeight);
  }
}

function renderDashboard() {
  const series = getDemandSeries();
  const lastSeven = eligibleOrders().filter((order) => String(order.created_at || '').slice(0, 10) >= series.pastKeys[0]);
  const total = series.actual.reduce((sum, count) => sum + count, 0);
  $('week-total').textContent = total.toLocaleString();
  $('week-change').textContent = lastSeven.length ? `${lastSeven.length} orders in this period` : 'No orders in this period';
  $('forecast-total').textContent = series.estimate.toLocaleString();
  const productTotals = new Map();
  for (const order of lastSeven) {
    for (const item of order.items || []) {
      const key = item.product_id;
      const current = productTotals.get(key) || { name: item.name, units: 0, image: '' };
      current.units += Number(item.quantity || 0);
      const product = state.products.find((entry) => entry.id === key);
      current.image = product?.image || current.image;
      productTotals.set(key, current);
    }
  }
  const top = [...productTotals.values()].sort((a, b) => b.units - a.units).slice(0, 3);
  $('top-products').innerHTML = top.length ? top.map((product) => `
    <div class="top-product">
      ${product.image ? `<img src="${escapeHtml(imageUrl(product.image))}" alt="" loading="lazy">` : '<span class="product-thumb"></span>'}
      <span><strong>${escapeHtml(product.name)}</strong><small>${product.units} units ordered</small></span>
      <b>${product.units.toLocaleString()} units</b>
    </div>`).join('') : '<div class="empty-state">No product demand in the last 7 days.</div>';
  $('forecast-insight').textContent = top.length
    ? `${top[0].name} leads recent demand with ${top[0].units} units. The next-week estimate uses the average daily units from the last 7 days.`
    : 'Demand outlook will appear when recent order history is available.';
  $('activity-list').innerHTML = state.orders.slice(0, 5).map((order) => `
    <div class="activity-item"><i class="activity-dot"></i><span><strong>Order #QZ-${order.id} · ${escapeHtml(statusName(order.status))}</strong><small>${escapeHtml(order.shipping_name)} · ${money(order.total)}</small></span><time>${escapeHtml(formatDate(order.created_at, true))}</time></div>`).join('') || '<div class="empty-state">No orders yet.</div>';
  drawDemandChart();
}

function filteredOrders() {
  const query = state.search.toLowerCase();
  return state.orders.filter((order) => {
    const filterMatches = state.orderFilter === 'all'
      || (state.orderFilter === 'unpaid' ? (!isPaid(order) && order.status !== 'declined') : order.status === state.orderFilter);
    const searchText = [order.id, order.shipping_name, order.email, order.shipping_phone, order.status,
      ...(order.items || []).map((item) => item.name)].join(' ').toLowerCase();
    return filterMatches && (!query || searchText.includes(query));
  });
}

function renderOrders() {
  const orders = filteredOrders();
  $('order-count').textContent = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`;
  $('orders-body').innerHTML = orders.map((order) => `
    <tr class="orders-body-row ${order.id === state.selectedOrder ? 'selected' : ''}" data-order-id="${Number(order.id)}">
      <td><strong>#QZ-${Number(order.id)}</strong></td>
      <td class="customer-cell"><strong>${escapeHtml(order.shipping_name)}</strong><small>${escapeHtml(order.email)}</small></td>
      <td>${escapeHtml(formatDate(order.created_at, true))}</td>
      <td>${money(order.total)}</td>
      <td><span class="status-badge ${statusClass(order.status)}">${escapeHtml(statusName(order.status))}</span></td>
      <td>${paymentBadge(order) || '—'}</td>
      <td><button class="view-button" type="button" data-view-order="${Number(order.id)}">View</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">No matching orders.</td></tr>';
  $('orders-foot').textContent = `Showing ${orders.length ? 1 : 0}–${orders.length} of ${orders.length} orders`;
  const selected = state.orders.find((order) => order.id === state.selectedOrder) || orders[0];
  if (selected) {
    state.selectedOrder = selected.id;
    renderOrderDetail(selected);
  } else {
    $('order-detail').innerHTML = '<div class="empty-state">Select an order to view its details.</div>';
  }
}

function renderOrderDetail(order) {
  const userInitial = escapeHtml((order.shipping_name || 'Q').trim().charAt(0).toUpperCase());
  const items = (order.items || []).map((item) => {
    const product = state.products.find((entry) => entry.id === item.product_id);
    const image = product?.image;
    return `<div class="detail-item">
      ${image ? `<img src="${escapeHtml(imageUrl(image))}" alt="" loading="lazy">` : '<span class="product-thumb"></span>'}
      <span><strong>${escapeHtml(item.name)}</strong><small>Qty: ${Number(item.quantity)} · ${money(item.unit_price)} each</small></span>
      <b>${money(Number(item.quantity) * Number(item.unit_price))}</b>
    </div>`;
  }).join('');
  const id = Number(order.id);
  const next = {
    approved: order.rider_id ? { status: 'shipped', label: '🚚 Mark as out for delivery' } : null,
    shipped: { status: 'delivered', label: '✓ Mark as arrived' }
  }[order.status];
  const cod = String(order.payment_method || '').toLowerCase() === 'cod';
  const assignable = ['approved', 'shipped'].includes(order.status) && (cod || isPaid(order));
  const riders = state.riders.filter((rider) => rider.rider_status === 'approved');
  const riderSection = assignable ? `<section class="detail-section"><h3>Delivery rider</h3>
      <p class="shipping-copy">${order.rider_id ? `Assigned to <b>${escapeHtml(order.rider_name || '')}</b>${order.rider_phone ? ` · ${escapeHtml(order.rider_phone)}` : ''}${order.assigned_at ? `<br>Assigned ${escapeHtml(formatDate(order.assigned_at, true))}` : ''}` : 'No rider assigned yet.'}
      ${order.failed_at && order.status === 'approved' ? `<br><b>Last delivery attempt failed:</b> ${escapeHtml(order.failure_reason || '')}` : ''}</p>
      <div class="assign-row"><select id="assign-rider">${riders.map((rider) => `<option value="${Number(rider.id)}"${Number(rider.id) === Number(order.rider_id) ? ' selected' : ''}>${escapeHtml(rider.full_name || rider.username)} (${Number(rider.active_jobs || 0)} active)</option>`).join('') || '<option value="">No approved riders</option>'}</select>
      <button type="button" data-assign-order="${id}"${riders.length ? '' : ' disabled'}>${order.rider_id ? 'Reassign' : 'Assign rider'}</button></div></section>`
    : (['approved', 'shipped'].includes(order.status) ? '<section class="detail-section"><h3>Delivery rider</h3><p class="shipping-copy">Mark this order as paid before assigning a rider.</p></section>' : '');
  const actions = order.status === 'pending'
    ? `<button type="button" data-update-order="approved" data-order-id="${id}">Approve order</button><button class="decline" type="button" data-update-order="declined" data-order-id="${id}">Decline order</button>`
    : order.status === 'declined' ? '<p class="shipping-copy full">This order was declined.</p>' : `
      ${next ? `<button class="full" type="button" data-update-order="${next.status}" data-order-id="${id}">${next.label}</button>`
        : order.status === 'approved' ? '<p class="shipping-copy full">Assign a rider below before sending this out for delivery.</p>'
        : '<p class="shipping-copy full done">✓ Delivered to the customer.</p>'}
      ${isPaid(order) ? '<p class="shipping-copy full done">✓ Payment received.</p>' : `<button class="full secondary" type="button" data-update-payment="paid" data-order-id="${id}">₱ Mark as paid</button>`}`;
  $('order-detail').innerHTML = `
    <div class="detail-head"><div><h2>Order #QZ-${Number(order.id)}</h2><p>${escapeHtml(formatDate(order.created_at, true))}</p></div><span class="status-badge ${statusClass(order.status)}">${escapeHtml(statusName(order.status))}</span></div>
    <section class="detail-section"><h3>Customer</h3><div class="detail-customer"><span class="avatar">${userInitial}</span><span><strong>${escapeHtml(order.customer_name || order.shipping_name)}</strong><small>${escapeHtml(order.email)}<br>${escapeHtml(order.shipping_phone)}</small></span></div></section>
    <section class="detail-section"><h3>Order items</h3><div class="detail-items">${items || '<p class="shipping-copy">No item details available.</p>'}</div></section>
    <section class="detail-section"><div class="detail-totals">
      <div class="detail-total-row"><span>Subtotal</span><b>${money(order.subtotal)}</b></div>
      <div class="detail-total-row"><span>Discount</span><b>−${money(order.discount_amount)}</b></div>
      <div class="detail-total-row"><span>Payment</span><b>${escapeHtml(String(order.payment_method || '—').toUpperCase())} ${paymentBadge(order)}</b></div>
      <div class="detail-total-row grand"><span>Total</span><b>${money(order.total)}</b></div>
    </div></section>
    <section class="detail-section"><h3>Shipping information</h3><div class="shipping-copy">${escapeHtml(order.shipping_name)}<br>${escapeHtml(order.shipping_address)}<br>${escapeHtml(order.shipping_phone)}</div></section>
    ${riderSection}
    ${order.proof_image ? `<section class="detail-section"><h3>Proof of delivery</h3><a href="${escapeHtml(imageUrl(order.proof_image))}" target="_blank" rel="noopener"><img class="proof-img" src="${escapeHtml(imageUrl(order.proof_image))}" alt="Proof of delivery" loading="lazy"></a>${order.delivered_at ? `<p class="shipping-copy">Delivered ${escapeHtml(formatDate(order.delivered_at, true))}${order.rider_name ? ` by ${escapeHtml(order.rider_name)}` : ''}</p>` : ''}</section>` : ''}
    <div class="order-actions">${actions}</div>`;
}

function renderProducts() {
  const query = state.search.toLowerCase();
  const products = state.products.filter((product) => [product.name, product.brand, product.category, product.slug].join(' ').toLowerCase().includes(query));
  $('products-body').innerHTML = products.map((product) => `
    <tr><td><div class="product-info">${product.image ? `<img src="${escapeHtml(imageUrl(product.image))}" alt="" loading="lazy">` : '<span class="product-thumb"></span>'}<span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.brand || product.slug)}</small></span></div></td>
      <td>${escapeHtml(product.category)}</td><td>${money(product.price)}</td><td>${Number(product.stock).toLocaleString()}</td>
      <td><button type="button" class="rating-cell" data-view-reviews="${Number(product.id)}" title="View ratings and comments">${Number(product.review_count) ? `<span class="rc-star">${ICON_STAR} <b>${Number(product.avg_rating).toFixed(1)}</b> <small>(${Number(product.review_count)})</small></span><span class="rc-cmt">${ICON_COMMENT} <b>${Number(product.comment_count)}</b></span>` : '<span class="rc-none">No reviews</span>'}</button></td>
      <td><span class="status-badge ${Number(product.is_active) ? 'status-approved' : 'status-declined'}">${Number(product.is_active) ? 'Active' : 'Archived'}</span></td>
      <td><div class="inline-actions"><button type="button" data-edit-product="${Number(product.id)}">Edit</button><button type="button" data-toggle-product="${Number(product.id)}">${Number(product.is_active) ? 'Archive' : 'Restore'}</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">No matching products.</td></tr>';
  $('products-foot').textContent = `${products.length} products`;
}

async function openReviewsModal(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) return;
  state.reviewProductId = productId;
  $('reviews-modal-title').textContent = `${product.name} — Ratings & comments`;
  $('reviews-modal-body').innerHTML = '<p class="review-loading">Loading reviews…</p>';
  $('reviews-modal').hidden = false;
  await loadProductReviews();
}

async function loadProductReviews() {
  const body = $('reviews-modal-body');
  try {
    const data = await api(`/admin/products/${state.reviewProductId}/reviews`);
    body.innerHTML = data.reviews.map((review) => `
      <article class="admin-review">
        <div class="admin-review-head">
          <span class="admin-review-stars" aria-label="${Number(review.rating)} out of 5 stars">${starText(Number(review.rating))}</span>
          <strong>${escapeHtml(review.username)}</strong>
          <time>${escapeHtml(formatDate(review.created_at, true))}</time>
          <button type="button" class="danger-button" data-delete-review="${Number(review.id)}">Delete</button>
        </div>
        <p>${review.comment ? escapeHtml(review.comment) : '<span class="review-no-comment">No comment</span>'}</p>
        ${review.replies.map((reply) => `
          <div class="admin-review-reply">
            <div class="admin-review-head">
              <span class="admin-review-reply-icon">${ICON_REPLY}</span>
              <strong>${escapeHtml(reply.username)}${reply.is_admin ? ' <span class="review-admin-badge">Admin</span>' : ''}</strong>
              <time>${escapeHtml(formatDate(reply.created_at, true))}</time>
              <button type="button" class="danger-button" data-delete-reply="${Number(reply.id)}">Delete</button>
            </div>
            <p>${escapeHtml(reply.comment)}</p>
          </div>`).join('')}
      </article>`).join('') || '<p class="review-loading">No reviews for this product yet.</p>';
    const commentCount = data.reviews.reduce((total, review) => total + (review.comment ? 1 : 0) + review.replies.length, 0);
    $('reviews-modal-count').textContent = `${data.reviews.length} rating${data.reviews.length === 1 ? '' : 's'} · ${commentCount} comment${commentCount === 1 ? '' : 's'}`;
  } catch (error) {
    body.innerHTML = `<p class="review-error">${escapeHtml(error.message)}</p>`;
    $('reviews-modal-count').textContent = '';
  }
}

async function deleteProductReview(id) {
  if (!window.confirm('Delete this product review?')) return;
  try {
    await api(`/reviews/${id}`, { method: 'DELETE' });
    await Promise.all([loadData(), loadProductReviews()]);
    showNotice('Review deleted.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function deleteProductReply(id) {
  if (!window.confirm('Delete this reply?')) return;
  try {
    await api(`/replies/${id}`, { method: 'DELETE' });
    await Promise.all([loadData(), loadProductReviews()]);
    showNotice('Reply deleted.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderUsers() {
  const query = state.search.toLowerCase();
  const users = state.users.filter((user) => [user.full_name, user.username, user.email, user.phone, user.role].join(' ').toLowerCase().includes(query));
  $('user-count').textContent = `${state.users.length} accounts`;
  $('users-body').innerHTML = users.map((user) => `
    <tr><td><div class="customer-cell"><strong>${escapeHtml(user.full_name || user.username)}</strong><small>${escapeHtml(user.role)}</small></div></td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.phone || '—')}</td><td>${escapeHtml(formatDate(user.created_at))}</td>
      <td><span class="status-badge ${Number(user.is_verified) ? 'status-verified' : 'status-unverified'}">${Number(user.is_verified) ? 'Verified' : 'Unverified'}</span></td>
      <td>${!Number(user.is_verified) && user.role === 'user' ? `<div class="inline-actions"><button type="button" data-send-otp="${Number(user.id)}">Email code</button><button type="button" data-remove-user="${Number(user.id)}">Remove</button></div>` : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">No matching accounts.</td></tr>';
  $('users-foot').textContent = `${users.length} accounts shown`;
  const pending = state.otps.filter((entry) => !query || [entry.username, entry.email].join(' ').toLowerCase().includes(query));
  $('otp-list').innerHTML = pending.map((entry) => `
    <div class="otp-row"><span><strong>${escapeHtml(entry.username)}</strong><small>${escapeHtml(entry.email)}</small></span><span class="otp-code">${Number(entry.active) ? 'Code active' : 'No active code'}</span><span class="status-badge ${Number(entry.active) ? 'status-approved' : 'status-unverified'}">${Number(entry.active) ? 'Active' : 'Expired'}</span></div>`).join('') || '<div class="empty-state">No accounts awaiting verification.</div>';
}

const RIDER_LABEL = { pending: 'Pending', approved: 'Active rider', rejected: 'Rejected' };
const RIDER_CLASS = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-declined' };

function renderRiderBadge() {
  const pending = state.riders.filter((r) => r.rider_status === 'pending').length;
  const badge = $('riders-badge');
  badge.hidden = !pending;
  badge.textContent = pending;
}

function renderRiders() {
  const query = state.search.toLowerCase();
  const order = { pending: 0, approved: 1, rejected: 2 };
  const riders = state.riders
    .filter((r) => [r.full_name, r.username, r.email, r.phone, r.vehicle_type, r.plate_number].join(' ').toLowerCase().includes(query))
    .sort((a, b) => (order[a.rider_status] ?? 3) - (order[b.rider_status] ?? 3));
  const pending = state.riders.filter((r) => r.rider_status === 'pending').length;
  $('rider-pending-count').textContent = `${pending} pending`;
  $('riders-body').innerHTML = riders.map((r) => {
    const id = Number(r.id);
    const actions = r.rider_status === 'pending'
      ? `<button type="button" data-rider-action="approve" data-rider-id="${id}">Approve</button><button type="button" data-rider-action="reject" data-rider-id="${id}">Reject</button>`
      : r.rider_status === 'approved'
        ? `<button type="button" data-rider-action="revoke" data-rider-id="${id}">Remove access</button>`
        : `<button type="button" data-rider-action="approve" data-rider-id="${id}">Approve</button>`;
    return `<tr>
      <td><div class="customer-cell"><strong>${escapeHtml(r.full_name || r.username)}</strong><small>${escapeHtml(r.email)}</small></div></td>
      <td>${escapeHtml(r.phone || '—')}</td>
      <td>${escapeHtml(r.vehicle_type || '—')}${r.plate_number ? `<br><small>${escapeHtml(r.plate_number)}</small>` : ''}</td>
      <td>${escapeHtml(formatDate(r.rider_applied_at))}</td>
      <td><span class="status-badge ${RIDER_CLASS[r.rider_status] || 'status-pending'}">${escapeHtml(RIDER_LABEL[r.rider_status] || r.rider_status)}</span></td>
      <td><div class="inline-actions">${actions}</div></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">No rider applications yet. Customers can apply by choosing "Rider" when they sign up.</td></tr>';
  $('riders-foot').textContent = `${riders.length} ${riders.length === 1 ? 'rider' : 'riders'}`;
}

async function riderAction(id, action) {
  const rider = state.riders.find((r) => r.id === id);
  if (!rider) return;
  const text = {
    approve: [`Approve ${rider.username} as a rider?`, `${rider.username} is now a rider.`],
    reject: [`Reject ${rider.username}'s application?`, 'Application rejected.'],
    revoke: [`Remove rider access for ${rider.username}?`, 'Rider access removed.']
  }[action];
  if (!window.confirm(text[0])) return;
  try {
    await api(`/admin/riders/${id}/${action}`, { method: 'POST', body: {} });
    await loadData();
    showNotice(text[1]);
  } catch (error) {
    showNotice(error.message, true);
  }
}

function getReportRows() {
  const totals = new Map();
  for (const order of eligibleOrders()) {
    for (const item of order.items || []) {
      const current = totals.get(item.product_id) || { name: item.name, units: 0, orders: 0, revenue: 0 };
      current.units += Number(item.quantity || 0);
      current.orders += 1;
      current.revenue += Number(item.quantity || 0) * Number(item.unit_price || 0);
      totals.set(item.product_id, current);
    }
  }
  return [...totals.values()].sort((a, b) => b.units - a.units);
}

function renderReports() {
  const reportRows = getReportRows();
  const totalUnits = reportRows.reduce((sum, row) => sum + row.units, 0);
  const gross = eligibleOrders().reduce((sum, order) => sum + Number(order.total || 0), 0);
  const average = eligibleOrders().length ? gross / eligibleOrders().length : 0;
  const cards = [
    ['Net order value', money(gross)],
    ['Orders', eligibleOrders().length.toLocaleString()],
    ['Units sold', totalUnits.toLocaleString()],
    ['Average order', money(average)]
  ];
  $('report-cards').innerHTML = cards.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('report-body').innerHTML = reportRows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.units.toLocaleString()}</td><td>${row.orders.toLocaleString()}</td><td>${money(row.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No order data to report.</td></tr>';
}

function renderSettings() {
  $('settings-username').textContent = state.user.username || '—';
  $('settings-email').textContent = state.user.email || '—';
}

function exportCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportOrders() {
  const rows = [['Order ID', 'Customer', 'Email', 'Phone', 'Date', 'Status', 'Payment', 'Subtotal', 'Discount', 'Total', 'Items']];
  for (const order of state.orders) {
    rows.push([order.id, order.shipping_name, order.email, order.shipping_phone, order.created_at, statusName(order.status), isPaid(order) ? 'Paid' : 'Unpaid',
      order.subtotal, order.discount_amount, order.total,
      (order.items || []).map((item) => `${item.name} x${item.quantity}`).join('; ')]);
  }
  exportCsv('quazar-orders.csv', rows);
}

function openProductModal(product = null) {
  $('product-form').reset();
  $('product-error').textContent = '';
  $('product-id').value = product?.id || '';
  $('product-modal-title').textContent = product ? 'Edit product' : 'Add product';
  $('product-name').value = product?.name || '';
  $('product-category').innerHTML = state.categories.map((category) => `<option value="${Number(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  if (product) $('product-category').value = product.category_id;
  $('product-brand').value = product?.brand || '';
  $('product-price').value = product?.price ?? '';
  $('product-stock').value = product?.stock ?? '';
  $('product-description').value = product?.description || '';
  $('product-image').value = product?.image || '';
  $('product-active').checked = product ? Boolean(Number(product.is_active)) : true;
  $('product-featured').checked = product ? Boolean(Number(product.is_featured)) : true;
  $('product-members').checked = Boolean(Number(product?.members_only));
  $('product-modal').hidden = false;
  $('product-name').focus();
}

function closeProductModal() {
  $('product-modal').hidden = true;
  $('product-form').reset();
}

async function uploadSelectedImage(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
  const result = await api('/admin/upload', { method: 'POST', body: { data, name: file.name } });
  $('product-image').value = result.image;
}

async function saveProduct(event) {
  event.preventDefault();
  $('product-error').textContent = '';
  const saveButton = $('product-form').querySelector('[type="submit"]');
  saveButton.disabled = true;
  try {
    if (state.uploadPromise) await state.uploadPromise;
    const body = {
      name: $('product-name').value.trim(),
      category_id: Number($('product-category').value),
      brand: $('product-brand').value.trim(),
      description: $('product-description').value.trim(),
      price: Number($('product-price').value),
      stock: Number($('product-stock').value),
      image: $('product-image').value.trim(),
      is_active: $('product-active').checked,
      is_featured: $('product-featured').checked,
      members_only: $('product-members').checked
    };
    const id = $('product-id').value;
    if (id) await api(`/admin/products/${id}`, { method: 'PATCH', body });
    else await api('/admin/products', { method: 'POST', body });
    await loadData();
    closeProductModal();
    showNotice(id ? 'Product updated.' : 'Product added.');
  } catch (error) {
    $('product-error').textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function patchOrder(id, patch, confirmText, doneText) {
  const order = state.orders.find((entry) => entry.id === id);
  if (!order || !window.confirm(confirmText)) return;
  try {
    const updated = await api(`/admin/orders/${id}`, { method: 'PATCH', body: patch });
    state.orders = state.orders.map((entry) => entry.id === id ? updated : entry);
    renderCurrentView();
    showNotice(doneText);
  } catch (error) {
    showNotice(error.message, true);
  }
}

function updateOrderStatus(id, status) {
  if (!ORDER_STATUSES.includes(status) || status === 'pending') return;
  const text = {
    approved: ['Approve', `Order #QZ-${id} approved.`],
    declined: ['Decline', `Order #QZ-${id} declined.`],
    shipped: ['Mark as out for delivery', `Order #QZ-${id} is out for delivery. The customer will see it under "To receive".`],
    delivered: ['Mark as arrived', `Order #QZ-${id} marked as arrived.`]
  }[status];
  return patchOrder(id, { status }, `${text[0]} order #QZ-${id}?`, text[1]);
}

function updateOrderPayment(id) {
  return patchOrder(id, { payment_status: 'paid' }, `Mark order #QZ-${id} as paid?`, `Order #QZ-${id} marked as paid.`);
}

async function assignRider(orderId, riderId) {
  if (!riderId) return showNotice('Choose a rider first.', true);
  const rider = state.riders.find((entry) => Number(entry.id) === riderId);
  if (!window.confirm(`Assign order #QZ-${orderId} to ${rider ? rider.full_name || rider.username : 'this rider'}?`)) return;
  try {
    const updated = await api(`/admin/orders/${orderId}/assign`, { method: 'POST', body: { rider_id: riderId } });
    state.orders = state.orders.map((order) => Number(order.id) === orderId ? updated : order);
    await loadData();
    showNotice(`Order #QZ-${orderId} assigned to ${updated.rider_name}.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function updateProductVisibility(id) {
  const product = state.products.find((entry) => entry.id === id);
  if (!product) return;
  try {
    await api(`/admin/products/${id}`, { method: 'PATCH', body: { is_active: !Number(product.is_active) } });
    await loadData();
    showNotice(Number(product.is_active) ? 'Product archived.' : 'Product restored.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function issueOtp(id) {
  try {
    const result = await api(`/admin/users/${id}/otp`, { method: 'POST', body: {} });
    await loadData();
    showNotice(result.message);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function removeUser(id) {
  const user = state.users.find((entry) => entry.id === id);
  if (!user || !window.confirm(`Remove unverified account ${user.username}?`)) return;
  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    await loadData();
    showNotice('Unverified account removed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function loadData() {
  const [orders, products, categories, users, otps, riders] = await Promise.all([
    api('/admin/orders'), api('/admin/products'), api('/admin/categories'), api('/admin/users'), api('/admin/otps'),
    api('/admin/riders')
  ]);
  state.riders = riders;
  state.orders = orders;
  state.products = products;
  state.categories = categories;
  state.users = users;
  state.otps = otps;
  if (!state.orders.some((order) => order.id === state.selectedOrder)) state.selectedOrder = state.orders[0]?.id ?? null;
  renderCurrentView();
}

function bindEvents() {
  document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-open-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.openView)));
  $('global-search').addEventListener('input', (event) => {
    state.search = event.target.value.trim();
    renderCurrentView();
  });
  $('global-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && state.view === 'dashboard' && state.search) setView('orders');
  });
  $('menu-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.querySelectorAll('[data-order-filter]').forEach((button) => button.addEventListener('click', () => {
    state.orderFilter = button.dataset.orderFilter;
    document.querySelectorAll('[data-order-filter]').forEach((tab) => tab.classList.toggle('active', tab === button));
    renderOrders();
  }));
  $('orders-body').addEventListener('click', (event) => {
    const row = event.target.closest('[data-order-id]');
    if (!row) return;
    state.selectedOrder = Number(row.dataset.orderId);
    renderOrders();
  });
  $('order-detail').addEventListener('click', (event) => {
    const button = event.target.closest('[data-update-order]');
    if (button) updateOrderStatus(Number(button.dataset.orderId), button.dataset.updateOrder);
    const pay = event.target.closest('[data-update-payment]');
    if (pay) updateOrderPayment(Number(pay.dataset.orderId));
    const assign = event.target.closest('[data-assign-order]');
    if (assign) assignRider(Number(assign.dataset.assignOrder), Number($('assign-rider').value));
  });
  $('products-body').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-product]');
    const toggle = event.target.closest('[data-toggle-product]');
    const viewReviews = event.target.closest('[data-view-reviews]');
    if (edit) openProductModal(state.products.find((product) => product.id === Number(edit.dataset.editProduct)));
    if (toggle) updateProductVisibility(Number(toggle.dataset.toggleProduct));
    if (viewReviews) openReviewsModal(Number(viewReviews.dataset.viewReviews));
  });
  $('reviews-modal-close').addEventListener('click', () => { $('reviews-modal').hidden = true; });
  $('reviews-modal').addEventListener('click', (event) => {
    if (event.target === $('reviews-modal')) $('reviews-modal').hidden = true;
    const reviewButton = event.target.closest('[data-delete-review]');
    const replyButton = event.target.closest('[data-delete-reply]');
    if (reviewButton) deleteProductReview(Number(reviewButton.dataset.deleteReview));
    if (replyButton) deleteProductReply(Number(replyButton.dataset.deleteReply));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('reviews-modal').hidden) $('reviews-modal').hidden = true;
  });
  $('users-body').addEventListener('click', (event) => {
    const issue = event.target.closest('[data-send-otp]');
    const remove = event.target.closest('[data-remove-user]');
    if (issue) issueOtp(Number(issue.dataset.sendOtp));
    if (remove) removeUser(Number(remove.dataset.removeUser));
  });
  $('riders-body').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-rider-action]');
    if (btn) riderAction(Number(btn.dataset.riderId), btn.dataset.riderAction);
  });
  document.querySelectorAll('[data-quick-status]').forEach((button) => button.addEventListener('click', () => {
    const next = state.orders.find((order) => order.status === 'pending');
    if (!next) return showNotice('There are no pending orders.');
    updateOrderStatus(next.id, button.dataset.quickStatus);
  }));
  $('export-dashboard').addEventListener('click', exportOrders);
  $('export-report').addEventListener('click', () => exportCsv('quazar-product-demand.csv', [
    ['Product', 'Units sold', 'Order count', 'Gross sales'],
    ...getReportRows().map((row) => [row.name, row.units, row.orders, row.revenue])
  ]));
  $('add-product').addEventListener('click', () => openProductModal());
  $('close-product-modal').addEventListener('click', closeProductModal);
  $('cancel-product').addEventListener('click', closeProductModal);
  $('product-modal').addEventListener('click', (event) => { if (event.target === $('product-modal')) closeProductModal(); });
  $('product-form').addEventListener('submit', saveProduct);
  $('product-image-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.uploadPromise = uploadSelectedImage(file)
      .then(() => { $('product-error').textContent = ''; })
      .catch((error) => { $('product-error').textContent = error.message; })
      .finally(() => { state.uploadPromise = null; });
  });
  $('logout-button').addEventListener('click', logout);
  $('settings-logout').addEventListener('click', logout);
  window.addEventListener('resize', drawDemandChart);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProductModal(); });
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/';
}

async function init() {
  try {
    state.token = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return showGate('Browser storage is unavailable. Enable local storage and sign in again.');
  }
  if (!state.token) return showGate('Sign in on the storefront with an administrator account to continue.');
  try {
    const result = await api('/me');
    state.user = result.user;
    if (state.user.role !== 'admin') return showGate('This page is available only to administrators.');
    document.querySelector('.admin-shell').hidden = false;
    $('admin-name').textContent = state.user.username || 'Admin';
    $('admin-avatar').textContent = (state.user.username || 'Q').trim().charAt(0).toUpperCase();
    bindEvents();
    await loadData();
    setView('dashboard');
    window.setInterval(async () => {
      try {
        await loadData();
      } catch (refreshError) {
        if (refreshError.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          return showGate('Your session expired. Sign in again with an administrator account.');
        }
        showNotice(refreshError.message, true);
      }
    }, 60_000);
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      return showGate('Your session expired. Sign in again with an administrator account.');
    }
    showGate(error.message, 'Could not load admin');
  }
}

init();