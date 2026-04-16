/**
 * shipments.js — Shipments Page Controller
 * Features: shipments table, live tracking by tracking number,
 * status timeline, filtering, status updates.
 * Auto-polls every 10 seconds.
 */

import { Shipments } from './api.js';
import {
  initShell, markSyncing,
  formatDate, formatDateTime, formatNumber,
  statusBadge,
  showPageLoader, showError, showEmpty,
  escapeHtml, toast,
  sortBy, debounce, paginate, renderPagination,
  startPolling,
} from './utils.js';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  shipments: [],
  filtered:  [],
  carriers:  {},          // carrier_id → { name, code, carrier_type }
  sortKey:   'created_at',
  sortDir:   'desc',
  page:      1,
  perPage:   20,
  filters: {
    search:   '',
    status:   '',
  },
  tracking: null,
};

const SHIPMENT_STATUSES = ['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'];

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await initShell('shipments', 'Shipments');
  await loadCarriers();
  await loadShipments();

  bindFilterControls();
  bindTrackingPanel();

  startPolling('shipments', async () => {
    markSyncing();
    await loadShipments(true);
  }, 10000);
});

/* ============================================================
   LOAD CARRIERS (once)
   ============================================================ */
async function loadCarriers() {
  try {
    const data = await Shipments.getCarriers();
    const list = Array.isArray(data) ? data : [];
    for (const c of list) {
      state.carriers[c.id] = { name: c.name, code: c.code, carrier_type: c.carrier_type };
    }
  } catch (_) { /* carriers are optional for display */ }
}

/* ============================================================
   LOAD DATA
   ============================================================ */
async function loadShipments(silent = false) {
  if (!silent) showPageLoader('shipments-table-container');

  try {
    const data = await Shipments.getAll();
    state.shipments = Array.isArray(data) ? data : (data?.items ?? data?.shipments ?? []);
  } catch (err) {
    if (!silent) toast(`Failed to load shipments: ${err.message}`, 'error');
    state.shipments = [];
  } finally {
    applyFilters();
  }
}

/* ============================================================
   FILTERS
   ============================================================ */
function applyFilters() {
  const { search, status } = state.filters;
  const term = search.toLowerCase();

  state.filtered = state.shipments.filter(s => {
    const tracking    = (s.tracking_number ?? '').toLowerCase();
    const carrierName = (state.carriers[s.carrier_id]?.name ?? '').toLowerCase();
    const orderId     = String(s.order_id ?? '').toLowerCase();

    const matchSearch = !term
      || tracking.includes(term)
      || carrierName.includes(term)
      || orderId.includes(term);

    const matchStatus = !status || (s.status ?? '').toLowerCase() === status;
    return matchSearch && matchStatus;
  });

  state.filtered = sortBy(state.filtered, state.sortKey, state.sortDir);
  state.page = 1;
  renderTable();
  renderShipmentKPIs();
}

function renderShipmentKPIs() {
  const total    = state.shipments.length;
  const inTransit= state.shipments.filter(s => s.status === 'in_transit').length;
  const delayed  = state.shipments.filter(s => s.status === 'exception').length;
  const delivered= state.shipments.filter(s => s.status === 'delivered').length;

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setStat('stat-total-shipments',  total);
  setStat('stat-in-transit',       inTransit);
  setStat('stat-delayed',          delayed);
  setStat('stat-delivered',        delivered);
}

/* ============================================================
   RENDER TABLE
   ============================================================ */
