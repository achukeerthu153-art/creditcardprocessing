/* app.js — LUXE SHOP Frontend Logic */
'use strict';

/* ═══════════════════ STATE ═══════════════════ */
let USER = null;
let CARDS = [];
let PRODUCTS = [];
let CART = {}; // productId -> {product, qty}

/* ═══════════════════ UTILITIES ═══════════════════ */
const $ = id => document.getElementById(id);
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function toast(msg, dur = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`${name}Page`).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === name);
  });
  if (name === 'orders') loadOrders();
  if (name === 'transactions') loadTransactions();
  if (name === 'profile') loadProfile();
}

function openModal(id) { $(id).classList.add('open') }
function closeModal(id) { $(id).classList.remove('open') }

/* ═══════════════════ DIGIT-BOX INPUTS ═══════════════════
   Creates individual digit input boxes like PIN / CVV.
   count: number of digits
   container: DOM element to render into
   Returns getValue() function
═════════════════════════════════════════════════════════*/
function createDigitInput(container, count, { separator, password = true } = {}) {
  container.innerHTML = '';
  const inputs = [];

  for (let i = 0; i < count; i++) {
    const inp = document.createElement('input');
    inp.type = 'tel';
    inp.maxLength = 1;
    inp.className = 'digit-box';
    inp.inputMode = 'numeric';
    inp.autocomplete = 'off';
    if (password) inp.style['-webkit-text-security'] = 'disc';

    inp.addEventListener('input', e => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 1);
      if (inp.value) {
        inp.classList.add('filled');
        if (i < count - 1) inputs[i + 1].focus();
      } else {
        inp.classList.remove('filled');
      }
    });

    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !inp.value && i > 0) {
        inputs[i - 1].value = '';
        inputs[i - 1].classList.remove('filled');
        inputs[i - 1].focus();
      }
    });

    inp.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
      pasted.split('').forEach((ch, idx) => {
        if (inputs[idx]) {
          inputs[idx].value = ch;
          inputs[idx].classList.add('filled');
        }
      });
      const next = Math.min(pasted.length, count - 1);
      inputs[next].focus();
    });

    container.appendChild(inp);
    inputs.push(inp);

    if (separator && i === separator - 1 && i < count - 1) {
      const sep = document.createElement('span');
      sep.className = 'digit-sep';
      sep.textContent = '·';
      container.appendChild(sep);
    }
  }

  return {
    getValue: () => inputs.map(i => i.value).join(''),
    clear: () => inputs.forEach(i => { i.value = ''; i.classList.remove('filled'); }),
    focus: () => inputs[0].focus()
  };
}

/* ═══════════════════ AUTH ═══════════════════ */
$('tabLogin').addEventListener('click', () => {
  $('tabLogin').classList.add('active');
  $('tabReg').classList.remove('active');
  $('loginForm').classList.add('active');
  $('regForm').classList.remove('active');
});
$('tabReg').addEventListener('click', () => {
  $('tabReg').classList.add('active');
  $('tabLogin').classList.remove('active');
  $('regForm').classList.add('active');
  $('loginForm').classList.remove('active');
});

$('loginBtn').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPass').value;
  if (!email || !pass) return toast('Please fill all fields');
  const res = await API.post('/api/login', { email, password: pass });
  if (res.error) return toast(res.error);
  onLogin(res.user);
});
$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click() });

$('regBtn').addEventListener('click', async () => {
  const name  = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const pass  = $('regPass').value;
  if (!name || !email || !pass) return toast('All fields required');
  const res = await API.post('/api/register', { name, email, password: pass });
  if (res.error) return toast(res.error);
  toast('Account created! Please sign in.');
  $('tabLogin').click();
  $('loginEmail').value = email;
});

async function onLogin(user) {
  USER = user;
  $('navUser').textContent = user.name;
  $('logoutBtn').style.display = 'inline-flex';
  $('navLinks').style.display = 'flex';
  await fetchCards();
  await fetchProducts();
  showPage('shop');
  $('authPage').classList.remove('active');
}

