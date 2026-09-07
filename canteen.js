/* ============================================================
   Campus Copilot — Smart Canteen (Student) JS
   ============================================================ */
(function () {
  'use strict';

  const CART_STORAGE_KEY = 'campuscopilot_canteen_cart';

  const state = {
    studentName: '',
    cart: {},
    currentCanteen: null,
    selectedSlot: null,
    currentOrderId: null,
    currentOrderNumber: null,
    paymentSession: null,
    statusPollTimer: null,
    billOrderId: null,
    lastBillText: '',
  };

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function fmt(amount) {
    return '₹' + Number(amount).toFixed(0);
  }

  function fmtTime(hhmm) {
    if (!hhmm) return '—';
    const raw = String(hhmm).trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return raw;
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function tokenDisplay(orderNumber) {
    if (!orderNumber) return '';
    return '#' + String(orderNumber).replace(/^CC-/, '');
  }

  function showView(id) {
    document.querySelectorAll('.canteen-view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
  }

  function setNavActive(btnId) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }

  function showError(elId, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideError(elId) {
    const el = document.getElementById(elId);
    if (el) el.classList.add('hidden');
  }

  function on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { error: text || 'Request failed' };
    }
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }

  function categoryEmoji(cat) {
    const map = {
      'Meals': '🍛', 'Rice & Noodles': '🍚', 'Snacks': '🥪',
      'Beverages': '☕', 'Fast Food': '🍔', 'South Indian': '🥞',
      'Evening Snacks': '🌙', 'General': '🍽️',
    };
    return map[cat] || '🍽️';
  }

  function persistCart() {
    try {
      sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
        cart: state.cart,
        canteen: state.currentCanteen,
        selectedSlot: state.selectedSlot,
        currentOrderId: state.currentOrderId,
        currentOrderNumber: state.currentOrderNumber,
        paymentSession: state.paymentSession,
      }));
    } catch (_) {}
  }

  function restoreCart() {
    try {
      const raw = sessionStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.cart = saved.cart || {};
      state.currentCanteen = saved.canteen || null;
      state.selectedSlot = saved.selectedSlot || null;
      state.currentOrderId = saved.currentOrderId || null;
      state.currentOrderNumber = saved.currentOrderNumber || null;
      state.paymentSession = saved.paymentSession || null;
    } catch (_) {}
  }

  function cartTotal() {
    return Object.values(state.cart).reduce((s, i) => s + i.price * i.quantity, 0);
  }

  function cartItemCount() {
    return Object.values(state.cart).reduce((s, i) => s + i.quantity, 0);
  }

  function cartIsEmpty() {
    return Object.keys(state.cart).length === 0;
  }

  function updateCartBadges() {
    const count = cartItemCount();
    const badge = document.getElementById('cart-count-badge');
    const fabCount = document.getElementById('cart-fab-count');
    if (badge) badge.textContent = count;
    if (fabCount) fabCount.textContent = count;
    const fab = document.getElementById('cart-fab-btn');
    if (fab) fab.classList.toggle('hidden', count === 0);
    persistCart();
  }

  function addToCart(item, openCartAfter) {
    const id = String(item.id);
    if (state.cart[id]) {
      state.cart[id].quantity++;
    } else {
      state.cart[id] = {
        name: item.name,
        price: parseFloat(item.price),
        quantity: 1,
        image_url: item.image_url || '',
        category: item.category || 'General',
      };
    }
    updateCartBadges();
    renderCartPage();
    updateMenuQtyControls();
    if (openCartAfter) openCartPage();
  }

  function removeFromCart(id) {
    const sid = String(id);
    if (!state.cart[sid]) return;
    state.cart[sid].quantity--;
    if (state.cart[sid].quantity <= 0) delete state.cart[sid];
    updateCartBadges();
    renderCartPage();
    updateMenuQtyControls();
  }

  function deleteFromCart(id) {
    delete state.cart[String(id)];
    updateCartBadges();
    renderCartPage();
    updateMenuQtyControls();
  }

  function clearCart() {
    state.cart = {};
    state.selectedSlot = null;
    state.currentOrderId = null;
    state.currentOrderNumber = null;
    state.paymentSession = null;
    updateCartBadges();
    persistCart();
  }

  function foodThumb(item) {
    if (item.image_url) {
      return `<img src="${esc(item.image_url)}" alt="${esc(item.name)}" />`;
    }
    return categoryEmoji(item.category);
  }

  async function loadCanteens() {
    const grid = document.getElementById('canteen-grid');
    try {
      const canteens = await apiFetch('/api/canteens');
      if (!canteens.length) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><h3>No canteens available</h3><p>Check back later.</p></div>';
        return;
      }
      grid.innerHTML = canteens.map(c => `
        <div class="canteen-card ${c.status === 'closed' ? 'closed-card' : ''}"
             data-canteen-id="${c.id}"
             tabindex="0"
             role="button"
             aria-label="Select ${esc(c.name)}">
          <div class="canteen-card-icon">🍴</div>
          <div class="canteen-card-name">${esc(c.name)}</div>
          ${c.location ? `<div class="canteen-card-location">📍 ${esc(c.location)}</div>` : ''}
          ${c.description ? `<div class="canteen-card-desc">${esc(c.description)}</div>` : ''}
          <div class="canteen-card-footer">
            <span class="canteen-status-badge ${c.status}">
              ${c.status === 'open' ? '🟢 Open' : '🔴 Closed'}
              ${c.status === 'open' && c.opening_time ? `· ${fmtTime(c.opening_time)} – ${fmtTime(c.closing_time)}` : ''}
            </span>
            <button class="canteen-view-menu-btn" type="button" ${c.status === 'closed' ? 'disabled' : ''}>
              View Menu →
            </button>
          </div>
        </div>
      `).join('');

      grid.querySelectorAll('.canteen-card').forEach(card => {
        const cid = Number(card.dataset.canteenId);
        const canteen = canteens.find(c => c.id === cid);
        if (canteen.status === 'open') {
          card.addEventListener('click', () => openMenu(canteen));
          card.addEventListener('keydown', e => e.key === 'Enter' && openMenu(canteen));
        }
      });
    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load canteens</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  async function openMenu(canteen) {
    if (state.currentCanteen && state.currentCanteen.id !== canteen.id) {
      clearCart();
    }
    state.currentCanteen = canteen;
    persistCart();
    document.getElementById('menu-canteen-name').textContent = canteen.name;
    document.getElementById('menu-canteen-location').textContent = canteen.location || '';
    document.getElementById('menu-canteen-badge').textContent = canteen.status === 'open' ? '🟢 Open' : '🔴 Closed';
    document.getElementById('menu-canteen-badge').className = 'status-pill ' + (canteen.status === 'open' ? 'status-success' : 'status-danger');
    setNavActive('nav-food-ordering');
    showView('view-menu');
    await loadMenu(canteen.id);
  }

  let allMenuItems = [];

  async function loadMenu(canteenId) {
    const grid = document.getElementById('menu-grid');
    grid.innerHTML = '<div class="canteen-skeleton" style="height:140px"></div>'.repeat(6);
    try {
      const data = await apiFetch(`/api/canteens/${canteenId}/menu`);
      allMenuItems = data.items || [];
      renderCategories(allMenuItems);
      renderMenuItems(allMenuItems);
    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load menu</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function renderCategories(items) {
    const cats = ['All', ...new Set(items.map(i => i.category).filter(Boolean))];
    const filter = document.getElementById('category-filter');
    filter.innerHTML = cats.map((c, idx) =>
      `<button class="category-chip ${idx === 0 ? 'active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`
    ).join('');
    filter.querySelectorAll('.category-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        filter.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyMenuFilters();
      });
    });
  }

  function applyMenuFilters() {
    const q = (document.getElementById('menu-search')?.value || '').toLowerCase().trim();
    const active = document.querySelector('#category-filter .category-chip.active');
    const cat = active ? active.dataset.cat : 'All';
    let filtered = allMenuItems;
    if (cat && cat !== 'All') filtered = filtered.filter(i => i.category === cat);
    if (q) {
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q)
      );
    }
    renderMenuItems(filtered);
  }

  function renderMenuItems(items) {
    const grid = document.getElementById('menu-grid');
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>No items found</h3></div>';
      return;
    }
    grid.innerHTML = items.map(item => `
      <article class="menu-item-card ${!item.available ? 'unavailable' : ''}" id="menu-card-${item.id}">
        <div class="menu-item-image">${foodThumb(item)}</div>
        <div class="menu-item-name">${esc(item.name)}</div>
        <div class="menu-item-desc">${esc(item.description || 'Freshly prepared in campus.')}</div>
        <span class="menu-item-category">${esc(item.category || 'General')}</span>
        <div class="menu-item-footer">
          <span class="menu-item-price">${fmt(item.price)}</span>
          ${!item.available
            ? `<span class="unavailable-badge">Currently Unavailable</span>`
            : `<div class="qty-control" id="qc-${item.id}">
                 <button class="add-to-cart-btn" data-item-id="${item.id}" type="button">+ Add to Cart</button>
               </div>`
          }
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = allMenuItems.find(i => i.id === Number(btn.dataset.itemId));
        if (item) addToCart(item, false);
      });
    });

    updateMenuQtyControls();
  }

  function updateMenuQtyControls() {
    allMenuItems.forEach(item => {
      const qc = document.getElementById(`qc-${item.id}`);
      if (!qc) return;
      const qty = state.cart[String(item.id)]?.quantity || 0;
      if (qty > 0) {
        qc.innerHTML = `
          <button class="qty-btn minus" data-item-id="${item.id}" type="button" aria-label="Decrease">−</button>
          <span class="qty-display">${qty}</span>
          <button class="qty-btn plus" data-item-id="${item.id}" type="button" aria-label="Increase">+</button>
        `;
        qc.querySelector('.minus').addEventListener('click', (e) => { e.stopPropagation(); removeFromCart(item.id); });
        qc.querySelector('.plus').addEventListener('click', (e) => { e.stopPropagation(); addToCart(item, false); });
      } else {
        qc.innerHTML = `<button class="add-to-cart-btn" data-item-id="${item.id}" type="button">+ Add to Cart</button>`;
        qc.querySelector('.add-to-cart-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          addToCart(item, false);
        });
      }
    });
  }

  function renderCartPage() {
    const container = document.getElementById('cart-items');
    const label = document.getElementById('cart-drawer-canteen');
    const totalEl = document.getElementById('cart-total');
    const pickupEl = document.getElementById('cart-pickup-label');
    if (!container || !totalEl) return;

    if (label) label.textContent = state.currentCanteen ? state.currentCanteen.name : '';
    if (pickupEl) pickupEl.textContent = state.selectedSlot ? fmtTime(state.selectedSlot) : 'Select at checkout';

    if (cartIsEmpty()) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">🛒</div><h3>Cart is empty</h3><p>Add items from the menu.</p></div>';
      totalEl.textContent = fmt(0);
      return;
    }

    container.innerHTML = Object.entries(state.cart).map(([id, item]) => `
      <div class="cart-item">
        <div class="cart-item-thumb">${foodThumb(item)}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(item.name)}</div>
          <div class="cart-item-unit-price">${fmt(item.price)} each</div>
          <button class="cart-remove-btn" type="button" data-remove-id="${id}">Remove</button>
        </div>
        <div class="qty-control">
          <button class="qty-btn minus" data-item-id="${id}" type="button">−</button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn plus" data-item-id="${id}" type="button">+</button>
        </div>
        <span class="cart-item-subtotal">${fmt(item.price * item.quantity)}</span>
      </div>
    `).join('');

    container.querySelectorAll('.qty-btn.minus').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.itemId));
    });
    container.querySelectorAll('.qty-btn.plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = allMenuItems.find(i => String(i.id) === String(btn.dataset.itemId));
        const existing = state.cart[String(btn.dataset.itemId)];
        if (item) addToCart(item, false);
        else if (existing) addToCart({ id: btn.dataset.itemId, ...existing }, false);
      });
    });
    container.querySelectorAll('.cart-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteFromCart(btn.dataset.removeId));
    });

    totalEl.textContent = fmt(cartTotal());
  }

  function openCartPage() {
    hideError('cart-empty-error');
    renderCartPage();
    setNavActive('nav-food-ordering');
    showView('view-cart');
  }

  async function openCheckout() {
    hideError('cart-empty-error');
    if (cartIsEmpty()) {
      showError('cart-empty-error', 'Add items before proceeding to payment.');
      return;
    }
    if (!state.currentCanteen) {
      showError('cart-empty-error', 'Select a canteen first.');
      return;
    }

    document.getElementById('checkout-canteen-label').textContent = state.currentCanteen.name || '';
    const itemsEl = document.getElementById('checkout-items-list');
    itemsEl.innerHTML = Object.entries(state.cart).map(([, item]) => `
      <div class="checkout-item">
        <span class="checkout-item-name">${esc(item.name)}</span>
        <span class="checkout-item-qty">× ${item.quantity}</span>
        <span class="checkout-item-subtotal">${fmt(item.price * item.quantity)}</span>
      </div>
    `).join('');
    document.getElementById('checkout-total').textContent = fmt(cartTotal());
    document.getElementById('pay-btn-amount').textContent = fmt(cartTotal());
    document.getElementById('checkout-student-name').textContent = state.studentName;
    hideError('checkout-error');
    await loadSlots();
    const pickupLabel = document.getElementById('checkout-pickup-label');
    if (pickupLabel) pickupLabel.textContent = state.selectedSlot ? fmtTime(state.selectedSlot) : '—';
    showView('view-checkout');
  }

  async function loadSlots() {
    const picker = document.getElementById('slot-picker');
    picker.innerHTML = '<span class="muted-text">Loading slots…</span>';
    try {
      const data = await apiFetch(`/api/canteens/${state.currentCanteen.id}/slots`);
      if (!data.canteen_open || !data.slots.length) {
        picker.innerHTML = '<span class="no-slots-msg">🔴 No pickup slots available. Canteen may be closed.</span>';
        state.selectedSlot = null;
        persistCart();
        return;
      }
      if (!state.selectedSlot || !data.slots.includes(state.selectedSlot)) {
        state.selectedSlot = data.slots[0];
      }
      picker.innerHTML = data.slots.map(s =>
        `<button class="slot-chip ${s === state.selectedSlot ? 'selected' : ''}" data-slot="${esc(s)}" type="button">${fmtTime(s)}</button>`
      ).join('');
      persistCart();
      picker.querySelectorAll('.slot-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          picker.querySelectorAll('.slot-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          state.selectedSlot = chip.dataset.slot;
          const pickupLabel = document.getElementById('checkout-pickup-label');
          if (pickupLabel) pickupLabel.textContent = fmtTime(state.selectedSlot);
          persistCart();
        });
      });
    } catch (err) {
      picker.innerHTML = `<span class="no-slots-msg">Could not load slots: ${esc(err.message)}</span>`;
    }
  }

  let paymentInFlight = false;

  async function submitOrder(event) {
    if (event) event.preventDefault();
    if (paymentInFlight) return;
    if (!state.selectedSlot) { showError('checkout-error', 'Please select a pickup time slot.'); return; }
    if (cartIsEmpty()) { showError('checkout-error', 'Your cart is empty.'); return; }

    const password = (document.getElementById('payment-password')?.value || '').trim();
    if (!password) {
      showError('checkout-error', 'Enter your Campus Copilot password to authenticate this payment.');
      return;
    }

    hideError('checkout-error');
    paymentInFlight = true;
    const payBtn = document.getElementById('pay-btn');
    payBtn.disabled = true;
    payBtn.textContent = 'Verifying payment…';

    const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value || 'UPI';

    try {
      const orderItems = Object.entries(state.cart).map(([id, item]) => ({
        menu_item_id: Number(id),
        quantity: item.quantity,
      }));

      const order = await apiFetch('/api/canteen/orders', {
        method: 'POST',
        body: JSON.stringify({
          canteen_id: state.currentCanteen.id,
          pickup_time: state.selectedSlot,
          items: orderItems,
        }),
      });

      state.currentOrderId = order.order_id;
      state.currentOrderNumber = order.order_number;
      persistCart();

      const session = await apiFetch(`/api/canteen/orders/${order.order_id}/payment-session`, {
        method: 'POST',
        body: JSON.stringify({ payment_method: paymentMethod }),
      });

      if (session.status === 'already_paid') {
        clearCart();
        state.currentOrderId = session.order_id;
        state.currentOrderNumber = session.order_number;
        showSuccessScreen(session);
        return;
      }

      state.paymentSession = session.payment_session;
      persistCart();

      const payment = await apiFetch(`/api/canteen/orders/${order.order_id}/verify-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payment_session: session.payment_session,
          password,
          payment_method: paymentMethod,
          outcome: 'success',
        }),
      });

      if (payment.status !== 'success' && payment.status !== 'already_paid') {
        throw new Error(payment.error || 'Payment was not verified.');
      }
      if (payment.payment_status && payment.payment_status !== 'paid') {
        throw new Error('Payment was not verified by the server.');
      }

      const pwd = document.getElementById('payment-password');
      if (pwd) pwd.value = '';
      clearCart();
      state.currentOrderId = payment.order_id || order.order_id;
      state.currentOrderNumber = payment.order_number || order.order_number;
      showSuccessScreen(payment);
    } catch (err) {
      showError('checkout-error', err.message || 'Payment could not be verified. Try again — a paid order will not be created twice.');
    } finally {
      paymentInFlight = false;
      payBtn.disabled = false;
      payBtn.innerHTML = `Pay <span id="pay-btn-amount">${fmt(cartTotal() || 0)}</span>`;
    }
  }

  async function cancelPayment() {
    try {
      if (state.currentOrderId) {
        await apiFetch(`/api/canteen/orders/${state.currentOrderId}/cancel-payment`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }
    } catch (_) {}
    state.paymentSession = null;
    persistCart();
    hideError('checkout-error');
    openCartPage();
  }

  function showSuccessScreen(paymentData) {
    document.getElementById('success-order-id').textContent = `Order ID: ${state.currentOrderNumber}`;
    document.getElementById('success-canteen').textContent = state.currentCanteen?.name || '—';
    document.getElementById('success-pickup').textContent = fmtTime(paymentData.pickup_time || state.selectedSlot);
    document.getElementById('success-txn').textContent = paymentData.transaction_id || '—';
    const tokenCanteen = document.getElementById('success-token-canteen');
    if (tokenCanteen) tokenCanteen.textContent = state.currentCanteen?.name || '';
    showView('view-success');
    loadAndRenderSuccessOrder(state.currentOrderId);
    loadQR(state.currentOrderId);
    startStatusPolling(state.currentOrderId);
  }

  async function loadAndRenderSuccessOrder(orderId) {
    try {
      const order = await apiFetch(`/api/canteen/orders/${orderId}`);
      document.getElementById('success-amount').textContent = fmt(order.total_amount);
      document.getElementById('success-canteen').textContent = order.canteen_name || state.currentCanteen?.name || '—';
      document.getElementById('success-pickup').textContent = fmtTime(order.pickup_time);
      const tokenCanteen = document.getElementById('success-token-canteen');
      if (tokenCanteen) tokenCanteen.textContent = order.canteen_name || '';
      state.selectedSlot = order.pickup_time;
      state.currentCanteen = { id: order.canteen_id, name: order.canteen_name };
      updateTimeline(order.order_status, order.status_history);
    } catch (_) {}
  }

  function updateTimeline(status, history) {
    const steps = ['paid', 'preparing', 'ready', 'collected'];
    const hist = (history || []).map(h => h.status);
    const currentIdx = steps.indexOf(status);

    steps.forEach((s, i) => {
      const step = document.getElementById(`ts-${s}`);
      const dot = step ? step.querySelector('.tl-dot') : document.querySelector(`#ts-${s} .tl-dot`);
      if (!dot) return;
      const done = hist.includes(s) || (currentIdx >= 0 && i < currentIdx);
      const isActive = status === s;
      dot.classList.remove('tl-dot-done', 'tl-dot-active');
      if (done && !isActive) {
        dot.classList.add('tl-dot-done');
        dot.textContent = '✓';
      } else if (isActive) {
        dot.classList.add('tl-dot-active');
        dot.textContent = '●';
      } else {
        dot.textContent = '○';
      }
    });
  }

  function startStatusPolling(orderId) {
    clearStatusPolling();
    state.statusPollTimer = setInterval(async () => {
      try {
        const order = await apiFetch(`/api/canteen/orders/${orderId}`);
        updateTimeline(order.order_status, order.status_history);
        if (order.order_status === 'collected') clearStatusPolling();
      } catch (_) {}
    }, 8000);
  }

  function clearStatusPolling() {
    if (state.statusPollTimer) {
      clearInterval(state.statusPollTimer);
      state.statusPollTimer = null;
    }
  }

  async function loadQR(orderId) {
    const img = document.getElementById('qr-code-img');
    const numEl = document.getElementById('qr-order-number');
    if (numEl) numEl.textContent = tokenDisplay(state.currentOrderNumber);
    if (!img || !orderId) return;
    img.src = `/api/canteen/orders/${orderId}/qr?t=${Date.now()}`;
    img.style.display = 'block';
  }

  async function loadMyOrders() {
    setNavActive('nav-orders-btn');
    showView('view-orders');
    const list = document.getElementById('orders-list');
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔄</div><h3>Loading orders…</h3></div>';
    try {
      const orders = await apiFetch('/api/canteen/orders');
      if (!orders.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No orders yet</h3><p>Your orders will appear here after you place one.</p></div>';
        return;
      }
      list.innerHTML = orders.map(o => `
        <div class="order-list-card" data-order-id="${o.id}" tabindex="0" role="button">
          <div class="order-list-left">
            <div class="order-list-number">${esc(o.order_number)}</div>
            <div class="order-list-canteen">${esc(o.canteen_name)}</div>
            <div class="order-list-meta">Pickup: ${esc(fmtTime(o.pickup_time))}</div>
          </div>
          <div class="order-list-right">
            <div class="order-list-amount">${fmt(o.total_amount)}</div>
            <span class="order-status-chip ${o.order_status}">${esc((o.order_status || '').charAt(0).toUpperCase() + (o.order_status || '').slice(1))}</span>
            <button class="pill-button track-order-list-btn" type="button" data-order-id="${o.id}">Track Order</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.order-list-card').forEach(card => {
        const oid = Number(card.dataset.orderId);
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          loadOrderDetail(oid);
        });
        card.addEventListener('keydown', e => e.key === 'Enter' && loadOrderDetail(oid));
      });
      list.querySelectorAll('.track-order-list-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadOrderDetail(Number(btn.dataset.orderId));
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load orders</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function timelineMarkup(order) {
    const steps = [
      { key: 'paid', label: '💳 Paid', hint: 'Payment verified' },
      { key: 'preparing', label: '👨‍🍳 Preparing', hint: 'Kitchen is working on your order' },
      { key: 'ready', label: '📦 Ready', hint: 'Collect at the counter' },
      { key: 'collected', label: '✅ Collected', hint: 'Enjoy your meal' },
    ];
    const hist = (order.status_history || []).map(h => h.status);
    const currentIdx = steps.findIndex(s => s.key === order.order_status);
    return `<div class="order-timeline">${steps.map((s, i) => {
      const isActive = order.order_status === s.key;
      const done = hist.includes(s.key) || (currentIdx >= 0 && i < currentIdx);
      const mark = done && !isActive ? '✓' : isActive ? '●' : '○';
      const cls = done && !isActive ? 'tl-dot-done' : isActive ? 'tl-dot-active' : '';
      return `<div class="timeline-step">
        <div class="tl-dot ${cls}">${mark}</div>
        <div class="tl-content"><strong>${s.label}</strong><span>${s.hint}</span></div>
      </div>`;
    }).join('')}</div>`;
  }

  async function loadOrderDetail(orderId) {
    showView('view-order-detail');
    const content = document.getElementById('order-detail-content');
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">🔄</div><h3>Loading…</h3></div>';
    try {
      const order = await apiFetch(`/api/canteen/orders/${orderId}`);
      state.currentOrderId = orderId;
      state.currentOrderNumber = order.order_number;
      state.currentCanteen = { id: order.canteen_id, name: order.canteen_name };
      state.selectedSlot = order.pickup_time;

      content.innerHTML = `
        <div class="order-detail-header">
          <div>
            <div class="order-list-number">${esc(order.order_number)}</div>
            <div class="muted-text">${esc(order.canteen_name)} · Pickup ${esc(fmtTime(order.pickup_time))}</div>
          </div>
          <span class="order-status-chip ${order.order_status}">${esc((order.order_status || '').toUpperCase())}</span>
        </div>

        <div class="detail-section">
          <h4>Items</h4>
          ${order.items.map(i => `
            <div class="detail-item-row">
              <span>${esc(i.item_name)} × ${i.quantity}</span>
              <strong>${fmt(i.subtotal)}</strong>
            </div>
          `).join('')}
          <div class="detail-item-row detail-total-row">
            <span>Total</span>
            <strong>${fmt(order.total_amount)}</strong>
          </div>
        </div>

        ${order.payment?.status === 'success' ? `
          <div class="detail-section">
            <h4>Payment</h4>
            <div class="detail-item-row"><span>Method</span><strong>${esc(order.payment.payment_method || '—')}</strong></div>
            <div class="detail-item-row"><span>Transaction ID</span><strong class="mono">${esc(order.payment.transaction_id || '—')}</strong></div>
            <div class="detail-item-row"><span>Status</span><span class="status-pill status-success">Paid</span></div>
          </div>
        ` : ''}

        <div class="detail-section">
          <h4>Status Timeline</h4>
          ${timelineMarkup(order)}
        </div>

        ${order.payment_status === 'paid' ? `
          <div class="qr-section">
            <h3>🎫 DIGITAL PICKUP TOKEN</h3>
            <p class="muted-text">${esc(order.canteen_name)}</p>
            <div class="qr-order-id">${esc(tokenDisplay(order.order_number))}</div>
            <img src="/api/canteen/orders/${orderId}/qr?t=${Date.now()}" class="qr-code-img" alt="Pickup QR">
          </div>
          <div class="success-actions">
            <button class="pill-button" type="button" id="view-bill-detail-btn">View Bill</button>
            <button class="pill-button" type="button" id="print-bill-detail-btn">Print Bill</button>
          </div>
        ` : ''}
      `;

      document.getElementById('view-bill-detail-btn')?.addEventListener('click', () => openBill(orderId));
      document.getElementById('print-bill-detail-btn')?.addEventListener('click', () => {
        openBill(orderId).then(() => setTimeout(() => window.print(), 400));
      });
      startStatusPolling(orderId);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load order</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function padItemLine(name, qty, price, nameW = 16, qtyW = 5, priceW = 10) {
    const n = String(name).slice(0, nameW).padEnd(nameW, ' ');
    const q = String(qty).padStart(qtyW, ' ');
    const p = String(price).padStart(priceW, ' ');
    return `${n}${q}${p}`;
  }

  async function openBill(orderId) {
    state.billOrderId = orderId;
    showView('view-bill');
    const content = document.getElementById('bill-content');
    content.textContent = 'Generating bill…';
    try {
      const order = await apiFetch(`/api/canteen/orders/${orderId}`);
      if (order.payment_status !== 'paid' && order.payment?.status !== 'success') {
        content.textContent = 'Bill is available only after payment is verified.';
        return;
      }
      const paidAt = order.payment?.paid_at ? new Date(order.payment.paid_at) : new Date(order.created_at);
      const dateStr = paidAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = paidAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const lines = [
        '================================',
        '       CAMPUS COPILOT',
        '        FOOD ORDER',
        '================================',
        '',
        `Order ID: ${order.order_number}`,
        '',
        `Canteen: ${order.canteen_name}`,
        `Date: ${dateStr}`,
        `Time: ${timeStr}`,
        '',
        '--------------------------------',
        padItemLine('Item', 'Qty', 'Price'),
        '--------------------------------',
      ];
      (order.items || []).forEach(i => {
        lines.push(padItemLine(i.item_name, i.quantity, fmt(i.subtotal)));
      });
      lines.push(
        '--------------------------------',
        padItemLine('TOTAL', '', fmt(order.total_amount)),
        '--------------------------------',
        '',
        `Payment: ${(order.payment?.status === 'success' || order.payment_status === 'paid') ? 'SUCCESS' : (order.payment_status || '').toUpperCase()}`,
        `Payment Method: ${order.payment?.payment_method || '—'}`,
        `Transaction ID: ${order.payment?.transaction_id || '—'}`,
        '',
        `Pickup Time: ${fmtTime(order.pickup_time)}`,
        '',
        '        Thank You!',
        '================================',
      );
      state.lastBillText = lines.join('\n');
      state.lastBillName = `${order.order_number}-bill.txt`;
      content.textContent = state.lastBillText;
    } catch (err) {
      content.textContent = `Could not generate bill: ${err.message}`;
    }
  }

  function downloadBill() {
    if (!state.lastBillText) return;
    const blob = new Blob([state.lastBillText], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.lastBillName || 'campus-copilot-bill.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function init() {
    restoreCart();

    try {
      const me = await apiFetch('/api/me');
      state.studentName = me.name || 'Student';
      const nameEl = document.getElementById('canteen-user-label');
      const avatar = document.getElementById('canteen-avatar');
      if (nameEl) nameEl.textContent = me.name;
      if (avatar) avatar.textContent = (me.name || 'S').trim().charAt(0).toUpperCase();
    } catch (_) {
      window.location.href = '/';
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'orders') {
      await loadMyOrders();
    } else {
      await loadCanteens();
    }
    updateCartBadges();

    on('back-to-canteens', 'click', () => {
      clearStatusPolling();
      showView('view-canteens');
      setNavActive('nav-food-ordering');
      loadCanteens();
    });
    on('back-from-cart', 'click', () => {
      if (state.currentCanteen) showView('view-menu');
      else { showView('view-canteens'); loadCanteens(); }
    });
    on('back-to-cart', 'click', () => openCartPage());
    on('back-from-orders', 'click', () => {
      clearStatusPolling();
      showView('view-canteens');
      setNavActive('nav-food-ordering');
      loadCanteens();
    });
    on('back-to-orders', 'click', () => { clearStatusPolling(); loadMyOrders(); });
    on('back-from-bill', 'click', () => {
      if (state.currentOrderId) loadOrderDetail(state.currentOrderId);
      else showView('view-success');
    });

    on('nav-dashboard', 'click', () => { window.location.href = '/'; });
    on('nav-food-ordering', 'click', () => {
      clearStatusPolling();
      showView('view-canteens');
      setNavActive('nav-food-ordering');
      loadCanteens();
    });
    on('nav-orders-btn', 'click', loadMyOrders);

    on('view-cart-btn', 'click', openCartPage);
    on('cart-fab-btn', 'click', openCartPage);
    on('go-to-checkout-btn', 'click', openCheckout);

    on('payment-auth-form', 'submit', submitOrder);
    on('cancel-payment-btn', 'click', cancelPayment);

    document.querySelectorAll('.payment-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const input = opt.querySelector('input');
        if (input) input.checked = true;
      });
    });

    on('view-bill-btn', 'click', () => openBill(state.currentOrderId));
    on('view-pickup-qr-btn', 'click', () => {
      document.getElementById('qr-code-img')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    on('track-order-btn', 'click', () => {
      if (state.currentOrderId) loadOrderDetail(state.currentOrderId);
    });
    on('new-order-btn', 'click', () => {
      clearStatusPolling();
      showView('view-canteens');
      setNavActive('nav-food-ordering');
      loadCanteens();
    });

    on('download-bill-btn', 'click', downloadBill);
    on('print-bill-btn2', 'click', () => window.print());

    on('menu-search', 'input', applyMenuFilters);

    on('canteen-logout-btn', 'click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