function renderTable() {
  const container = document.getElementById('shipments-table-container');
  if (!container) return;

  if (state.filtered.length === 0) {
    showEmpty('shipments-table-container', 'No shipments found', 'Try adjusting your filters.');
    document.getElementById('shipments-pagination')?.replaceChildren();
    return;
  }

  const { items, ...pagination } = paginate(state.filtered, state.page, state.perPage);

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Tracking #</th>
            <th>Order ID</th>
            <th>Carrier</th>
            <th class="sortable ${state.sortKey === 'status' ? 'sorted' : ''}" data-key="status"
              style="cursor:pointer">Status ${state.sortKey === 'status' ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕'}</th>
            <th>Est. Delivery</th>
            <th class="sortable ${state.sortKey === 'created_at' ? 'sorted' : ''}" data-key="created_at"
              style="cursor:pointer">Shipped On ${state.sortKey === 'created_at' ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕'}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(s => shipmentRowHTML(s)).join('')}
        </tbody>
      </table>
    </div>`;

  // Sort
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      applyFilters();
    });
  });

  // Track button
  container.querySelectorAll('.btn-track').forEach(btn => {
    btn.addEventListener('click', () => trackShipment(btn.dataset.tracking));
  });

  // Update status
  container.querySelectorAll('.btn-update-shipment').forEach(btn => {
    btn.addEventListener('click', () => openStatusModal(btn.dataset.id, btn.dataset.status));
  });

  renderPagination('shipments-pagination', pagination, p => {
    state.page = p;
    renderTable();
  });
}

function shipmentRowHTML(s) {
  const tracking    = s.tracking_number ?? '—';
  const orderId     = s.order_id ?? '—';
  const carrierInfo = state.carriers[s.carrier_id];
  const carrierName = carrierInfo?.name ?? '—';
  const carrierType = carrierInfo?.carrier_type ?? '';
  const status      = s.status ?? 'pending';
  const estDelivery = s.estimated_delivery;
  const shippedOn   = s.shipped_at ?? s.created_at;
  const isDelayed   = status === 'exception';

  return `
    <tr style="${isDelayed ? 'background:var(--clr-danger-light)' : ''}">
      <td>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="table__id">${escapeHtml(tracking)}</span>
          ${isDelayed ? `<span class="badge badge--critical badge--dot" style="font-size:.625rem">Exception</span>` : ''}
        </div>
      </td>
      <td><span class="table__id">${escapeHtml(String(orderId).slice(0, 8))}…</span></td>
      <td>
        <div style="font-weight:500">${escapeHtml(carrierName)}</div>
        ${carrierType ? `<div class="text-xs text-muted">${escapeHtml(carrierType)}</div>` : ''}
      </td>
      <td>${statusBadge(status)}</td>
      <td class="${isDelayed ? 'text-danger font-semibold' : 'text-muted'}">
        ${estDelivery ? formatDate(estDelivery) : '—'}
      </td>
      <td class="text-muted">${formatDate(shippedOn)}</td>
      <td>
        <div class="table__actions">
          <button class="btn btn--secondary btn--sm btn-track"
            data-tracking="${escapeHtml(tracking)}"
            title="Track shipment">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6
                3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
            </svg>
            Track
          </button>
          <button class="btn btn--ghost btn--sm btn-update-shipment"
            data-id="${escapeHtml(String(s.id ?? s.shipment_id ?? ''))}"
            data-status="${escapeHtml(status)}"
            title="Update status">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0
                112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
}

/* ============================================================
   TRACKING PANEL
   ============================================================ */
function bindTrackingPanel() {
  const input = document.getElementById('tracking-input');
  const btn   = document.getElementById('track-btn');
  const panel = document.getElementById('tracking-result');

  if (btn) {
    btn.addEventListener('click', async () => {
      const num = input?.value?.trim();
      if (!num) {
        toast('Enter a tracking number', 'warning');
        return;
      }
      await trackShipment(num);
    });
  }

  if (input) {
    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        const num = input.value?.trim();
        if (num) await trackShipment(num);
      }
    });
  }
}

async function trackShipment(trackingNumber) {
  if (!trackingNumber || trackingNumber === '—') return;

  const panel  = document.getElementById('tracking-result');
  const input  = document.getElementById('tracking-input');

  if (input && !input.value) input.value = trackingNumber;
  if (!panel) return;

  panel.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Fetching tracking info…</span></div>';
  panel.classList.remove('hidden');

  try {
    const data = await Shipments.track(trackingNumber);
    state.tracking = data;
    renderTrackingResult(panel, data);
  } catch (err) {
    panel.innerHTML = `
      <div class="alert alert--danger">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
        <span>Tracking not found: <strong>${escapeHtml(trackingNumber)}</strong>. ${escapeHtml(err.message)}</span>
      </div>`;
  }
}

