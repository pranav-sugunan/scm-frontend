/**
 * warehouses.js — Warehouses Page Controller
 * Features: warehouse card grid, zone detail modal,
 * bin listing per zone, utilization charts.
 */

import { Warehouses, Analytics } from "./api.js";
import {
  initShell,
  markSyncing,
  formatNumber,
  formatDate,
  statusBadge,
  showPageLoader,
  showError,
  showEmpty,
  escapeHtml,
  toast,
  startPolling,
  CHART_COLORS,
  CHART_PALETTE,
  chartDefaults,
} from "./utils.js";

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
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("warehouses", "Warehouses");
  await loadWarehouses();

  // Modal close
  document
    .getElementById("zones-modal-backdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeZonesModal();
    });
  document
    .getElementById("modal-close-btn")
    ?.addEventListener("click", closeZonesModal);

  bindCreateWarehouseModal();
  bindCreateZoneModal();
  bindCreateBinModal();

  startPolling(
    "warehouses",
    async () => {
      markSyncing();
      await loadWarehouses(true);
    },
    10000,
  );
});

/* ============================================================
   LOAD WAREHOUSES
   ============================================================ */
async function loadWarehouses(silent = false) {
  if (!silent) showPageLoader("warehouses-container");

  try {
    const data = await Warehouses.getAll();
    state.warehouses = Array.isArray(data)
      ? data
      : (data?.items ?? data?.warehouses ?? []);
  } catch (err) {
    if (!silent) toast(`Failed to load warehouses: ${err.message}`, "error");
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
  const total = state.warehouses.length;
  const active = state.warehouses.filter((w) => w.status === "active").length;
  const totalSqft = state.warehouses.reduce(
    (s, w) => s + (w.capacity_sqft ?? 0),
    0,
  );
  const totalTPD = state.warehouses.reduce(
    (s, w) => s + (w.max_throughput_per_day ?? 0),
    0,
  );

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setStat("stat-total-wh", total);
  setStat("stat-active-wh", active);
  setStat("stat-capacity", formatNumber(totalSqft) + " sqft");
  setStat("stat-zones", formatNumber(totalTPD) + "/day");
}

/* ============================================================
   WAREHOUSE CARDS
   ============================================================ */
function renderWarehouseCards() {
  const container = document.getElementById("warehouses-container");
  if (!container) return;

  if (state.warehouses.length === 0) {
    showEmpty(
      "warehouses-container",
      "No warehouses found",
      "Warehouse data will appear once loaded.",
    );
    return;
  }

  container.innerHTML = `
    <div class="warehouse-grid">
      ${state.warehouses.map((wh) => warehouseCardHTML(wh)).join("")}
    </div>`;

  // Bind click to open zones
  container.querySelectorAll(".warehouse-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.warehouseId;
      const wh = state.warehouses.find(
        (w) => String(w.id ?? w.warehouse_id) === String(id),
      );
      if (wh) openZonesModal(wh);
    });
  });

  // Bind delete buttons
  container.querySelectorAll(".btn-delete-wh").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteWarehouse(btn.dataset.id);
    });
  });
}

