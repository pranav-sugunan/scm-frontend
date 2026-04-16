/**
 * warehouses.js — Warehouses Page Controller
 * Features: warehouse card grid, zone detail modal,
 * bin listing per zone, utilization charts.
 */

import { Warehouses } from './api.js';
import {
  initShell, markSyncing,
  formatNumber,
  statusBadge,
  showPageLoader, showError, showEmpty,
  escapeHtml, toast,
  startPolling,
  CHART_COLORS, CHART_PALETTE, chartDefaults,
} from './utils.js';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  warehouses: [],
  selectedWarehouse: null,
  zones: [],
};

let utilizationChart = null;

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await initShell('warehouses', 'Warehouses');
  await loadWarehouses();

  // Modal close
  document.getElementById('zones-modal-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeZonesModal();
  });
  document.getElementById('modal-close-btn')?.addEventListener('click', closeZonesModal);

  startPolling('warehouses', async () => {
    markSyncing();
    await loadWarehouses(true);
  }, 10000);
});

/* ============================================================
   LOAD WAREHOUSES
   ============================================================ */
async function loadWarehouses(silent = false) {
  if (!silent) showPageLoader('warehouses-container');

  try {
    const data = await Warehouses.getAll();
    state.warehouses = Array.isArray(data) ? data : (data?.items ?? data?.warehouses ?? []);
  } catch (err) {
    if (!silent) toast(`Failed to load warehouses: ${err.message}`, 'error');
    state.warehouses = [];
  } finally {
    renderWarehouseCards();
    renderSummaryKPIs();
  }
}

/* ============================================================
   RENDER SUMMARY KPIs
   ============================================================ */
function renderSummaryKPIs() {
  const total       = state.warehouses.length;
  const active      = state.warehouses.filter(w => w.status === 'active').length;
  const totalSqft   = state.warehouses.reduce((s, w) => s + (w.capacity_sqft ?? 0), 0);
  const totalTPD    = state.warehouses.reduce((s, w) => s + (w.max_throughput_per_day ?? 0), 0);

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setStat('stat-total-wh',    total);
  setStat('stat-active-wh',   active);
  setStat('stat-capacity',    formatNumber(totalSqft) + ' sqft');
  setStat('stat-zones',       formatNumber(totalTPD) + '/day');
}

/* ============================================================
   WAREHOUSE CARDS
   ============================================================ */
function renderWarehouseCards() {
  const container = document.getElementById('warehouses-container');
  if (!container) return;

  if (state.warehouses.length === 0) {
    showEmpty('warehouses-container', 'No warehouses found', 'Warehouse data will appear once loaded.');
    return;
  }

  container.innerHTML = `
    <div class="warehouse-grid">
      ${state.warehouses.map(wh => warehouseCardHTML(wh)).join('')}
    </div>`;

  // Bind click to open zones
  container.querySelectorAll('.warehouse-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.warehouseId;
      const wh = state.warehouses.find(w => String(w.id ?? w.warehouse_id) === String(id));
      if (wh) openZonesModal(wh);
    });
  });
}

function warehouseCardHTML(wh) {
  const id         = wh.id ?? '—';
  const name       = wh.name ?? '—';
  const code       = wh.code ?? '';
  const whType     = (wh.warehouse_type ?? '').replace(/_/g, ' ');
  const location   = [wh.city, wh.state].filter(Boolean).join(', ') || '—';
  const status     = wh.status ?? 'active';
  const sqft       = wh.capacity_sqft ?? 0;
  const throughput = wh.max_throughput_per_day ?? 0;

  return `
    <div class="warehouse-card animate-fade-in" data-warehouse-id="${escapeHtml(String(id))}">
      <div class="warehouse-card__header">
        <div class="warehouse-card__icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1
              1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
          </svg>
        </div>
        ${statusBadge(status)}
      </div>

      <div class="warehouse-card__name">${escapeHtml(name)}</div>
      <div class="text-xs text-muted font-mono" style="margin-top:.125rem">${escapeHtml(code)}</div>
      <div class="warehouse-card__location">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        ${escapeHtml(location)}
      </div>

      <div class="warehouse-card__stats">
        <div>
          <div class="warehouse-card__stat-label">Type</div>
          <div class="warehouse-card__stat-value" style="font-size:.8125rem;text-transform:capitalize">${escapeHtml(whType)}</div>
        </div>
        <div>
          <div class="warehouse-card__stat-label">Capacity</div>
          <div class="warehouse-card__stat-value">${formatNumber(sqft)} sqft</div>
        </div>
        <div>
          <div class="warehouse-card__stat-label">Throughput</div>
          <div class="warehouse-card__stat-value">${formatNumber(throughput)}/day</div>
        </div>
      </div>

      <div style="margin-top:.875rem;padding-top:.75rem;border-top:1px solid var(--clr-border);
        display:flex;align-items:center;justify-content:space-between">
        <span class="text-xs text-muted">Click to view zones</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          style="width:14px;height:14px;color:var(--clr-primary)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
    </div>`;
}