function renderTrackingResult(container, data) {
  if (!data) {
    container.innerHTML = '<div class="empty-state__title">No tracking data found</div>';
    return;
  }

  const tracking    = data.tracking_number ?? '—';
  const carrierInfo = state.carriers[data.carrier_id];
  const carrierName = carrierInfo?.name ?? '—';
  const status      = data.status ?? 'unknown';
  const events      = data.events ?? [];

  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <div class="card__title">Tracking: ${escapeHtml(tracking)}</div>
          <div class="card__subtitle">${escapeHtml(carrierName)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          ${statusBadge(status)}
          <button class="btn btn--ghost btn--sm" id="close-tracking">✕</button>
        </div>
      </div>
      <div class="card__body">
        ${events.length > 0 ? timelineHTML(events) : `
          <div class="stat-row">
            <span class="stat-row__label">Status</span>
            <span class="stat-row__value">${statusBadge(status)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row__label">Est. Delivery</span>
            <span class="stat-row__value">${formatDate(data.estimated_delivery)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row__label">Shipped At</span>
            <span class="stat-row__value">${formatDateTime(data.shipped_at)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row__label">Weight</span>
            <span class="stat-row__value">${data.weight_kg ? data.weight_kg + ' kg' : '—'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row__label">Cost</span>
            <span class="stat-row__value">${data.cost ? '$' + formatNumber(data.cost, 2) : '—'}</span>
          </div>`}
      </div>
    </div>`;

  container.querySelector('#close-tracking')?.addEventListener('click', () => {
    container.innerHTML = '';
    container.classList.add('hidden');
    const input = document.getElementById('tracking-input');
    if (input) input.value = '';
  });
}

function timelineHTML(events) {
  return `
    <div class="timeline">
      ${events.map((ev, idx) => {
        const isFirst = idx === 0;
        const status  = ev.status ?? ev.event ?? 'update';
        const time    = ev.timestamp ?? ev.date ?? ev.time;
        const location= ev.location ?? ev.city ?? '';
        return `
          <div class="timeline__item">
            <div class="timeline__dot ${isFirst ? 'current' : 'completed'}">
              ${isFirst
                ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 12l2 2 4-4"/>
                   </svg>`
                : ''}
            </div>
            <div class="timeline__title">${escapeHtml(String(status).replace(/_/g, ' '))}</div>
            ${location ? `<div class="timeline__time">${escapeHtml(location)}</div>` : ''}
            <div class="timeline__time">${formatDateTime(time)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

/* ============================================================
   STATUS UPDATE MODAL
   ============================================================ */
let _currentShipmentId = null;

function openStatusModal(shipmentId, currentStatus) {
  _currentShipmentId = shipmentId;
  const modal   = document.getElementById('shipment-status-modal');
  const idEl    = document.getElementById('ship-modal-id');
  const curEl   = document.getElementById('ship-modal-current');
  const select  = document.getElementById('ship-modal-status');

  if (idEl)   idEl.textContent  = `#${shipmentId}`;
  if (curEl)  curEl.innerHTML   = statusBadge(currentStatus);
  if (select) {
    select.innerHTML = SHIPMENT_STATUSES.map(s =>
      `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');
  }
  modal?.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ship-modal-cancel')?.addEventListener('click', closeShipmentModal);
  document.getElementById('shipment-status-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShipmentModal();
  });

  document.getElementById('ship-modal-confirm')?.addEventListener('click', async () => {
    const select    = document.getElementById('ship-modal-status');
    const newStatus = select?.value;
    if (!newStatus || !_currentShipmentId) return;

    const btn = document.getElementById('ship-modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner spinner--sm spinner--white"></div> Saving…';

    try {
      await Shipments.updateStatus(_currentShipmentId, newStatus);

      const shipment = state.shipments.find(
        s => String(s.id) === String(_currentShipmentId)
      );
      if (shipment) shipment.status = newStatus;

      toast(`Shipment #${_currentShipmentId} updated to "${newStatus}"`, 'success');
      closeShipmentModal();
      applyFilters();
    } catch (err) {
      toast(`Failed to update: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Save';
    }
  });
});

function closeShipmentModal() {
  document.getElementById('shipment-status-modal')?.classList.remove('active');
  _currentShipmentId = null;
}

/* ============================================================
   FILTER CONTROLS
   ============================================================ */
function bindFilterControls() {
  const search = document.getElementById('search-shipments');
  const status = document.getElementById('filter-ship-status');

  if (search) {
    search.addEventListener('input', debounce(e => {
      state.filters.search = e.target.value;
      applyFilters();
    }, 300));
  }

  if (status) {
    status.addEventListener('change', e => {
      state.filters.status = e.target.value;
      applyFilters();
    });
  }
}
