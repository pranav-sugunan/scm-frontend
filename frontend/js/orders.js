/**
 * orders.js — Orders Page Controller
 * Features: sortable table, multi-filter (status/priority/warehouse),
 * search, pagination, update status modal, allocate order.
 * Auto-polls every 10 seconds.
 */

import { Orders } from './api.js';
import {
  initShell, markSyncing,
  formatDate, formatNumber,
  statusBadge, priorityBadge,
  showPageLoader, showError, showEmpty,
  escapeHtml, toast,
  sortBy, debounce, paginate, renderPagination,
  startPolling,
} from './utils.js';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  allOrders:   [],
  filtered:    [],
  sortKey:     'created_at',
  sortDir:     'desc',
  page:        1,
  perPage:     20,
  filters: {
    search:    '',
    status:    '',
    priority:  '',
    warehouse: '',
  },
};

/* ============================================================
   ORDER STATUSES (for update modal)
   ============================================================ */
const ORDER_STATUSES = ['created', 'allocated', 'picked', 'packed', 'shipped', 'in_transit', 'delivered', 'cancelled', 'returned'];

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await initShell('orders', 'Orders');
  await loadOrders();

  bindFilterControls();
  bindSortControls();

  // Polling
  startPolling('orders', async () => {
    markSyncing();
    await loadOrders(true);
  }, 10000);
});

/* ============================================================
   LOAD DATA
   ============================================================ */
async function loadOrders(silent = false) {
  if (!silent) showPageLoader('orders-table-container');

  try {
    const data = await Orders.getAll();
    // Normalise response shape
    state.allOrders = Array.isArray(data)
      ? data
      : (data?.items ?? data?.orders ?? []);
  } catch (err) {
    if (!silent) toast(`Failed to load orders: ${err.message}`, 'error');
    state.allOrders = [];
  } finally {
    applyFilters();
  }
}

/* ============================================================
   FILTER & SORT
   ============================================================ */
function applyFilters() {
  const { search, status, priority, warehouse } = state.filters;
  const term = search.toLowerCase();

  state.filtered = state.allOrders.filter(order => {
    const orderNum = (order.order_number ?? '').toLowerCase();
    const cust     = (order.customer_name ?? '').toLowerCase();
    const custId   = (order.customer_id ?? '').toLowerCase();
    const matchSearch = !term
      || orderNum.includes(term)
      || cust.includes(term)
      || custId.includes(term);

    const matchStatus   = !status   || (order.status   ?? '').toLowerCase() === status;
    const matchPriority = !priority || (order.priority ?? '').toLowerCase() === priority;
    const matchWarehouse= !warehouse || String(order.fulfillment_warehouse_id ?? '') === warehouse;

    return matchSearch && matchStatus && matchPriority && matchWarehouse;
  });

  // Sort
  state.filtered = sortBy(state.filtered, state.sortKey, state.sortDir);

  // Reset to page 1 on new filter
  state.page = 1;
  renderTable();
  populateWarehouseFilter();
  updateFilterSummary();
}

function populateWarehouseFilter() {
  const sel = document.getElementById('filter-warehouse');
  if (!sel || sel.dataset.populated === 'true') return;

  const ids = [...new Set(state.allOrders.map(o => o.fulfillment_warehouse_id).filter(Boolean))];
  ids.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `Warehouse ${id}`;
    sel.appendChild(opt);
  });
  sel.dataset.populated = 'true';
}

function updateFilterSummary() {
  const el = document.getElementById('orders-count');
  if (el) el.textContent = `${formatNumber(state.filtered.length)} of ${formatNumber(state.allOrders.length)} orders`;
}

/* ============================================================
   RENDER TABLE
   ============================================================ */
