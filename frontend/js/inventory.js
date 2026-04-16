/**
 * inventory.js — Inventory Page Controller
 * Features: stock level table with low-stock highlighting,
 * movements table, below-reorder alert section, filtering.
 * Auto-polls every 10 seconds.
 */

import { Inventory } from './api.js';
import {
  initShell, markSyncing,
  formatDate, formatNumber,
  statusBadge,
  showPageLoader, showError, showEmpty,
  escapeHtml, toast,
  sortBy, debounce, paginate, renderPagination,
  startPolling,
  CHART_COLORS, CHART_PALETTE, chartDefaults,
} from './utils.js';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  stock:     [],
  movements: [],
  lowStock:  [],
  filteredStock:     [],
  filteredMovements: [],
  activeTab: 'stock',      // 'stock' | 'movements' | 'alerts'
  stockPage: 1,
  movPage:   1,
  perPage:   20,
  sortKey:   'quantity',
  sortDir:   'asc',
  search:    '',
  warehouseFilter: '',
};

let stockChart = null;

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await initShell('inventory', 'Inventory');
  await loadInventory();

  bindTabControls();
  bindFilterControls();

  startPolling('inventory', async () => {
    markSyncing();
    await loadInventory(true);
  }, 10000);
});

/* ============================================================
   LOAD DATA
   ============================================================ */
async function loadInventory(silent = false) {
  if (!silent) showPageLoader('inventory-content');

  try {
    const [stockRes, movRes, lowRes] = await Promise.allSettled([
      Inventory.getStockLevels(),
      Inventory.getMovements(),
      Inventory.getBelowReorder(),
    ]);

    if (stockRes.status === 'fulfilled') {
      const raw = stockRes.value;
      state.stock = Array.isArray(raw) ? raw : (raw?.items ?? raw?.stock ?? []);
    }

    if (movRes.status === 'fulfilled') {
      const raw = movRes.value;
      state.movements = Array.isArray(raw) ? raw : (raw?.items ?? raw?.movements ?? []);
    }

    if (lowRes.status === 'fulfilled') {
      const raw = lowRes.value;
      state.lowStock = Array.isArray(raw) ? raw : (raw?.items ?? []);
    }

    populateWarehouseFilter();
    updateAlertBadge();
    applyStockFilters();
    applyMovementFilters();
    renderActiveTab();
  } catch (err) {
    showError('inventory-content', `Failed to load inventory: ${err.message}`);
  }
}

function populateWarehouseFilter() {
  const sel = document.getElementById('filter-inv-warehouse');
  if (!sel || sel.dataset.populated === 'true') return;
  const ids = [...new Set(state.stock.map(i => i.warehouse_id).filter(Boolean))];
  ids.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `WH ${String(id).slice(0, 8)}…`;
    sel.appendChild(opt);
  });
  if (ids.length) sel.dataset.populated = 'true';
}

function updateAlertBadge() {
  const badge = document.getElementById('low-stock-badge');
  if (badge) {
    badge.textContent = state.lowStock.length;
    badge.style.display = state.lowStock.length ? 'inline-block' : 'none';
  }
}

/* ============================================================
   TAB CONTROLS
   ============================================================ */
function bindTabControls() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });
}

function renderActiveTab() {
  switch (state.activeTab) {
    case 'stock':     renderStockTable();      break;
    case 'movements': renderMovementsTable();   break;
    case 'alerts':    renderLowStockAlerts();   break;
  }
}

/* ============================================================
   FILTER CONTROLS
   ============================================================ */
function bindFilterControls() {
  const searchInput = document.getElementById('search-inventory');
  const warehouseSel = document.getElementById('filter-inv-warehouse');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => {
      state.search = e.target.value.toLowerCase();
      applyStockFilters();
      applyMovementFilters();
      renderActiveTab();
    }, 300));
  }

  if (warehouseSel) {
    warehouseSel.addEventListener('change', e => {
      state.warehouseFilter = e.target.value;
      applyStockFilters();
      renderActiveTab();
    });
  }
}

function applyStockFilters() {
  const term = state.search;
  state.filteredStock = state.stock.filter(item => {
    const name = (item.product_name ?? '').toLowerCase();
    const sku  = (item.sku ?? '').toLowerCase();
    const wh   = String(item.warehouse_id ?? '');
    const matchSearch    = !term || name.includes(term) || sku.includes(term);
    const matchWarehouse = !state.warehouseFilter || wh === state.warehouseFilter;
    return matchSearch && matchWarehouse;
  });
  state.filteredStock = sortBy(state.filteredStock, state.sortKey, state.sortDir);
  state.stockPage = 1;
}