$('logoutBtn').addEventListener('click', () => {
  USER = null; CARDS = []; CART = {};
  $('navUser').textContent = '';
  $('logoutBtn').style.display = 'none';
  $('cartCount').textContent = '0';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('authPage').classList.add('active');
});

/* ═══════════════════ PRODUCTS ═══════════════════ */
async function fetchProducts() {
  const res = await API.get('/api/products');
  PRODUCTS = res.products || [];
  renderProducts();
}

function renderProducts() {
  const grid = $('productsGrid');
  if (!PRODUCTS.length) { grid.innerHTML = '<p class="empty-state">No products available</p>'; return; }
  grid.innerHTML = PRODUCTS.map(p => {
    const inCart = CART[p.id]?.qty > 0;
    return `
    <div class="product-card">
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-tag">${p.tag}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-desc">${p.description || ''}</div>
      <div class="product-stock">${p.stock} in stock</div>
      <div class="product-footer">
        <div class="product-price">${fmt(p.price)}</div>
        <button class="btn-add ${inCart ? 'in-cart' : ''}" data-id="${p.id}">
          ${inCart ? '✓ Added' : '+ Add'}
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', () => addToCart(parseInt(btn.dataset.id)));
  });
}

/* ═══════════════════ CART ═══════════════════ */
function addToCart(pid) {
  const p = PRODUCTS.find(x => x.id === pid);
  if (!p) return;
  if (CART[pid]) { CART[pid].qty++ } else { CART[pid] = { product: p, qty: 1 }; }
  updateCartBadge();
  renderProducts();
  renderCartItems();
  toast(`${p.name} added`);
}

function updateCartBadge() {
  const total = Object.values(CART).reduce((s, x) => s + x.qty, 0);
  $('cartCount').textContent = total;
}

$('cartBtn').addEventListener('click', () => {
  $('cartPanel').classList.add('open');
  $('cartBackdrop').classList.add('open');
  renderCartItems();
});
$('closeCart').addEventListener('click', closeCartPanel);
$('cartBackdrop').addEventListener('click', closeCartPanel);

function closeCartPanel() {
  $('cartPanel').classList.remove('open');
  $('cartBackdrop').classList.remove('open');
}

function renderCartItems() {
  const container = $('cartItems');
  const items = Object.values(CART).filter(x => x.qty > 0);
  if (!items.length) {
    container.innerHTML = '<div class="cart-empty">Your selection is empty</div>';
    $('cartFooter').style.display = 'none';
    return;
  }
  container.innerHTML = items.map(({ product: p, qty }) => `
    <div class="cart-item" data-id="${p.id}">
      <div class="cart-item-emoji">${p.emoji}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${p.name}</div>
        <div class="cart-item-price">${fmt(p.price)}</div>
        <div class="cart-item-controls">
          <button class="qty-btn" data-action="dec" data-id="${p.id}">−</button>
          <span class="qty-num">${qty}</span>
          <button class="qty-btn" data-action="inc" data-id="${p.id}">+</button>
        </div>
      </div>
      <button class="cart-item-remove" data-id="${p.id}">✕</button>
    </div>`).join('');

  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'inc') CART[pid].qty++;
      else { CART[pid].qty--; if (CART[pid].qty <= 0) delete CART[pid]; }
      updateCartBadge(); renderCartItems(); renderProducts();
    });
  });
  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      delete CART[parseInt(btn.dataset.id)];
      updateCartBadge(); renderCartItems(); renderProducts();
    });
  });

  // Summary
  const subtotal = items.reduce((s, { product: p, qty }) => s + p.price * qty, 0);
  const ship = subtotal > 5000 ? 0 : 99;
  const tax  = subtotal * 0.18;
  const total = subtotal + ship + tax;
  $('cartSummary').innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="summary-row"><span>Shipping</span><span>${ship === 0 ? 'Free' : fmt(ship)}</span></div>
    <div class="summary-row"><span>GST (18%)</span><span>${fmt(tax)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${fmt(total)}</span></div>`;
  $('cartFooter').style.display = 'block';
}

/* ═══════════════════ CHECKOUT ═══════════════════ */
let checkoutPinCtrl = null;

$('proceedCheckout').addEventListener('click', () => {
  if (!USER) return toast('Please sign in');
  const items = Object.values(CART).filter(x => x.qty > 0);
  if (!items.length) return toast('Cart is empty');
  closeCartPanel();
  openCheckoutModal();
});

function openCheckoutModal() {
  const items = Object.values(CART).filter(x => x.qty > 0);
  const subtotal = items.reduce((s, { product: p, qty }) => s + p.price * qty, 0);
  const ship = subtotal > 5000 ? 0 : 99;
  const tax  = Math.round(subtotal * 0.18 * 100) / 100;
  const total = subtotal + ship + tax;

  // Items
  $('checkoutItems').innerHTML = items.map(({ product: p, qty }) =>
    `<div class="co-item"><span>${p.emoji} ${p.name} × ${qty}</span><span>${fmt(p.price * qty)}</span></div>`
  ).join('');

  // Totals
  $('checkoutTotals').innerHTML = `
    <div class="co-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="co-row"><span>Shipping</span><span>${ship === 0 ? 'Free' : fmt(ship)}</span></div>
    <div class="co-row"><span>GST 18%</span><span>${fmt(tax)}</span></div>
    <div class="co-row grand"><span>Total</span><span>${fmt(total)}</span></div>`;

  // PIN input
  checkoutPinCtrl = createDigitInput($('checkoutPinRow'), 4);

  renderCardList();
  updateCheckoutUI();
  openModal('checkoutOverlay');
}

function renderCardList() {
  const method = document.querySelector('input[name="payMethod"]:checked')?.value;
  const list = $('cardList');
  const filtered = CARDS.filter(c => c.card_type === method);
  if (!filtered.length) {
    list.innerHTML = '<p style="font-size:.82rem;color:var(--muted)">No ' + method + ' cards saved.</p>';
    return;
  }
  list.innerHTML = filtered.map((c, i) => `
    <label class="co-card-item ${i === 0 ? 'selected' : ''}" data-id="${c.id}">
      <input type="radio" name="selectedCard" value="${c.id}" ${i === 0 ? 'checked' : ''}/>
      <div class="co-card-details">
        <div class="co-card-name">${c.card_holder} · •••• ${c.last4}</div>
        <div class="co-card-meta">${c.card_network} ${c.card_type} · ${c.bank_name} · Expires ${c.expiry}</div>
        <div class="co-card-meta" style="margin-top:.25rem">
          Monthly left: <strong>${fmt(c.monthly_remaining)}</strong>
          &nbsp;·&nbsp; Balance: <strong>${fmt(c.balance)}</strong>
        </div>
      </div>
    </label>`).join('');

  list.querySelectorAll('.co-card-item').forEach(item => {
    item.addEventListener('click', () => {
      list.querySelectorAll('.co-card-item').forEach(x => x.classList.remove('selected'));
      item.classList.add('selected');
      updateCheckoutUI();
    });
  });
}

function updateCheckoutUI() {
  const method = document.querySelector('input[name="payMethod"]:checked')?.value;
  const isCard = method === 'credit' || method === 'debit';
  $('cardSection').style.display   = isCard ? 'block' : 'none';
  $('emiSection').style.display    = method === 'credit' ? 'block' : 'none';
  $('pinSection').style.display    = isCard ? 'block' : 'none';
  if (!isCard && checkoutPinCtrl) checkoutPinCtrl.clear();
  updateEmiPreview();
}

document.querySelectorAll('input[name="payMethod"]').forEach(r => {
  r.addEventListener('change', () => { renderCardList(); updateCheckoutUI(); });
});

function updateEmiPreview() {
  const months = parseInt(document.querySelector('input[name="emiMonths"]:checked')?.value || '0');
  const items = Object.values(CART).filter(x => x.qty > 0);
  const subtotal = items.reduce((s, { product: p, qty }) => s + p.price * qty, 0);
  const ship = subtotal > 5000 ? 0 : 99;
  const tax  = Math.round(subtotal * 0.18 * 100) / 100;
  const total = subtotal + ship + tax;
  const prev = $('emiPreview');
  if (months === 0) { prev.innerHTML = '<div class="emi-stat"><span>Full payment</span><span>' + fmt(total) + '</span></div>'; return; }
  const rate = { 3: 1.0, 6: 1.5, 9: 1.75, 12: 2.0 }[months] / 100;
  const interest = Math.round(total * rate * months * 100) / 100;
  const grand = total + interest;
  const monthly = Math.round(grand / months * 100) / 100;
  prev.innerHTML = `
    <div class="emi-stat"><span>Principal</span><span>${fmt(total)}</span></div>
    <div class="emi-stat"><span>Total Interest</span><span>${fmt(interest)}</span></div>
    <div class="emi-stat"><span>Monthly EMI</span><span>${fmt(monthly)}</span></div>
    <div class="emi-stat"><span>Total Payable</span><span>${fmt(grand)}</span></div>`;
}

document.querySelectorAll('input[name="emiMonths"]').forEach(r => {
  r.addEventListener('change', updateEmiPreview);
});

$('closeCheckout').addEventListener('click', () => closeModal('checkoutOverlay'));

$('placeOrderBtn').addEventListener('click', async () => {
  const method  = document.querySelector('input[name="payMethod"]:checked')?.value;
  const cardId  = parseInt(document.querySelector('input[name="selectedCard"]:checked')?.value || '0') || null;
  const emiMo   = parseInt(document.querySelector('input[name="emiMonths"]:checked')?.value || '0');
  const pin     = checkoutPinCtrl ? checkoutPinCtrl.getValue() : '';

  const items = Object.values(CART).filter(x => x.qty > 0).map(({ product: p, qty }) => ({
    product_id: p.id, qty
  }));

  // PIN verify for credit cards
  if (method === 'credit' && cardId) {
    const card = CARDS.find(c => c.id === cardId);
    if (card?.has_pin) {
      if (pin.length !== 4) return toast('Please enter your 4-digit PIN');
      const vRes = await API.post(`/api/cards/${cardId}/verify-pin`, { user_id: USER.id, pin });
      if (!vRes.verified) return toast('Incorrect PIN. Please try again.');
    }
  }

  const payload = {
    user_id: USER.id, card_id: cardId, items,
    payment_method: method, emi_months: emiMo
  };

  $('placeOrderBtn').textContent = 'Processing…';
  $('placeOrderBtn').disabled = true;
  const res = await API.post('/api/checkout', payload);
  $('placeOrderBtn').textContent = 'Place Order';
  $('placeOrderBtn').disabled = false;

  if (res.error) { toast(res.error); return; }

  closeModal('checkoutOverlay');
  if (checkoutPinCtrl) checkoutPinCtrl.clear();
  showResult(res);

  if (res.status === 'APPROVED') {
    CART = {};
    updateCartBadge();
    renderProducts();
    await fetchCards();
  }
});

function showResult(res) {
  const approved = res.status === 'APPROVED';
  const body = $('resultBody');
  body.innerHTML = `
    <div class="result-icon">${approved ? '✦' : '✕'}</div>
    <div class="result-title" style="color:var(--${approved ? 'approved' : 'declined'})">
      ${approved ? 'Order Placed!' : 'Payment Declined'}
    </div>
    <div class="result-ref">${res.txn_ref}</div>
    <div class="result-amount">${fmt(res.charge)}</div>
    ${!approved ? `<div class="result-decline-reason">${res.decline_reason}</div>` : ''}
    ${approved && res.emi_months > 0 ? `
      <div class="result-emi-info">
        EMI: ${fmt(res.emi_monthly_amount)} × ${res.emi_months} months
        &nbsp;·&nbsp; Interest: ${fmt(res.emi_interest)}
      </div>` : ''}
    <button class="btn-primary" onclick="closeModal('resultOverlay')">
      ${approved ? 'Continue Shopping' : 'Try Again'}
    </button>`;
  openModal('resultOverlay');
}

/* ═══════════════════ CARDS ═══════════════════ */
async function fetchCards() {
  if (!USER) return;
  const res = await API.get(`/api/cards/${USER.id}`);
  CARDS = res.cards || [];
}

/* ═══════════════════ ADD CARD MODAL ═══════════════════ */
let cvvCtrl = null;

$('addCardBtn').addEventListener('click', () => {
  cvvCtrl = createDigitInput($('cvvRow'), 3);
  formatCardNumberInput();
  openModal('addCardOverlay');
});
$('closeAddCard').addEventListener('click', () => closeModal('addCardOverlay'));

function formatCardNumberInput() {
  const inp = $('newCardNumber');
  inp.addEventListener('input', () => {
    let v = inp.value.replace(/\D/g, '').slice(0, 16);
    inp.value = v.replace(/(.{4})/g, '$1 ').trim();
  });
}

$('saveCardBtn').addEventListener('click', async () => {
  const holder  = $('newCardHolder').value.trim();
  const number  = $('newCardNumber').value.replace(/\s/g, '');
  const expiry  = $('newCardExpiry').value.trim();
  const cvv     = cvvCtrl ? cvvCtrl.getValue() : '';
  const ctype   = $('newCardType').value;
  const network = $('newCardNetwork').value;
  const bank    = $('newBankName').value.trim();
  const climit  = parseFloat($('newCreditLimit').value) || 100000;
  const mlimit  = parseFloat($('newMonthlyLimit').value) || 50000;

  if (!holder || !number || !expiry) return toast('Card holder, number and expiry required');
  if (number.length < 12) return toast('Enter a valid card number');
  if (ctype === 'credit' && cvv.length < 3) return toast('Enter 3-digit CVV');

  const res = await API.post('/api/cards', {
    user_id: USER.id, card_holder: holder, card_number: number,
    expiry, card_type: ctype, card_network: network, bank_name: bank,
    credit_limit: climit, monthly_limit: mlimit
  });
  if (res.error) return toast(res.error);
  toast('Card saved successfully');
  closeModal('addCardOverlay');
  await fetchCards();
  loadProfile();
});

/* ═══════════════════ SET PIN MODAL ═══════════════════ */
let setPinCardId = null;
let setPinCtrl   = null;

function openSetPin(cardId) {
  setPinCardId = cardId;
  const card = CARDS.find(c => c.id === cardId);
  $('setPinCardLabel').textContent = card
    ? `${card.card_network} •••• ${card.last4} — ${card.bank_name}` : '';
  setPinCtrl = createDigitInput($('setPinRow'), 4);
  setTimeout(() => setPinCtrl.focus(), 100);
  openModal('setPinOverlay');
}

$('closeSetPin').addEventListener('click', () => closeModal('setPinOverlay'));

$('confirmSetPin').addEventListener('click', async () => {
  const pin = setPinCtrl ? setPinCtrl.getValue() : '';
  if (pin.length !== 4) return toast('Enter a 4-digit PIN');
  const res = await API.post(`/api/cards/${setPinCardId}/set-pin`, {
    user_id: USER.id, pin
  });
  if (res.error) return toast(res.error);
  toast('PIN set successfully!');
  closeModal('setPinOverlay');
  await fetchCards();
  loadProfile();
});

/* ═══════════════════ ORDERS ═══════════════════ */
async function loadOrders() {
  const res = await API.get(`/api/orders/${USER.id}`);
  const orders = res.orders || [];
  const el = $('ordersList');
  if (!orders.length) { el.innerHTML = '<p class="empty-state">No orders yet</p>'; return; }
  el.innerHTML = orders.map(o => `
    <div class="order-card">
      <div class="order-head">
        <div>
          <div class="order-id">Order #${o.id}</div>
          <div class="order-date">${new Date(o.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</div>
        </div>
        <span class="order-status status-${o.status.toLowerCase()}">${o.status}</span>
      </div>
      <div class="order-items-list">
        ${(o.items || []).map(i => `<span class="order-item-chip">${i.emoji} ${i.name} ×${i.qty}</span>`).join('')}
      </div>
      <div class="order-foot">
        <div>
          <div class="order-total">${fmt(o.total)}</div>
          ${o.emi_months > 0 ? `<div style="font-size:.75rem;color:var(--muted)">EMI: ${fmt(o.emi_monthly_amount)}/mo × ${o.emi_months}</div>` : ''}
        </div>
        <div class="order-pay-info">
          ${o.payment_method.toUpperCase()}
          ${o.card_id ? '· Card on file' : ''}
        </div>
      </div>
    </div>`).join('');
}

/* ═══════════════════ TRANSACTIONS ═══════════════════ */
async function loadTransactions() {
  const res = await API.get(`/api/transactions/${USER.id}`);
  const txns = res.transactions || [];
  const el = $('txnList');
  if (!txns.length) { el.innerHTML = '<p class="empty-state">No transactions yet</p>'; return; }
  el.innerHTML = txns.map(t => `
    <div class="txn-row">
      <div class="txn-status-dot dot-${t.status.toLowerCase()}"></div>
      <div class="txn-main">
        <div class="txn-ref">${t.txn_ref}</div>
        <div class="txn-meta">
          ${new Date(t.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
          ${t.last4 ? `· •••• ${t.last4} (${t.card_network || ''})` : `· ${(t.payment_method || '').toUpperCase()}`}
          ${t.emi_months > 0 ? `· EMI ${t.emi_months}mo` : ''}
        </div>
        ${t.decline_reason ? `<div style="font-size:.75rem;color:var(--declined);margin-top:.2rem">${t.decline_reason}</div>` : ''}
      </div>
      <div>
        <div class="txn-amount">${fmt(t.amount)}</div>
        <div class="txn-status-label txn-${t.status.toLowerCase()}">${t.status}</div>
      </div>
    </div>`).join('');
}

/* ═══════════════════ PROFILE ═══════════════════ */
async function loadProfile() {
  await fetchCards();
  const el = $('profileInfo');
  el.innerHTML = `
    <div class="profile-avatar">${USER.name[0].toUpperCase()}</div>
    <div class="profile-name">${USER.name}</div>
    <div class="profile-email">${USER.email}</div>
    <div class="profile-joined">Member since ${new Date(USER.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>`;

  const cardsEl = $('profileCards');
  if (!CARDS.length) {
    cardsEl.innerHTML = '<p style="font-size:.85rem;color:var(--muted)">No cards saved yet.</p>';
    return;
  }
  cardsEl.innerHTML = CARDS.map(c => {
    const pct = c.credit_limit > 0 ? Math.min(100, (c.monthly_spent / c.monthly_limit) * 100) : 0;
    const danger = pct > 80;
    return `
    <div class="profile-card-tile">
      <div class="pct-top">
        <span class="pct-network">${c.card_network}</span>
        <span class="pct-type">${c.card_type}</span>
      </div>
      <div class="pct-number">•••• •••• •••• ${c.last4}</div>
      <div class="pct-holder">${c.card_holder} · ${c.bank_name} · Exp ${c.expiry}</div>
      <div class="pct-stats">
        <div>
          <div class="pct-stat-label">Balance</div>
          <div class="pct-stat-val">${fmt(c.balance)}</div>
        </div>
        <div>
          <div class="pct-stat-label">Mo. Spent</div>
          <div class="pct-stat-val">${fmt(c.monthly_spent)}</div>
        </div>
        <div>
          <div class="pct-stat-label">Mo. Left</div>
          <div class="pct-stat-val">${fmt(c.monthly_remaining)}</div>
        </div>
      </div>
      <div class="pct-bar-wrap">
        <div class="pct-bar ${danger ? 'danger' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="pct-actions">
        ${c.card_type === 'credit' ? `
          <button class="btn-outline" onclick="openSetPin(${c.id})">
            ${c.has_pin ? '🔒 Change PIN' : '🔓 Set PIN'}
          </button>` : ''}
        <span style="font-size:.75rem;color:var(--muted);align-self:center;margin-left:.25rem">
          Limit ${fmt(c.credit_limit)}
        </span>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════ NAV LINKS ═══════════════════ */
document.querySelectorAll('.nav-link').forEach(l => {
  l.addEventListener('click', e => {
    e.preventDefault();
    if (!USER) return toast('Please sign in first');
    showPage(l.dataset.page);
  });
});

/* ═══════════════════ KEYBOARD SHORTCUTS ═══════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['checkoutOverlay', 'addCardOverlay', 'setPinOverlay', 'resultOverlay'].forEach(closeModal);
    closeCartPanel();
  }
});

/* Init */
$('navLinks').style.display = 'none';
$('logoutBtn').style.display = 'none';

/* ═══════════════════════════════════════════════
   TIER SYSTEM — UI
═══════════════════════════════════════════════ */

const TIER_ICONS  = { CLASSIC:'◈', SILVER:'✦', GOLD:'★', PLATINUM:'◆' };
const TIER_LABELS = { CLASSIC:'Classic', SILVER:'Silver', GOLD:'Gold', PLATINUM:'Platinum' };
const TIER_ORDER  = ['CLASSIC','SILVER','GOLD','PLATINUM'];
const TIER_THRESHOLDS = { CLASSIC:0, SILVER:10000, GOLD:50000, PLATINUM:100000 };

function tierBadge(tier) {
  const t = tier || 'CLASSIC';
  return `<span class="tier-badge tier-${t}">${TIER_ICONS[t]} ${TIER_LABELS[t]}</span>`;
}

function renderTierProgress(progress) {
  if (!progress) return '';
  if (progress.tier === 'PLATINUM') {
    return `
      <div class="tier-progress-wrap">
        <div class="tier-progress-header">
          <span class="tier-progress-label">Card Tier</span>
          ${tierBadge('PLATINUM')}
        </div>
        <div class="tier-bar-track">
          <div class="tier-bar-fill tier-bar-PLATINUM" style="width:100%"></div>
        </div>
        <div class="tier-maxed">✦ Maximum tier reached — enjoy Platinum benefits!</div>
      </div>`;
  }
  const pct = progress.progress_pct || 0;
  return `
    <div class="tier-progress-wrap">
      <div class="tier-progress-header">
        <span class="tier-progress-label">${tierBadge(progress.tier)} → ${tierBadge(progress.next_tier)}</span>
        <span class="tier-progress-pct">${pct}%</span>
      </div>
      <div class="tier-bar-track">
        <div class="tier-bar-fill tier-bar-${progress.tier}" style="width:${pct}%"></div>
      </div>
      <div class="tier-progress-note">
        Spend ${fmt(progress.amount_remaining)} more to reach ${TIER_LABELS[progress.next_tier]}
        &nbsp;·&nbsp; Lifetime: ${fmt(progress.lifetime_spend)}
      </div>
    </div>`;
}

function showTierUpgradeToast(upgrade) {
  const existing = document.getElementById('tierToast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'tierToast';
  el.className = 'tier-upgrade-toast';
  el.innerHTML = `
    <div class="tier-upgrade-icon">${TIER_ICONS[upgrade.new_tier]}</div>
    <div class="tier-upgrade-text">
      <div class="tier-upgrade-title">Card Upgraded to ${TIER_LABELS[upgrade.new_tier]}!</div>
      <div class="tier-upgrade-body">
        Your card •••• ending in — ${TIER_LABELS[upgrade.old_tier]} → <strong>${TIER_LABELS[upgrade.new_tier]}</strong><br>
        Credit limit +${fmt(upgrade.credit_limit_added)} &nbsp;·&nbsp; Monthly limit +${fmt(upgrade.monthly_limit_added)}
        ${upgrade.next_tier ? `<br>Next: ${TIER_LABELS[upgrade.next_tier]} at ${fmt(upgrade.next_tier_at)} lifetime spend` : ''}
      </div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 7000);
}

// ── Override showResult to handle tier_upgrade in checkout response ──
const _origShowResult = showResult;
window.showResult = function(res) {
  _origShowResult(res);
  if (res.tier_upgrade) {
    setTimeout(() => showTierUpgradeToast(res.tier_upgrade), 800);
  }
};

// ── Patch _cards display to show tier badge + progress ──
const _origLoadProfile = loadProfile;
window.loadProfile = async function() {
  await _origLoadProfile();
  // Re-render cards with tier info (fetch fresh progress per card)
  await enrichCardsWithTier();
};

async function enrichCardsWithTier() {
  if (!USER) return;
  const tiles = document.querySelectorAll('.profile-card-tile');
  tiles.forEach(async (tile, i) => {
    const card = CARDS[i];
    if (!card || card.card_type !== 'credit') return;
    const res = await API.get(`/api/cards/${card.id}/tier?user_id=${USER.id}`);
    if (!res.tier_progress) return;
    const prog = res.tier_progress;

    // Insert tier badge into top line
    const top = tile.querySelector('.pct-top');
    if (top && !top.querySelector('.tier-badge')) {
      top.insertAdjacentHTML('afterbegin', tierBadge(prog.tier));
    }

    // Insert progress bar before pct-actions
    const actions = tile.querySelector('.pct-actions');
    if (actions && !tile.querySelector('.tier-progress-wrap')) {
      actions.insertAdjacentHTML('beforebegin', renderTierProgress(prog));
    }
  });
}

// ── Tier history section inside profile ──
const _origShowPage = showPage;
window.showPage = function(name) {
  _origShowPage(name);
  if (name === 'profile') {
    setTimeout(loadTierHistory, 300);
  }
};

async function loadTierHistory() {
  if (!USER) return;
  const res = await API.get(`/api/user/${USER.id}/tier-upgrades`);
  const upgrades = (res.upgrades || []);
  if (!upgrades.length) return;

  // Find or create tier history section in profile
  let section = document.getElementById('tierHistorySection');
  if (!section) {
    const profileGrid = document.querySelector('.profile-grid');
    if (!profileGrid) return;
    section = document.createElement('div');
    section.id = 'tierHistorySection';
    section.style.cssText = 'grid-column:1/-1;margin-top:1.5rem';
    section.innerHTML = `
      <div class="profile-cards-head">
        <h4 class="section-cap" style="margin-bottom:0">Tier Upgrade History</h4>
      </div>
      <div class="tier-history-list" id="tierHistoryList"></div>`;
    profileGrid.appendChild(section);
  }
  const list = document.getElementById('tierHistoryList');
  list.innerHTML = upgrades.map(u => `
    <div class="tier-history-row">
      <span>${tierBadge(u.old_tier)}</span>
      <span class="tier-history-arrow">→</span>
      <span>${tierBadge(u.new_tier)}</span>
      <div class="tier-history-meta">
        <div class="tier-history-cards">•••• ${u.last4} — ${u.card_network} (${u.bank_name})</div>
        <div class="tier-history-detail">Lifetime spend at upgrade: ${fmt(u.total_spend)}</div>
      </div>
      <div class="tier-history-date">
        ${new Date(u.upgraded_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
      </div>
    </div>`).join('');
}

// ── Show tier badge in checkout card selector ──
const _origRenderCardList = renderCardList;
window.renderCardList = function() {
  _origRenderCardList();
  // Enrich each card item with tier badge
  document.querySelectorAll('.co-card-item').forEach(item => {
    const radio = item.querySelector('input[type=radio]');
    if (!radio) return;
    const cid = parseInt(radio.value);
    const card = CARDS.find(c => c.id === cid);
    if (!card || card.card_type !== 'credit') return;
    const nameEl = item.querySelector('.co-card-name');
    if (nameEl && !item.querySelector('.tier-badge')) {
      nameEl.insertAdjacentHTML('beforeend', ' ' + tierBadge(card.tier || 'CLASSIC'));
    }
  });
};

// ── Enrich CARDS array with tier from API ──
const _origFetchCards = fetchCards;
window.fetchCards = async function() {
  await _origFetchCards();
  // cards now have tier from DB via _cards() helper in app.py
};