/* ============================================================
   ZONES MODAL
   ============================================================ */
async function openZonesModal(warehouse) {
  state.selectedWarehouse = warehouse;
  const modal    = document.getElementById('zones-modal-backdrop');
  const nameEl   = document.getElementById('modal-wh-name');
  const locationEl = document.getElementById('modal-wh-location');
  const zonesEl  = document.getElementById('zones-content');

  if (nameEl)   nameEl.textContent   = warehouse.name ?? `Warehouse ${warehouse.id}`;
  if (locationEl) locationEl.textContent = warehouse.location ?? warehouse.city ?? '—';

  modal?.classList.add('active');

  if (zonesEl) {
    zonesEl.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Loading zones…</span></div>';
  }

  try {
    const id   = warehouse.id ?? warehouse.warehouse_id;
    const data = await Warehouses.getZones(id);
    state.zones = Array.isArray(data) ? data : (data?.zones ?? data?.items ?? []);
    renderZones(zonesEl);
  } catch (err) {
    if (zonesEl) {
      zonesEl.innerHTML = `
        <div class="alert alert--danger">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
          <span>Could not load zones: ${escapeHtml(err.message)}</span>
        </div>`;
    }
  }
}

function closeZonesModal() {
  document.getElementById('zones-modal-backdrop')?.classList.remove('active');
  state.selectedWarehouse = null;
  state.zones = [];
}

function renderZones(container) {
  if (!container) return;

  if (state.zones.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">No zones configured</div>
        <div class="empty-state__description">This warehouse has no zones defined yet.</div>
      </div>`;
    return;
  }

  container.innerHTML = state.zones.map(zone => zoneCardHTML(zone)).join('');
}

function zoneCardHTML(zone) {
  const name  = zone.name ?? zone.zone_name ?? `Zone ${zone.id}`;
  const type  = zone.type ?? zone.zone_type ?? 'storage';
  const bins  = zone.bins ?? zone.bins_count ?? [];
  const binCount = Array.isArray(bins) ? bins.length : (zone.bins_count ?? 0);
  const capacity = zone.capacity ?? zone.total_capacity ?? 0;
  const used     = zone.used_capacity ?? zone.occupied ?? 0;
  const utilPct  = capacity > 0 ? Math.round((used / capacity) * 100) : 0;

  const binsHTML = Array.isArray(bins) && bins.length > 0
    ? `<div style="margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.375rem">
        ${bins.slice(0, 12).map(bin => `
          <span class="tag" style="cursor:default" title="Capacity: ${bin.capacity ?? '?'}">
            ${escapeHtml(bin.code ?? bin.name ?? bin.bin_id ?? String(bin))}
          </span>`).join('')}
        ${bins.length > 12 ? `<span class="tag">+${bins.length - 12} more</span>` : ''}
      </div>`
    : '';

  return `
    <div class="card" style="margin-bottom:.75rem">
      <div class="card__body">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.75rem">
          <div>
            <div style="font-weight:700;font-size:.9375rem">${escapeHtml(name)}</div>
            <div class="text-xs text-muted" style="margin-top:.125rem">
              ${escapeHtml(type)} · ${formatNumber(binCount)} bins
            </div>
          </div>
          ${statusBadge(type)}
        </div>
        ${capacity > 0 ? `
          <div style="margin-bottom:.5rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
              <span class="text-xs text-muted">Utilization</span>
              <span class="text-xs font-semibold">${utilPct}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-bar__fill progress-bar__fill--${utilPct > 80 ? 'warning' : 'success'}"
                style="width:${utilPct}%"></div>
            </div>
          </div>` : ''}
        ${binsHTML}
      </div>
    </div>`;
}