function warehouseCardHTML(wh) {
  const id = wh.id ?? "—";
  const name = wh.name ?? "—";
  const code = wh.code ?? "";
  const whType = (wh.warehouse_type ?? "").replace(/_/g, " ");
  const location = [wh.city, wh.state].filter(Boolean).join(", ") || "—";
  const status = wh.status ?? "active";
  const sqft = wh.capacity_sqft ?? 0;
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
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn--ghost btn--sm btn-delete-wh" data-id="${escapeHtml(String(id))}" title="Delete warehouse" style="color:var(--clr-danger);padding:.25rem">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px;height:14px">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            style="width:14px;height:14px;color:var(--clr-primary)">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   ZONES MODAL
   ============================================================ */
async function openZonesModal(warehouse) {
  state.selectedWarehouse = warehouse;
  const modal = document.getElementById("zones-modal-backdrop");
  const nameEl = document.getElementById("modal-wh-name");
  const locationEl = document.getElementById("modal-wh-location");
  const zonesEl = document.getElementById("zones-content");

  if (nameEl)
    nameEl.textContent = warehouse.name ?? `Warehouse ${warehouse.id}`;
  if (locationEl)
    locationEl.textContent = warehouse.location ?? warehouse.city ?? "—";

  modal?.classList.add("active");

  if (zonesEl) {
    zonesEl.innerHTML =
      '<div class="page-loading"><div class="spinner"></div><span>Loading zones…</span></div>';
  }

  try {
    const id = warehouse.id ?? warehouse.warehouse_id;
    const data = await Warehouses.getZones(id);
    state.zones = Array.isArray(data)
      ? data
      : (data?.zones ?? data?.items ?? []);
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
  document.getElementById("zones-modal-backdrop")?.classList.remove("active");
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

  container.innerHTML = state.zones.map((zone) => zoneCardHTML(zone)).join("");
  bindBinLoaders(container);
}

function zoneCardHTML(zone) {
  const name = zone.name ?? zone.zone_name ?? `Zone ${zone.id}`;
  const type = zone.type ?? zone.zone_type ?? "storage";
  const bins = zone.bins ?? zone.bins_count ?? [];
  const binCount = Array.isArray(bins) ? bins.length : (zone.bins_count ?? 0);
  const capacity = zone.capacity ?? zone.total_capacity ?? 0;
  const used = zone.used_capacity ?? zone.occupied ?? 0;
  const utilPct = capacity > 0 ? Math.round((used / capacity) * 100) : 0;

  const binsHTML =
    Array.isArray(bins) && bins.length > 0
      ? `<div style="margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.375rem">
        ${bins
          .slice(0, 12)
          .map(
            (bin) => `
          <span class="tag" style="cursor:default" title="Capacity: ${bin.capacity ?? "?"}">
            ${escapeHtml(bin.code ?? bin.name ?? bin.bin_id ?? String(bin))}
          </span>`,
          )
          .join("")}
        ${bins.length > 12 ? `<span class="tag">+${bins.length - 12} more</span>` : ""}
      </div>`
      : "";

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
        ${
          capacity > 0
            ? `
          <div style="margin-bottom:.5rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
              <span class="text-xs text-muted">Utilization</span>
              <span class="text-xs font-semibold">${utilPct}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-bar__fill progress-bar__fill--${utilPct > 80 ? "warning" : "success"}"
                style="width:${utilPct}%"></div>
            </div>
          </div>`
            : ""
        }
        ${binsHTML}
        <div style="margin-top:.5rem;display:flex;gap:.5rem">
          <button class="btn btn--ghost btn--sm btn-load-bins" data-zone-id="${escapeHtml(String(zone.id))}">
            Load Bins
          </button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   LOAD BINS FOR ZONE
   ============================================================ */
function bindBinLoaders(container) {
  container?.querySelectorAll(".btn-load-bins").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const zoneId = btn.dataset.zoneId;
      btn.disabled = true;
      btn.textContent = "Loading…";
      try {
        const bins = await Warehouses.getBins(zoneId);
        const list = Array.isArray(bins) ? bins : (bins?.items ?? []);
        const binsArea = btn.closest(".card__body");
        const existingBins = binsArea?.querySelector(".bins-loaded");
        if (existingBins) existingBins.remove();
        const binsDiv = document.createElement("div");
        binsDiv.className = "bins-loaded";
        binsDiv.style.cssText =
          "margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.375rem";
        binsDiv.innerHTML =
          list.length === 0
            ? '<span class="text-muted text-xs">No bins in this zone</span>'
            : list
                .map(
                  (bin) =>
                    `<span class="tag" title="Capacity: ${bin.capacity ?? "?"}">${escapeHtml(bin.code ?? bin.name ?? String(bin.id).slice(0, 8))}</span>`,
                )
                .join("");
        binsArea?.appendChild(binsDiv);
        btn.textContent = `${list.length} bins loaded`;
      } catch (err) {
        btn.textContent = "Failed";
        toast(`Failed to load bins: ${err.message}`, "error");
      }
    });
  });
}

/* ============================================================
   DELETE WAREHOUSE
   ============================================================ */
async function deleteWarehouse(id) {
  if (
    !confirm(
      "Are you sure you want to delete this warehouse? This cannot be undone.",
    )
  )
    return;
  try {
    await Warehouses.delete(id);
    toast("Warehouse deleted", "success");
    await loadWarehouses();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, "error");
  }
}

/* ============================================================
   CREATE WAREHOUSE MODAL
   ============================================================ */