function renderTable() {
  const container = document.getElementById('orders-table-container');
  if (!container) return;

  if (state.filtered.length === 0) {
    showEmpty('orders-table-container', 'No orders found', 'Try adjusting your filters or search terms.');
    document.getElementById('orders-pagination-container').innerHTML = '';
    return;
  }

  const { items, ...pagination } = paginate(state.filtered, state.page, state.perPage);

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table" id="orders-table">
        <thead>
          <tr>
            <th class="sortable ${state.sortKey === 'order_number' ? 'sorted' : ''}" data-key="order_number">
              Order # <span class="table__sort-icon">${sortIcon('order_number')}</span>
            </th>
            <th class="sortable ${state.sortKey === 'customer_name' ? 'sorted' : ''}" data-key="customer_name">
              Customer <span class="table__sort-icon">${sortIcon('customer_name')}</span>
            </th>
            <th class="sortable ${state.sortKey === 'status' ? 'sorted' : ''}" data-key="status">
              Status <span class="table__sort-icon">${sortIcon('status')}</span>
            </th>
            <th class="sortable ${state.sortKey === 'priority' ? 'sorted' : ''}" data-key="priority">
              Priority <span class="table__sort-icon">${sortIcon('priority')}</span>
            </th>
            <th class="sortable ${state.sortKey === 'total_amount' ? 'sorted' : ''}" data-key="total_amount">
              Amount <span class="table__sort-icon">${sortIcon('total_amount')}</span>
            </th>
            <th>Channel</th>
            <th class="sortable ${state.sortKey === 'created_at' ? 'sorted' : ''}" data-key="created_at">
              Created <span class="table__sort-icon">${sortIcon('created_at')}</span>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(order => orderRowHTML(order)).join('')}
        </tbody>
      </table>
    </div>`;

  // Bind sort headers
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      state.filtered = sortBy(state.filtered, state.sortKey, state.sortDir);
      renderTable();
    });
  });

  // Bind action buttons
  container.querySelectorAll('.btn-update-status').forEach(btn => {
    btn.addEventListener('click', () => openStatusModal(btn.dataset.id, btn.dataset.status));
  });

  container.querySelectorAll('.btn-allocate').forEach(btn => {
    btn.addEventListener('click', () => allocateOrder(btn.dataset.id, btn));
  });

  // Pagination
  renderPagination('orders-pagination-container', pagination, (newPage) => {
    state.page = newPage;
    renderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function orderRowHTML(order) {
  const id        = order.id ?? '—';
  const orderNum  = order.order_number ?? '—';
  const customer  = order.customer_name ?? '—';
  const status    = order.status ?? 'created';
  const priority  = order.priority ?? 'standard';
  const amount    = order.total_amount ?? 0;
  const channel   = order.source_channel ?? '—';
  const created   = order.created_at;

  return `
    <tr>
      <td><span class="table__id">${escapeHtml(orderNum)}</span></td>
      <td>
        <div style="font-weight:500">${escapeHtml(customer)}</div>
        <div class="text-xs text-muted">${escapeHtml(order.customer_id ?? '')}</div>
      </td>
      <td>${statusBadge(status)}</td>
      <td>${priorityBadge(priority)}</td>
      <td>$${formatNumber(amount, 2)}</td>
      <td><span class="tag">${escapeHtml(channel)}</span></td>
      <td class="text-muted">${formatDate(created)}</td>
      <td>
        <div class="table__actions">
          <button class="btn btn--secondary btn--sm btn-update-status"
            data-id="${escapeHtml(String(id))}"
            data-status="${escapeHtml(status)}"
            title="Update status">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0
                112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Update
          </button>
          <button class="btn btn--primary btn--sm btn-allocate"
            data-id="${escapeHtml(String(id))}"
            title="Allocate order">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 13l4 4L19 7"/>
            </svg>
            Allocate
          </button>
        </div>
      </td>
    </tr>`;
}

function sortIcon(key) {
  if (state.sortKey !== key) return '↕';
  return state.sortDir === 'asc' ? '↑' : '↓';
}

/* ============================================================
   BIND FILTER CONTROLS
   ============================================================ */
function bindFilterControls() {
  const search  = document.getElementById('search-orders');
  const status  = document.getElementById('filter-status');
  const priority= document.getElementById('filter-priority');
  const warehouse = document.getElementById('filter-warehouse');
  const clearBtn  = document.getElementById('clear-filters');

  const onSearch = debounce(e => {
    state.filters.search = e.target.value;
    applyFilters();
  }, 300);

  if (search)   search.addEventListener('input', onSearch);
  if (status)   status.addEventListener('change', e => { state.filters.status   = e.target.value; applyFilters(); });
  if (priority) priority.addEventListener('change', e => { state.filters.priority = e.target.value; applyFilters(); });
  if (warehouse)warehouse.addEventListener('change', e => { state.filters.warehouse= e.target.value; applyFilters(); });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.filters = { search: '', status: '', priority: '', warehouse: '' };
      if (search)   search.value   = '';
      if (status)   status.value   = '';
      if (priority) priority.value = '';
      if (warehouse)warehouse.value= '';
      applyFilters();
    });
  }
}

function bindSortControls() {
  // handled inside renderTable via event delegation
}

/* ============================================================
   STATUS UPDATE MODAL
   ============================================================ */
let _currentOrderId = null;

function openStatusModal(orderId, currentStatus) {
  _currentOrderId = orderId;

  const modal = document.getElementById('status-modal');
  const currentEl = document.getElementById('modal-current-status');
  const select    = document.getElementById('modal-new-status');
  const orderIdEl = document.getElementById('modal-order-id');

  if (orderIdEl) orderIdEl.textContent = `#${orderId}`;
  if (currentEl) currentEl.innerHTML   = statusBadge(currentStatus);

  // Populate select options
  if (select) {
    select.innerHTML = ORDER_STATUSES.map(s =>
      `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');
  }

  modal?.classList.add('active');
}

function closeStatusModal() {
  const modal = document.getElementById('status-modal');
  modal?.classList.remove('active');
  _currentOrderId = null;
}

// Bind modal buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-cancel')?.addEventListener('click', closeStatusModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStatusModal();
  });

  document.getElementById('modal-confirm')?.addEventListener('click', async () => {
    if (!_currentOrderId) return;
    const select = document.getElementById('modal-new-status');
    const newStatus = select?.value;
    if (!newStatus) return;

    const btn = document.getElementById('modal-confirm');
    btn.classList.add('loading');
    btn.innerHTML = '<div class="spinner spinner--sm spinner--white"></div> Saving…';

    try {
      await Orders.updateStatus(_currentOrderId, newStatus);

      // Update local state
      const order = state.allOrders.find(o => String(o.id) === String(_currentOrderId));
      if (order) order.status = newStatus;

      toast(`Order #${_currentOrderId} status updated to "${newStatus}"`, 'success');
      closeStatusModal();
      applyFilters();
    } catch (err) {
      toast(`Failed to update status: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('loading');
      btn.innerHTML = 'Save Changes';
    }
  });
});

/* ============================================================
   ALLOCATE ORDER
   ============================================================ */
async function allocateOrder(orderId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner--sm spinner--white"></div>';

  try {
    await Orders.allocate(orderId);
    toast(`Order #${orderId} allocated successfully`, 'success');

    // Update local state
    const order = state.allOrders.find(o => String(o.id) === String(orderId));
    if (order) order.status = 'picked';
    applyFilters();
  } catch (err) {
    toast(`Allocation failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg> Allocate`;
  }
}
