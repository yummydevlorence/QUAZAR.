// ============================================================
// QuazarTech footer pop-ups
// Load AFTER script.js:  <script src="footer-pages.js"></script>
// Edit the text below. Items marked (EDIT) are placeholder policies
// that you must change to match how your store really works.
// ============================================================

const infoModal = $('info-modal');

const pages = {

  // ---------------- COMPANY ----------------
  about: {
    title: 'About Us',
    html: `
      <p><b>QuazarTech</b> is a Quezon City-based online store for premium tech gear built for your routine: earbuds, speakers, keyboards, phones and laptops.</p>

      <h4>What makes us different</h4>
      <p>We use <b>demand forecasting</b> to see what's trending before it sells out. We track what customers buy, predict next month's demand, and restock early, so the gadgets you want are there when you want them.</p>

      <h4>What we promise</h4>
      <ul>
        <li>Quality tech, carefully picked for everyday use</li>
        <li>Fair prices in Philippine Peso (₱)</li>
        <li>Free shipping on orders over ₱2,000</li>
        <li>Real people ready to help, Mon - Sat, 9am - 6pm</li>
      </ul>

      <p>Smarter gadgets. Easier living.</p>`
  },

  careers: {
    title: 'Careers',
    html: `
      <p>We're a small, growing team in Quezon City that loves tech and data. We don't have open roles listed right now, but we're always happy to meet good people.</p>

      <h4>Roles we may hire for</h4>
      <ul>
        <li>Customer support</li>
        <li>Warehouse and order fulfillment</li>
        <li>Content and social media</li>
        <li>Web and data (inventory and forecasting)</li>
      </ul>

      <h4>How to apply</h4>
      <p>Email your CV and a short note about yourself to
      <a href="mailto:support@quazartech.com?subject=Job%20Application">support@quazartech.com</a>
      with the subject <b>"Job Application"</b>.</p>`
  },

  privacy: {
    title: 'Privacy Policy',
    html: `
      <p><i>Last updated: October 2026</i></p>
      <p>QuazarTech respects your privacy and follows the Philippine Data Privacy Act of 2012 (RA 10173).</p>

      <h4>What we collect</h4>
      <ul>
        <li>Your name, email, phone number and delivery address</li>
        <li>Your order history</li>
        <li>Your email, if you subscribe to our newsletter</li>
      </ul>

      <h4>How we use it</h4>
      <ul>
        <li>To process and deliver your orders</li>
        <li>To send order updates and, if you opted in, offers</li>
        <li>To improve our store and understand which products are in demand (we only use order totals, not your personal details, for forecasting)</li>
      </ul>

      <h4>Sharing</h4>
      <p>We never sell your data. We only share what's needed with couriers and payment providers to complete your order.</p>

      <h4>Your rights</h4>
      <p>You can ask to see, correct or delete your data, or unsubscribe at any time. Email
      <a href="mailto:support@quazartech.com">support@quazartech.com</a>.</p>`
  },

  terms: {
    title: 'Terms of Service',
    html: `
      <p><i>Last updated: October 2026</i></p>

      <h4>1. Using our store</h4>
      <p>By browsing or buying from QuazarTech, you agree to these terms. You must provide accurate information when you sign up or order.</p>

      <h4>2. Prices and payments</h4>
      <p>All prices are in Philippine Peso (₱). We accept VISA, Mastercard, GCash, Maya and Cash on Delivery. Prices and stock may change without notice.</p>

      <h4>3. Promo codes</h4>
      <p>Promo codes such as <b>QUAZAR20</b> are valid only for the dates stated and can't be combined with other offers.</p>

      <h4>4. Orders</h4>
      <p>An order is confirmed once we send you a confirmation. We may cancel an order if an item is out of stock or a price was posted in error, and you'll be refunded in full.</p>

      <h4>5. Shipping, returns and warranty</h4>
      <p>These are covered in our Shipping Information, Returns &amp; Refunds and Warranty pages.</p>

      <h4>6. Contact</h4>
      <p>Questions? <a href="mailto:support@quazartech.com">support@quazartech.com</a></p>`
  },

  // ---------------- CUSTOMER SERVICE ----------------
  contact: {
    title: 'Contact Us',
    html: `
      <p>We're happy to help with orders, products or anything else.</p>

      <h4>Reach us</h4>
      <p>📍 Quezon City, Philippines</p>
      <p>✉️ <a href="mailto:support@quazartech.com">support@quazartech.com</a></p>
      <p>📞 <a href="tel:+639000000000">+63 900 000 0000</a></p>

      <h4>Store hours</h4>
      <p>🕘 Monday - Saturday, 9am - 6pm<br>Closed on Sundays and holidays</p>

      <h4>Tip</h4>
      <p>For faster help with an order, include your <b>order number</b> in your message. We usually reply within 1 business day.</p>`
  },

  shipping: {
    title: 'Shipping Information',
    html: `
      <h4>Free shipping</h4>
      <p>Enjoy <b>free shipping on orders over ₱2,000</b>.</p>

      <h4>Delivery times (EDIT)</h4>
      <ul>
        <li><b>Metro Manila:</b> 2 - 3 business days</li>
        <li><b>Luzon (outside Metro Manila):</b> 3 - 5 business days</li>
        <li><b>Visayas &amp; Mindanao:</b> 5 - 8 business days</li>
      </ul>

      <h4>Shipping fee for orders under ₱2,000 (EDIT)</h4>
      <ul>
        <li>Metro Manila: ₱99</li>
        <li>Provincial: ₱149</li>
      </ul>

      <h4>Processing</h4>
      <p>Orders placed before 2pm on a business day are usually packed the same day. You'll get an email with a tracking number once your order ships.</p>

      <h4>Cash on Delivery</h4>
      <p>COD is available. Please have the exact amount ready when the courier arrives.</p>`
  },

  returns: {
    title: 'Returns & Refunds',
    html: `
      <h4>7-day return window (EDIT)</h4>
      <p>Changed your mind or received the wrong item? Contact us within <b>7 days of delivery</b>.</p>

      <h4>Conditions</h4>
      <ul>
        <li>Item is unused and in its original packaging</li>
        <li>All accessories, manuals and freebies are included</li>
        <li>You have your order number or receipt</li>
      </ul>

      <h4>Damaged or defective items</h4>
      <p>If your item arrives damaged or doesn't work, message us within 7 days with a photo or short video. We'll replace it or refund you, and we'll cover the return shipping.</p>

      <h4>How to return</h4>
      <ol>
        <li>Email <a href="mailto:support@quazartech.com">support@quazartech.com</a> with your order number and reason.</li>
        <li>We'll send you return instructions.</li>
        <li>Once we receive and check the item, we process your refund.</li>
      </ol>

      <h4>Refunds</h4>
      <p>Refunds go back to your original payment method (GCash, Maya or card) within 5 - 10 business days. COD orders are refunded by bank or e-wallet transfer.</p>

      <h4>Non-returnable</h4>
      <p>Opened earbuds (for hygiene) unless defective, and items damaged by misuse.</p>`
  },

  warranty: {
    title: 'Warranty',
    html: `
      <h4>1-year warranty (EDIT)</h4>
      <p>QuazarTech products come with a <b>1-year warranty</b> against manufacturing defects, counted from the delivery date.</p>

      <h4>What's covered</h4>
      <ul>
        <li>Earbuds that won't charge or connect</li>
        <li>Speakers with no sound or battery faults</li>
        <li>Keyboards with unresponsive keys or switches</li>
        <li>Phones and laptops with factory defects</li>
      </ul>

      <h4>What's not covered</h4>
      <ul>
        <li>Drops, cracks, water or liquid damage</li>
        <li>Damage from unofficial repairs</li>
        <li>Normal wear and tear (battery aging, scratches)</li>
      </ul>

      <h4>How to claim</h4>
      <ol>
        <li>Email <a href="mailto:support@quazartech.com">support@quazartech.com</a> with your order number and a short description or video of the problem.</li>
        <li>We'll guide you through troubleshooting.</li>
        <li>If it's a defect, we repair or replace it.</li>
      </ol>

      <p>Please keep your receipt or order email. It's your proof of purchase.</p>`
  },

  faq: {
    title: 'FAQ',
    html: `
      <details>
        <summary>How do I place an order?</summary>
        <p>Log in or sign up, open Products, pick what you like and check out.</p>
      </details>
      <details>
        <summary>Why do I need to log in to see all products?</summary>
        <p>Members get access to the full store, including new arrivals and high-demand items.</p>
      </details>
      <details>
        <summary>What payment methods do you accept?</summary>
        <p>VISA, Mastercard, GCash, Maya and Cash on Delivery.</p>
      </details>
      <details>
        <summary>Is shipping free?</summary>
        <p>Yes, on orders over ₱2,000. Smaller orders have a small shipping fee. See Shipping Information.</p>
      </details>
      <details>
        <summary>How do I use the QUAZAR20 promo code?</summary>
        <p>Enter <b>QUAZAR20</b> at checkout for 20% off. It's valid through Oct. 31.</p>
      </details>
      <details>
        <summary>How can I track my order?</summary>
        <p>We email you a tracking number once your order ships.</p>
      </details>
      <details>
        <summary>What does "High Demand" mean?</summary>
        <p>Our forecasting predicts which products will sell the most next month. High Demand items are popular and may sell out fast.</p>
      </details>
      <details>
        <summary>An item is out of stock. What can I do?</summary>
        <p>Email us and we'll let you know when it's back. Because we forecast demand, popular items are restocked early.</p>
      </details>
      <details>
        <summary>Can I return or exchange an item?</summary>
        <p>Yes, within 7 days of delivery. See Returns &amp; Refunds.</p>
      </details>
      <details>
        <summary>Do you ship nationwide?</summary>
        <p>Yes, we deliver across the Philippines.</p>
      </details>`
  }
};

// ---------- open / close ----------
function openInfo(key) {
  const page = pages[key];
  if (!page) return;
  $('info-title').textContent = page.title;
  $('info-body').innerHTML = page.html;
  infoModal.classList.add('open');
  infoModal.setAttribute('aria-hidden', 'false');
  $('info-body').scrollTop = 0;
}
function closeInfo() {
  infoModal.classList.remove('open');
  infoModal.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('[data-info]').forEach(link =>
  link.addEventListener('click', (e) => {
    e.preventDefault();
    openInfo(link.dataset.info);
  }));

$('info-close').addEventListener('click', closeInfo);
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) closeInfo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });

// ---------- footer shop links reuse the category strip ----------
document.querySelectorAll('[data-shop]').forEach(link =>
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = document.querySelector(`#cat-strip .tab[data-filter="${link.dataset.shop}"]`);
    if (tab) tab.click();
  }));