function bindCreateWarehouseModal() {
  const openBtn = document.getElementById("create-wh-btn");
  const modal = document.getElementById("create-wh-modal");
  if (!openBtn || !modal) return;

  const closeModal = () => modal.classList.remove("active");
  openBtn.addEventListener("click", () => modal.classList.add("active"));
  document
    .getElementById("create-wh-cancel")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("create-wh-cancel-footer")
    ?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document
    .getElementById("create-wh-submit")
    ?.addEventListener("click", async () => {
      const name = document.getElementById("wh-name")?.value?.trim();
      const code = document.getElementById("wh-code")?.value?.trim();
      const whType = document.getElementById("wh-type")?.value;
      const city = document.getElementById("wh-city")?.value?.trim();
      const stateVal = document.getElementById("wh-state")?.value?.trim();
      const capacity = parseInt(
        document.getElementById("wh-capacity")?.value,
        10,
      );
      const throughput = parseInt(
        document.getElementById("wh-throughput")?.value,
        10,
      );

      if (!name || !code) {
        toast("Name and code are required", "warning");
        return;
      }

      const submitBtn = document.getElementById("create-wh-submit");
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<div class="spinner spinner--sm spinner--white"></div>';

      try {
        await Warehouses.create({
          name,
          code,
          warehouse_type: whType || "standard",
          ...(city && { city }),
          ...(stateVal && { state: stateVal }),
          ...(capacity && { capacity_sqft: capacity }),
          ...(throughput && { max_throughput_per_day: throughput }),
        });
        toast("Warehouse created", "success");
        closeModal();
        await loadWarehouses();
      } catch (err) {
        toast(`Failed: ${err.message}`, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Warehouse";
      }
    });
}

/* ============================================================
   CREATE ZONE MODAL
   ============================================================ */
function bindCreateZoneModal() {
  const openBtn = document.getElementById("create-zone-btn");
  const modal = document.getElementById("create-zone-modal");
  if (!openBtn || !modal) return;

  const closeModal = () => modal.classList.remove("active");
  openBtn.addEventListener("click", () => {
    // Populate warehouse select
    const sel = document.getElementById("zone-warehouse");
    if (sel) {
      sel.innerHTML =
        '<option value="">Select warehouse</option>' +
        state.warehouses
          .map(
            (w) =>
              `<option value="${w.id}">${escapeHtml(w.name || w.code)}</option>`,
          )
          .join("");
    }
    modal.classList.add("active");
  });
  document
    .getElementById("create-zone-cancel")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("create-zone-cancel-footer")
    ?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document
    .getElementById("create-zone-submit")
    ?.addEventListener("click", async () => {
      const warehouseId = document.getElementById("zone-warehouse")?.value;
      const name = document.getElementById("zone-name")?.value?.trim();
      const zoneType = document.getElementById("zone-type")?.value;
      if (!warehouseId || !name) {
        toast("Warehouse and zone name are required", "warning");
        return;
      }

      const submitBtn = document.getElementById("create-zone-submit");
      submitBtn.disabled = true;
      try {
        await Warehouses.createZone({
          warehouse_id: warehouseId,
          name,
          zone_type: zoneType || "storage",
        });
        toast("Zone created", "success");
        closeModal();
        // Refresh zones if modal is open
        if (state.selectedWarehouse) {
          const data = await Warehouses.getZones(state.selectedWarehouse.id);
          state.zones = Array.isArray(data)
            ? data
            : (data?.zones ?? data?.items ?? []);
          renderZones(document.getElementById("zones-content"));
        }
      } catch (err) {
        toast(`Failed: ${err.message}`, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Zone";
      }
    });
}

/* ============================================================
   CREATE BIN MODAL
   ============================================================ */
function bindCreateBinModal() {
  const openBtn = document.getElementById("create-bin-btn");
  const modal = document.getElementById("create-bin-modal");
  if (!openBtn || !modal) return;

  const closeModal = () => modal.classList.remove("active");
  openBtn.addEventListener("click", () => modal.classList.add("active"));
  document
    .getElementById("create-bin-cancel")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("create-bin-cancel-footer")
    ?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document
    .getElementById("create-bin-submit")
    ?.addEventListener("click", async () => {
      const zoneId = document.getElementById("bin-zone-id")?.value?.trim();
      const code = document.getElementById("bin-code")?.value?.trim();
      const capacity = parseInt(
        document.getElementById("bin-capacity")?.value,
        10,
      );
      if (!zoneId || !code) {
        toast("Zone ID and bin code are required", "warning");
        return;
      }

      const submitBtn = document.getElementById("create-bin-submit");
      submitBtn.disabled = true;
      try {
        await Warehouses.createBin({
          zone_id: zoneId,
          code,
          ...(capacity && { capacity }),
        });
        toast("Bin created", "success");
        closeModal();
      } catch (err) {
        toast(`Failed: ${err.message}`, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Bin";
      }
    });
}
