// ---------- footer and navigation info pop-up ----------
const infoModal = document.getElementById('info-modal');
const pages = {
  about: {
    title: 'About Us',
    html: `<p>QuazarTech is a Quezon City-based store for useful tech and gadgets that make everyday routines better.</p>
           <p>Our demand-forecasting approach helps us understand what customers are looking for and plan our collection around emerging trends.</p>
           <p>Explore the latest arrivals and find gear for work, learning, and entertainment.</p>`
  },
  careers: {
    title: 'Careers',
    html: `<p>We’re always interested in hearing from people who care about technology and great customer experiences.</p>
           <p>Send a short introduction and your CV to <a href="mailto:support@quazartech.com">support@quazartech.com</a>.</p>
           <p><i>(EDIT: Confirm the preferred careers contact and current openings.)</i></p>`
  },
  privacy: {
    title: 'Privacy Policy',
    html: `<h4>Information you share</h4>
           <p>We may use the contact and delivery information you provide to respond to questions and process orders.</p>
           <h4>How we use information</h4>
           <p>We use relevant order and browsing activity to operate the store, improve the shopping experience, and understand product demand.</p>
           <h4>Your choices</h4>
           <p>For questions or requests about your information, contact <a href="mailto:support@quazartech.com">support@quazartech.com</a>.</p>
           <p><i>(EDIT: Have this policy reviewed and add the store’s data-retention and customer-rights procedures.)</i></p>`
  },
  terms: {
    title: 'Terms of Service',
    html: `<p>Product descriptions, availability, and prices may change. Prices are displayed in Philippine pesos.</p>
           <p>Use code QUAZAR20 for 20% off through October 31. The promotion may have eligibility requirements or exclusions; check the offer details before placing your order.</p>
           <p>Orders are subject to confirmation and product availability. Shipping, return, and warranty terms are described in their respective sections.</p>
           <p><i>(EDIT: Confirm promotion eligibility and exclusions, and have the complete terms reviewed.)</i></p>`
  },
  contact: {
    title: 'Contact Us',
    html: `<p><b>Location:</b> Quezon City, Philippines</p>
           <p><b>Email:</b> <a href="mailto:support@quazartech.com">support@quazartech.com</a></p>
           <p><b>Phone:</b> <a href="tel:+639000000000">+63 900 000 0000</a></p>
           <p><b>Hours:</b> Monday to Saturday, 9am–6pm</p>
           <p><i>(EDIT: Confirm the promise to reply within 1 business day.)</i></p>`
  },
  shipping: {
    title: 'Shipping Information',
    html: `<p>Enjoy free shipping on orders over ₱2,000.</p>
           <p>Orders may be paid for using VISA, Mastercard, GCash, Maya, or Cash on Delivery (COD), where available.</p>
           <p>Delivery timing and fees depend on your address. We’ll provide tracking information when your order ships.</p>
           <p><i>(EDIT: Add confirmed delivery estimates and shipping fees for orders under ₱2,000.)</i></p>`
  },
  returns: {
    title: 'Returns & Refunds',
    html: `<p>Contact us within 7 days of delivery if your order arrives damaged, incorrect, or otherwise needs attention. Include your order details and photos where relevant.</p>
           <p>We’ll review your request and confirm the available return or refund options. Please keep the item and its packaging until we respond.</p>
           <p><i>(EDIT: Confirm the 7-day return window, eligible conditions, exclusions, and refund processing time before publishing.)</i></p>`
  },
  warranty: {
    title: 'Warranty',
    html: `<p>QuazarTech products include a 1-year warranty against manufacturing defects. Keep your proof of purchase and contact us if you need help with a product issue.</p>
           <p>Email <a href="mailto:support@quazartech.com">support@quazartech.com</a> with your order details and a description of the issue.</p>
           <p><i>(EDIT: Confirm the 1-year warranty duration, coverage, and claim process for each product.)</i></p>`
  },
  faq: {
    title: 'Frequently Asked Questions',
    html: `<details><summary>Where is QuazarTech based?</summary><p>We’re based in Quezon City, Philippines.</p></details>
           <details><summary>Is shipping free?</summary><p>Shipping is free for orders over ₱2,000. Fees may apply to orders below that amount.</p></details>
           <details><summary>What payment methods do you accept?</summary><p>VISA, Mastercard, GCash, Maya, and COD, where available.</p></details>
           <details><summary>How do I use the QUAZAR20 promo?</summary><p>Enter QUAZAR20 at checkout for 20% off through October 31, subject to the promotion’s eligibility and exclusions.</p></details>
           <details><summary>How can I get help with an order?</summary><p>Email <a href="mailto:support@quazartech.com">support@quazartech.com</a> or call <a href="tel:+639000000000">+63 900 000 0000</a>.</p></details>`
  }
};

function openInfo(key) {
  const page = pages[key];
  if (!page) return;
  document.getElementById('info-title').textContent = page.title;
  document.getElementById('info-body').innerHTML = page.html;
  infoModal.classList.add('open');
  infoModal.setAttribute('aria-hidden', 'false');
}

function closeInfo() {
  infoModal.classList.remove('open');
  infoModal.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('[data-info]').forEach((link) =>
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openInfo(link.dataset.info);
  })
);

document.getElementById('info-close').addEventListener('click', closeInfo);
infoModal.addEventListener('click', (event) => {
  if (event.target === infoModal) closeInfo();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeInfo();
});

// ---------- footer shop links: reuse the category strip ----------
document.querySelectorAll('[data-shop]').forEach((link) =>
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (!document.body.classList.contains('logged-in')) {
      document.getElementById('account-link').click();
      return;
    }
    const tab = document.querySelector(`#cat-strip .tab[data-filter="${link.dataset.shop}"]`);
    const applyFilter = () => {
      if (tab) tab.click();
      else document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    };
    if (window.location.hash.startsWith('#account')) {
      window.location.hash = 'products';
      window.setTimeout(applyFilter, 0);
    } else {
      applyFilter();
    }
  })
);