function applyMovementFilters() {
  const term = state.search;
  state.filteredMovements = state.movements.filter(m => {
    const pid    = (m.product_id ?? '').toLowerCase();
    const reason = (m.reason ?? '').toLowerCase();
    const type   = (m.movement_type ?? '').toLowerCase();
    return !term || pid.includes(term) || reason.includes(term) || type.includes(term);
  });
  state.movPage = 1;
}

/* ============================================================
   STOCK LEVELS TABLE
   ============================================================ */
function renderStockTable() {
  const container = document.getElementById('inventory-content');
  if (!container) return;

  if (state.filteredStock.length === 0) {
    showEmpty('inventory-content', 'No stock data', 'Inventory data will appear once loaded from the backend.');
    return;
  }

  const { items, ...pagination } = paginate(state.filteredStock, state.stockPage, state.perPage);

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>SKU / Product</th>
            <th>Warehouse</th>
            <th class="sortable ${state.sortKey === 'quantity' ? 'sorted' : ''}" data-key="quantity"
              style="cursor:pointer">
              Quantity ${state.sortKey === 'quantity' ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕'}
            </th>
            <th>Reorder Point</th>
            <th>Status</th>
            <th>Stock Health</th>
            <th>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => stockRowHTML(item)).join('')}
        </tbody>
      </table>
    </div>`;

  // Sort header
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      state.sortKey = key;
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      applyStockFilters();
      renderStockTable();
    });
  });

  renderPagination('inventory-pagination', pagination, p => {
    state.stockPage = p;
    renderStockTable();
  });
}

function stockRowHTML(item) {
  const qty       = item.quantity ?? 0;
  const reserved  = item.reserved_quantity ?? 0;
  const available = qty - reserved;
  const reorder   = item.reorder_point ?? 0;
  const isLow     = qty <= reorder;
  const isCritical= qty <= (reorder * 0.5);

  const healthPct = reorder > 0 ? Math.min(100, Math.round((qty / (reorder * 3)) * 100)) : 100;
  const healthColor = isCritical ? 'danger' : isLow ? 'warning' : 'success';

  const badgeType = isCritical ? 'critical' : isLow ? 'warning' : 'success';
  const badgeLabel = isCritical ? 'Critical' : isLow ? 'Low Stock' : 'In Stock';

  return `
    <tr class="${isCritical ? 'row--highlight' : ''}">
      <td>
        <div style="font-weight:600">${escapeHtml(item.product_name ?? '—')}</div>
        <div class="text-xs text-muted font-mono">${escapeHtml(item.sku ?? '—')}</div>
      </td>
      <td><span class="tag">${escapeHtml(String(item.warehouse_id ?? '—').slice(0, 8))}…</span></td>
      <td>
        <span style="font-weight:700;font-size:1rem;color:${isCritical ? 'var(--clr-danger)' : isLow ? 'var(--clr-warning)' : 'var(--clr-text)'}">
          ${formatNumber(qty)}
        </span>
        ${reserved > 0 ? `<div class="text-xs text-muted">${formatNumber(reserved)} reserved</div>` : ''}
      </td>
      <td class="text-muted">${formatNumber(reorder)}</td>
      <td><span class="badge badge--${badgeType} badge--dot">${badgeLabel}</span></td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:.5rem">
          <div class="progress-bar" style="flex:1">
            <div class="progress-bar__fill progress-bar__fill--${healthColor}" style="width:${healthPct}%"></div>
          </div>
          <span class="text-xs text-muted">${healthPct}%</span>
        </div>
      </td>
      <td class="text-muted">${formatDate(item.last_counted_at ?? item.created_at)}</td>
    </tr>`;
}

/* ============================================================
   MOVEMENTS TABLE
   ============================================================ */
function renderMovementsTable() {
  const container = document.getElementById('inventory-content');
  if (!container) return;

  if (state.filteredMovements.length === 0) {
    showEmpty('inventory-content', 'No movements recorded', 'Stock movements will appear once inventory is updated.');
    return;
  }

  const { items, ...pagination } = paginate(state.filteredMovements, state.movPage, state.perPage);

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Movement ID</th>
            <th>Product</th>
            <th>Type</th>
            <th>Quantity</th>
            <th>From → To</th>
            <th>Reason</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(m => movementRowHTML(m)).join('')}
        </tbody>
      </table>
    </div>`;

  renderPagination('inventory-pagination', pagination, p => {
    state.movPage = p;
    renderMovementsTable();
  });
}

