/* ============================================================
   Campus Copilot — Canteen Staff Dashboard JS
   ============================================================ */
(function () {
  'use strict';

  const state = {
    staffInfo: null,
    canteenId: null,    // null = admin (all canteens)
    isAdmin: false,
    allCanteens: [],
    refreshTimer: null,
  };

  // ── Helpers ───────────────────────────────────────────────
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }
  function fmt(n) { return '₹' + Number(n).toFixed(0); }

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function switchTab(name) {
    document.querySelectorAll('.staff-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[data-staff-target]').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(`staff-tab-${name}`);
    if (tab) tab.classList.add('active');
    const btn = document.querySelector(`[data-staff-target="${name}"]`);
    if (btn) btn.classList.add('active');
  }

  // ── Load staff info ───────────────────────────────────────
  async function init() {
    try {
      const me = await apiFetch('/api/admin/me');
      state.staffInfo = me;
      state.isAdmin = me.role === 'admin' || me.role === 'super_admin';
      document.getElementById('staff-user-label').textContent = me.name || 'Staff';

      if (state.isAdmin) {
        // Admins can see all canteens — load selector
        await loadCanteenSelector();
        document.getElementById('staff-canteen-selector').classList.remove('hidden');
        document.getElementById('staff-canteen-title').textContent = '🍽️ All Canteens Dashboard';
      } else {
        // canteen_staff: restricted to their canteen
        state.canteenId = me.canteen_id;
      }
    } catch (_) {
      window.location.href = '/admin/login';
      return;
    }

    // Navigation
    document.querySelectorAll('[data-staff-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.staffTarget;
        switchTab(target);
        if (target === 'orders') loadOrders();
        else if (target === 'menu') loadMenu();
        else if (target === 'analytics') loadAnalytics();
      });
    });

    // Refresh button
    document.getElementById('staff-refresh-btn').addEventListener('click', loadOrders);
    document.getElementById('refresh-analytics-btn').addEventListener('click', loadAnalytics);

    // Canteen selector change (admin)
    document.getElementById('staff-canteen-select')?.addEventListener('change', function () {
      state.canteenId = this.value ? Number(this.value) : null;
      loadOrders();
    });

    // Logout
    document.getElementById('staff-logout-btn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      window.location.href = '/admin/login';
    });

    // Menu form
    document.getElementById('add-menu-item-btn').addEventListener('click', () => openMenuForm(null));
    document.getElementById('menu-form-cancel').addEventListener('click', closeMenuForm);
    document.getElementById('menu-item-form').addEventListener('submit', saveMenuItem);

    // Modal close
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('order-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('order-modal')) closeModal();
    });

    // Start auto-refresh every 30 seconds for orders
    startAutoRefresh();

    // Initial load
    await loadOrders();
  }

  async function loadCanteenSelector() {
    try {
      const canteens = await apiFetch('/api/admin/canteens');
      state.allCanteens = canteens;
      const select = document.getElementById('staff-canteen-select');
      select.innerHTML = '<option value="">All Canteens</option>' +
        canteens.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    } catch (_) {}
  }

  // ── Auto refresh ──────────────────────────────────────────
  function startAutoRefresh() {
    state.refreshTimer = setInterval(() => {
      const activeTab = document.querySelector('.staff-tab.active');
      if (activeTab?.id === 'staff-tab-orders') loadOrders(true);
    }, 30000);
  }

  // ── TAB: Today's Orders ───────────────────────────────────
  async function loadOrders(silent = false) {
    const container = document.getElementById('staff-orders-container');
    if (!silent) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔄</div><h3>Loading orders…</h3></div>';
    }

    const url = state.canteenId
      ? `/api/canteen/staff/orders?canteen_id=${state.canteenId}`
      : '/api/canteen/staff/orders';

    try {
      const orders = await apiFetch(url);
      renderStatsRow(orders);

      if (!orders.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No paid orders today</h3><p>Paid orders will appear here grouped by pickup time.</p></div>';
        return;
      }

      // Group by pickup time
      const grouped = {};
      orders.forEach(o => {
        if (!grouped[o.pickup_time]) grouped[o.pickup_time] = [];
        grouped[o.pickup_time].push(o);
      });

      container.innerHTML = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([time, timeOrders]) => `
        <div class="slot-group">
          <div class="slot-group-header">
            <span class="slot-group-time">⏰ ${esc(time)}</span>
            <span class="slot-group-count">${timeOrders.length} order${timeOrders.length > 1 ? 's' : ''}</span>
          </div>
          <div class="slot-orders">
            ${timeOrders.map(o => `
              <div class="staff-order-row">
                <div class="staff-order-info">
                  <div class="staff-order-number">${esc(o.order_number)}</div>
                  <div class="staff-order-student">👤 ${esc(o.student_name)} · ${esc(o.roll_number || '')}</div>
                  <div class="staff-order-items">${o.items.map(i => `${esc(i.item_name)} ×${i.quantity}`).join(' · ')}</div>
                </div>
                <div class="staff-order-total">${fmt(o.total_amount)}</div>
                <span class="order-status-chip ${o.order_status}" style="min-width:90px;text-align:center">${o.order_status.toUpperCase()}</span>
                <div class="staff-action-btns">
                  ${o.order_status === 'paid' || o.order_status === 'pending'
                    ? `<button class="staff-action-btn preparing" data-order-id="${o.id}" data-action="preparing">Start Preparing</button>`
                    : ''}
                  ${o.order_status === 'preparing'
                    ? `<button class="staff-action-btn ready" data-order-id="${o.id}" data-action="ready">Mark Ready</button>`
                    : ''}
                  ${o.order_status === 'ready'
                    ? `<button class="staff-action-btn collected" data-order-id="${o.id}" data-action="collected">Mark Collected</button>`
                    : ''}
                  <button class="staff-action-btn" data-order-id="${o.id}" data-action="detail">Details</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');

      // Bind status buttons
      container.querySelectorAll('.staff-action-btn[data-action]').forEach(btn => {
        const action = btn.dataset.action;
        const orderId = Number(btn.dataset.orderId);
        if (action === 'detail') {
          btn.addEventListener('click', () => showOrderModal(orders.find(o => o.id === orderId)));
        } else {
          btn.addEventListener('click', () => updateOrderStatus(orderId, action, btn));
        }
      });

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Error loading orders</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function renderStatsRow(orders) {
    const stats = {
      total: orders.length,
      preparing: orders.filter(o => o.order_status === 'preparing').length,
      ready: orders.filter(o => o.order_status === 'ready').length,
      collected: orders.filter(o => o.order_status === 'collected').length,
      paid: orders.filter(o => o.order_status === 'paid').length,
    };
    document.getElementById('staff-stats-row').innerHTML = `
      <article class="card stat-card">
        <div class="stat-header"><div><p class="section-kicker">Today's Orders</p><h3>${stats.total}</h3></div><span class="stat-icon primary">📋</span></div>
        <span class="status-pill status-info">Live</span>
      </article>
      <article class="card stat-card">
        <div class="stat-header"><div><p class="section-kicker">Paid / Pending</p><h3>${stats.paid}</h3></div><span class="stat-icon warning">💳</span></div>
        <span class="status-pill status-warn">Awaiting</span>
      </article>
      <article class="card stat-card">
        <div class="stat-header"><div><p class="section-kicker">Preparing</p><h3>${stats.preparing}</h3></div><span class="stat-icon warning">👨‍🍳</span></div>
        <span class="status-pill status-warn">Cooking</span>
      </article>
      <article class="card stat-card">
        <div class="stat-header"><div><p class="section-kicker">Ready</p><h3>${stats.ready}</h3></div><span class="stat-icon success">📦</span></div>
        <span class="status-pill status-success">Ready</span>
      </article>
      <article class="card stat-card">
        <div class="stat-header"><div><p class="section-kicker">Collected</p><h3>${stats.collected}</h3></div><span class="stat-icon neutral">✅</span></div>
        <span class="status-pill">Done</span>
      </article>
    `;
  }

  async function updateOrderStatus(orderId, status, btn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await apiFetch(`/api/canteen/staff/orders/${orderId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await loadOrders(true);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  // ── Order detail modal ────────────────────────────────────
  function showOrderModal(order) {
    if (!order) return;
    document.getElementById('modal-order-title').textContent = `Order ${order.order_number}`;
    document.getElementById('modal-content').innerHTML = `
      <div class="success-meta" style="margin:0 0 16px">
        <div><span>Student</span><strong>${esc(order.student_name)} (${esc(order.roll_number || '')})</strong></div>
        <div><span>Pickup Time</span><strong>${esc(order.pickup_time)}</strong></div>
        <div><span>Status</span><span class="order-status-chip ${order.order_status}">${order.order_status.toUpperCase()}</span></div>
        <div><span>Total</span><strong>${fmt(order.total_amount)}</strong></div>
      </div>
      <h4 style="margin:0 0 8px;color:var(--muted);font-size:12px;text-transform:uppercase">Items</h4>
      ${order.items.map(i => `
        <div class="detail-item-row">
          <span>${esc(i.item_name)}</span>
          <span>× ${i.quantity}</span>
          <strong>${fmt(i.subtotal)}</strong>
        </div>
      `).join('')}
    `;

    const actions = document.getElementById('modal-actions');
    actions.innerHTML = '';
    if (order.order_status === 'paid' || order.order_status === 'pending') {
      const btn = makeActionBtn('Start Preparing', 'primary', () => { updateOrderStatus(order.id, 'preparing', btn); closeModal(); });
      actions.appendChild(btn);
    }
    if (order.order_status === 'preparing') {
      const btn = makeActionBtn('Mark Ready', 'primary', () => { updateOrderStatus(order.id, 'ready', btn); closeModal(); });
      actions.appendChild(btn);
    }
    if (order.order_status === 'ready') {
      const btn = makeActionBtn('Mark Collected ✅', 'primary', () => { updateOrderStatus(order.id, 'collected', btn); closeModal(); });
      actions.appendChild(btn);
    }

    document.getElementById('order-modal').classList.remove('hidden');
  }

  function makeActionBtn(label, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function closeModal() {
    document.getElementById('order-modal').classList.add('hidden');
  }

  // ── TAB: Menu Management ──────────────────────────────────
  async function loadMenu() {
    const list = document.getElementById('staff-menu-list');
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔄</div><h3>Loading…</h3></div>';
    const cid = state.canteenId || (state.allCanteens[0]?.id);
    if (!cid) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><h3>Select a canteen first</h3></div>';
      return;
    }
    try {
      const items = await apiFetch(`/api/canteen/staff/menu?canteen_id=${cid}`);
      if (!items.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><h3>No menu items</h3><p>Click "+ Add Item" to add your first dish.</p></div>';
        return;
      }
      list.innerHTML = items.map(item => `
        <div class="staff-menu-card ${!item.available ? 'unavailable' : ''}">
          <div class="staff-menu-card-header">
            <span class="staff-menu-card-name">${esc(item.name)}</span>
            <span class="staff-menu-card-price">${fmt(item.price)}</span>
          </div>
          <span class="staff-menu-card-cat">${esc(item.category || 'General')}</span>
          ${item.description ? `<div class="staff-menu-card-desc">${esc(item.description)}</div>` : ''}
          ${!item.available ? `<span class="unavailable-badge">Currently Unavailable</span>` : ''}
          <div class="staff-menu-card-actions">
            <button class="staff-menu-edit-btn" data-item-id="${item.id}">✏️ Edit</button>
            <button class="staff-menu-toggle-btn ${item.available ? 'avail' : 'unavail'}" data-item-id="${item.id}" data-available="${item.available}">
              ${item.available ? '🚫 Mark Unavailable' : '✅ Mark Available'}
            </button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.staff-menu-edit-btn').forEach(btn => {
        const iid = Number(btn.dataset.itemId);
        const item = items.find(i => i.id === iid);
        btn.addEventListener('click', () => openMenuForm(item));
      });
      list.querySelectorAll('.staff-menu-toggle-btn').forEach(btn => {
        const iid = Number(btn.dataset.itemId);
        const item = items.find(i => i.id === iid);
        btn.addEventListener('click', () => toggleItemAvailability(item, btn));
      });

    } catch (err) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Error</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function openMenuForm(item) {
    document.getElementById('menu-item-form-wrap').classList.remove('hidden');
    document.getElementById('menu-form-title').textContent = item ? 'Edit Food Item' : 'Add Food Item';
    document.getElementById('menu-form-submit').textContent = item ? 'Update Item' : 'Save Item';
    document.getElementById('menu-item-id').value = item?.id || '';
    document.getElementById('mf-name').value = item?.name || '';
    document.getElementById('mf-price').value = item?.price || '';
    document.getElementById('mf-category').value = item?.category || '';
    document.getElementById('mf-available').value = String(item ? item.available : true);
    document.getElementById('mf-description').value = item?.description || '';
    document.getElementById('menu-item-form-wrap').scrollIntoView({ behavior: 'smooth' });
  }

  function closeMenuForm() {
    document.getElementById('menu-item-form-wrap').classList.add('hidden');
    document.getElementById('menu-item-form').reset();
    document.getElementById('menu-item-id').value = '';
    document.getElementById('menu-form-error').classList.add('hidden');
  }

  async function saveMenuItem(e) {
    e.preventDefault();
    const errEl = document.getElementById('menu-form-error');
    errEl.classList.add('hidden');

    const itemId = document.getElementById('menu-item-id').value;
    const cid = state.canteenId || state.allCanteens[0]?.id;
    const payload = {
      canteen_id: cid,
      name: document.getElementById('mf-name').value.trim(),
      price: parseFloat(document.getElementById('mf-price').value),
      category: document.getElementById('mf-category').value.trim() || 'General',
      available: document.getElementById('mf-available').value === 'true',
      description: document.getElementById('mf-description').value.trim(),
    };

    const submit = document.getElementById('menu-form-submit');
    submit.disabled = true;
    submit.textContent = 'Saving…';

    try {
      if (itemId) {
        await apiFetch(`/api/canteen/staff/menu/${itemId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/canteen/staff/menu', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeMenuForm();
      loadMenu();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submit.disabled = false;
      submit.textContent = itemId ? 'Update Item' : 'Save Item';
    }
  }

  async function toggleItemAvailability(item, btn) {
    btn.disabled = true;
    try {
      await apiFetch(`/api/canteen/staff/menu/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: item.name, description: item.description || '',
          price: item.price, image_url: item.image_url || '',
          category: item.category || 'General', available: !item.available,
        }),
      });
      loadMenu();
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
    }
  }

  // ── TAB: Analytics ────────────────────────────────────────
  async function loadAnalytics() {
    const statsRow = document.getElementById('analytics-stats-row');
    statsRow.innerHTML = '<div class="canteen-skeleton" style="height:100px;grid-column:span 4"></div>';

    const url = state.canteenId
      ? `/api/canteen/staff/analytics?canteen_id=${state.canteenId}`
      : '/api/canteen/staff/analytics';

    try {
      const data = await apiFetch(url);

      // Summary stats
      statsRow.innerHTML = `
        <article class="card stat-card">
          <div class="stat-header"><div><p class="section-kicker">Today's Orders</p><h3>${data.today.total || 0}</h3></div><span class="stat-icon primary">📋</span></div>
          <span class="status-pill status-info">Today</span>
        </article>
        <article class="card stat-card">
          <div class="stat-header"><div><p class="section-kicker">Today's Revenue</p><h3>₹${Number(data.today.revenue || 0).toFixed(0)}</h3></div><span class="stat-icon success">💰</span></div>
          <span class="status-pill status-success">Paid</span>
        </article>
        <article class="card stat-card">
          <div class="stat-header"><div><p class="section-kicker">Weekly Orders</p><h3>${data.weekly.total || 0}</h3></div><span class="stat-icon warning">📅</span></div>
          <span class="status-pill status-warn">7 Days</span>
        </article>
        <article class="card stat-card">
          <div class="stat-header"><div><p class="section-kicker">Weekly Revenue</p><h3>₹${Number(data.weekly.revenue || 0).toFixed(0)}</h3></div><span class="stat-icon neutral">📈</span></div>
          <span class="status-pill">Week</span>
        </article>
      `;

      // Top items bar chart
      const topItemsEl = document.getElementById('analytics-top-items');
      const maxQty = Math.max(...(data.top_items.map(i => i.qty)), 1);
      topItemsEl.innerHTML = data.top_items.length
        ? data.top_items.map(item => `
            <div class="analytics-bar-item">
              <span class="analytics-bar-label">${esc(item.item_name)}</span>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="width:${Math.round((item.qty / maxQty) * 100)}%"></div>
              </div>
              <span class="analytics-bar-value">${item.qty}</span>
            </div>
          `).join('')
        : '<div class="empty-state" style="padding:20px"><p>No data yet today</p></div>';

      // By slot bar chart
      const bySlotEl = document.getElementById('analytics-by-slot');
      const maxSlot = Math.max(...(data.by_slot.map(s => s.order_count)), 1);
      bySlotEl.innerHTML = data.by_slot.length
        ? data.by_slot.map(slot => `
            <div class="analytics-bar-item">
              <span class="analytics-bar-label">${esc(slot.pickup_time)}</span>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="width:${Math.round((slot.order_count / maxSlot) * 100)}%"></div>
              </div>
              <span class="analytics-bar-value">${slot.order_count}</span>
            </div>
          `).join('')
        : '<div class="empty-state" style="padding:20px"><p>No slot data yet</p></div>';

      // AI demand insight
      const demandEl = document.getElementById('analytics-demand-insight');
      demandEl.innerHTML = data.demand_insight.length
        ? data.demand_insight.map(d => `
            <div class="demand-insight-item">
              <div class="demand-item-name">🍽️ ${esc(d.item_name)}</div>
              <div class="demand-item-stats">
                <div class="demand-stat">
                  <div class="demand-stat-val">${d.confirmed_qty || 0}</div>
                  <div class="demand-stat-label">Confirmed Orders</div>
                </div>
                <div class="demand-stat">
                  <div class="demand-stat-val">${d.historical_avg || 0}</div>
                  <div class="demand-stat-label">Hist. Average</div>
                </div>
                <div class="demand-stat recommended">
                  <div class="demand-stat-val">≈${d.recommended || 0}</div>
                  <div class="demand-stat-label">Recommended Prep</div>
                </div>
              </div>
            </div>
          `).join('')
        : '<div class="empty-state" style="padding:20px"><p>Not enough historical data yet. Insight will improve after a few days of orders.</p></div>';

    } catch (err) {
      statsRow.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load analytics</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