function movementRowHTML(m) {
  const type     = m.movement_type ?? 'transfer';
  const qty      = m.quantity ?? 0;
  const isInbound = type === 'inbound' || type === 'return';
  const qtyColor  = isInbound ? 'var(--clr-success)' : 'var(--clr-danger)';
  const qtyPrefix = isInbound ? '+' : '−';
  const fromWh   = m.from_warehouse_id ? String(m.from_warehouse_id).slice(0, 8) + '…' : '—';
  const toWh     = m.to_warehouse_id   ? String(m.to_warehouse_id).slice(0, 8) + '…' : '—';

  return `
    <tr>
      <td><span class="table__id">${escapeHtml(String(m.id ?? '—').slice(0, 8))}…</span></td>
      <td>
        <div style="font-weight:500">${escapeHtml(String(m.product_id ?? '—').slice(0, 8))}…</div>
      </td>
      <td>${statusBadge(type)}</td>
      <td>
        <span style="font-weight:700;color:${qtyColor}">${qtyPrefix}${formatNumber(qty)}</span>
      </td>
      <td class="text-muted text-sm">
        ${escapeHtml(fromWh)} → ${escapeHtml(toWh)}
      </td>
      <td>
        ${m.reason
          ? `<span class="text-sm">${escapeHtml(m.reason)}</span>`
          : `<span class="text-muted">${escapeHtml(m.reference_type ?? '—')}</span>`}
      </td>
      <td class="text-muted">${formatDate(m.created_at)}</td>
    </tr>`;
}

/* ============================================================
   LOW STOCK ALERTS
   ============================================================ */
function renderLowStockAlerts() {
  const container = document.getElementById('inventory-content');
  if (!container) return;

  if (state.lowStock.length === 0) {
    container.innerHTML = `
      <div class="alert alert--success" style="margin:1.5rem">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>All inventory items are above their reorder points. No action needed.</span>
      </div>`;
    return;
  }

  const sorted = [...state.lowStock].sort((a, b) => {
    const aq = a.total_quantity ?? 0;
    const bq = b.total_quantity ?? 0;
    return aq - bq; // most critical first
  });

  container.innerHTML = `
    <div style="padding:.25rem">
      <div class="alert alert--warning" style="margin-bottom:1rem">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        <span><strong>${sorted.length} items</strong> are below their reorder threshold and require attention.</span>
      </div>
      ${sorted.map(item => lowStockCardHTML(item)).join('')}
    </div>`;
}

function lowStockCardHTML(item) {
  const qty      = item.total_quantity ?? 0;
  const reorder  = item.reorder_point ?? 0;
  const isCritical = reorder > 0 && qty <= (reorder * 0.5);
  const deficit  = Math.max(0, reorder - qty);
  const severity = isCritical ? 'critical' : 'warning';
  const pct      = reorder > 0 ? Math.round(Math.min(100, (qty / reorder) * 100)) : 0;

  return `
    <div class="anomaly-card anomaly-card--${isCritical ? 'critical' : 'warning'}">
      <div class="anomaly-card__icon"
        style="background:var(--clr-${isCritical ? 'danger' : 'warning'}-light);color:var(--clr-${isCritical ? 'danger' : 'warning'})">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
        </svg>
      </div>
      <div class="anomaly-card__content">
        <div class="anomaly-card__title">${escapeHtml(item.product_name ?? '—')}</div>
        <div class="anomaly-card__description">
          Current: <strong style="color:var(--clr-${isCritical ? 'danger' : 'warning'})">${formatNumber(qty)}</strong> units
          · Reorder at: <strong>${formatNumber(reorder)}</strong> units
          · Deficit: <strong>${formatNumber(deficit)}</strong> units
        </div>
        <div class="anomaly-card__meta">
          ${item.warehouse_id ? `<span>WH: ${escapeHtml(String(item.warehouse_id).slice(0, 8))}…</span>` : ''}
          <span class="badge badge--${severity} badge--dot">${isCritical ? 'Critical' : 'Low Stock'}</span>
        </div>
      </div>
      <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:.375rem">
        <div style="font-size:0.75rem;color:var(--clr-text-muted)">vs Reorder</div>
        <div style="font-size:1.25rem;font-weight:800;color:var(--clr-${isCritical ? 'danger' : 'warning'})">
          ${pct}%
        </div>
      </div>
    </div>`;
}
