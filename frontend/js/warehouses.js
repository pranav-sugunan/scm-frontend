/**
 * warehouses.js — Warehouses Controller
 * Consistent layout: metrics → warehouse list → detail view with analytics, zones, bin layout.
 * Includes AI simulation integration.
 */
import { Warehouses, Analytics } from "./api.js";
import {
  initShell,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatDate,
  formatDateTime,
  statusBadge,
  escapeHtml,
  toast,
  refreshIcons,
  showPageLoader,
  showError,
  debounce,
} from "./utils.js";

/* ── State ── */
let allWarehouses = [];
let selectedId = null;
let warehouseDetail = null;
let zones = [];
let binsByZone = {};
let warehouseAnalytics = null;
let searchTerm = "";
let statusFilter = "";
let typeFilter = "";

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("warehouses");
  bindEvents();
  await loadWarehouses();
});

function bindEvents() {
  const $ = (s) => document.querySelector(s);

  const searchEl = $("#wh-search");
  const statusEl = $("#wh-status-filter");
  const typeEl = $("#wh-type-filter");

  if (searchEl) {
    searchEl.addEventListener(
      "input",
      debounce((e) => {
        searchTerm = (e.target.value || "").trim().toLowerCase();
        renderSelector();
      }, 180),
    );
  }
  statusEl?.addEventListener("change", (e) => {
    statusFilter = e.target.value;
    renderSelector();
  });
  typeEl?.addEventListener("change", (e) => {
    typeFilter = e.target.value;
    renderSelector();
  });

  $("#btn-new-warehouse").addEventListener("click", () =>
    openModal("create-wh-modal"),
  );
  $("#btn-add-zone")?.addEventListener("click", () =>
    openModal("create-zone-modal"),
  );
  $("#btn-add-bin")?.addEventListener("click", openBinModal);

  // Create warehouse
  $("#create-wh-close").addEventListener("click", () =>
    closeModal("create-wh-modal"),
  );
  $("#create-wh-cancel").addEventListener("click", () =>
    closeModal("create-wh-modal"),
  );
  $("#create-wh-submit").addEventListener("click", submitCreateWarehouse);

  // Create zone
  $("#create-zone-close").addEventListener("click", () =>
    closeModal("create-zone-modal"),
  );
  $("#create-zone-cancel").addEventListener("click", () =>
    closeModal("create-zone-modal"),
  );
  $("#create-zone-submit").addEventListener("click", submitCreateZone);

  // Create bin
  $("#create-bin-close").addEventListener("click", () =>
    closeModal("create-bin-modal"),
  );
  $("#create-bin-cancel").addEventListener("click", () =>
    closeModal("create-bin-modal"),
  );
  $("#create-bin-submit").addEventListener("click", submitCreateBin);

  // AI Simulation auto-runs on warehouse selection — no manual button needed

  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  });
}

/* ── Load Warehouses ── */
async function loadWarehouses() {
  try {
    allWarehouses = await Warehouses.getAll();
    renderSelector();
    renderOverviewMetrics();

    const subtitle = document.getElementById("wh-subtitle");
    if (subtitle) subtitle.textContent = `${allWarehouses.length} warehouses`;
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Overview Metrics ── */
function renderOverviewMetrics() {
  const container = document.getElementById("wh-overview-metrics");
  if (!container) return;

  const active = allWarehouses.filter(
    (w) => (w.status || "active") === "active",
  ).length;
  const totalCapacity = allWarehouses.reduce(
    (s, w) => s + (w.capacity_sqft || 0),
    0,
  );
  const types = new Set(allWarehouses.map((w) => w.warehouse_type)).size;

  const metrics = [
    {
      label: "Total Warehouses",
      value: formatNumber(allWarehouses.length),
      icon: "warehouse",
    },
    { label: "Active", value: formatNumber(active), icon: "check-circle" },
    {
      label: "Total Capacity",
      value: formatNumber(totalCapacity) + " sqft",
      icon: "maximize-2",
    },
    { label: "Facility Types", value: formatNumber(types), icon: "building-2" },
  ];

  container.innerHTML = metrics
    .map(
      (m) => `
    <div class="metric-card">
      <div class="metric-card__label"><i data-lucide="${m.icon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>${m.label}</div>
      <div class="metric-card__value">${m.value}</div>
    </div>`,
    )
    .join("");
  refreshIcons();
}

/* ── Selector Grid ── */
function renderSelector() {
  const container = document.getElementById("wh-table-container");
  if (!container) return;

  const filteredWarehouses = allWarehouses.filter((w) => {
    if (statusFilter && (w.status || "active") !== statusFilter) return false;
    if (typeFilter && (w.warehouse_type || "") !== typeFilter) return false;

    if (!searchTerm) return true;
    const blob = [w.name, w.code, w.address, w.city, w.state, w.country]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes(searchTerm);
  });

  if (filteredWarehouses.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__title">No warehouses found</div><div class="empty-state__description">Try adjusting filters or create a new warehouse.</div></div>`;
    refreshIcons();
    return;
  }

  const formatLocation = (w) => {
    const parts = [w.city, w.state, w.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : w.address || "—";
  };

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Warehouse</th>
          <th>Code</th>
          <th>Type</th>
          <th>Status</th>
          <th>Location</th>
          <th>Capacity</th>
          <th>Throughput/Day</th>
        </tr>
      </thead>
      <tbody>
        ${filteredWarehouses
          .map((w) => {
            const isSelected = String(w.id) === String(selectedId);
            return `
            <tr class="warehouse-row${isSelected ? " table__row--selected" : ""}" data-id="${w.id}" style="cursor:pointer">
              <td><strong>${escapeHtml(w.name || "Warehouse")}</strong></td>
              <td class="text-muted">${escapeHtml(w.code || "—")}</td>
              <td>${escapeHtml((w.warehouse_type || "fulfillment_center").replace(/_/g, " "))}</td>
              <td>${statusBadge(w.status || "active")}</td>
              <td class="text-muted">${escapeHtml(formatLocation(w))}</td>
              <td>${w.capacity_sqft ? formatNumber(w.capacity_sqft) + " sqft" : "—"}</td>
              <td>${w.max_throughput_per_day ? formatNumber(w.max_throughput_per_day) : "—"}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  container.querySelectorAll(".warehouse-row").forEach((row) => {
    row.addEventListener("click", () => {
      selectedId = row.dataset.id;
      loadWarehouseDetail(selectedId);
      renderSelector();
    });
  });
  refreshIcons();
}

/* ── Load Detail ── */
async function loadWarehouseDetail(id) {
  document.getElementById("wh-empty").style.display = "none";
  document.getElementById("wh-detail").style.display = "block";

  const infoBar = document.getElementById("wh-info-bar");
  infoBar.innerHTML = `<div class="spinner spinner--sm"></div>`;

  try {
    const [whRes, zonesRes, analyticsRes] = await Promise.allSettled([
      Warehouses.getById(id),
      Warehouses.getZones(id),
      Analytics.getWarehouseAnalytics(id),
    ]);

    warehouseDetail = whRes.status === "fulfilled" ? whRes.value : null;
    zones = zonesRes.status === "fulfilled" ? zonesRes.value : [];
    warehouseAnalytics =
      analyticsRes.status === "fulfilled" ? analyticsRes.value : null;

    // Load bins for each zone
    binsByZone = {};
    const binPromises = zones.map(async (z) => {
      const zId = z.id;
      try {
        binsByZone[zId] = await Warehouses.getBins(zId);
      } catch (_) {
        binsByZone[zId] = [];
      }
    });
    await Promise.all(binPromises);

    renderInfoBar(warehouseDetail);
    renderAnalytics();
    renderBuildingMap();
    runSimulation(); // auto-run after detail loads
  } catch (err) {
    infoBar.innerHTML = `<div class="text-sm text-muted">${escapeHtml(err.message)}</div>`;
  }
}

/* ── Info Bar ── */
function renderInfoBar(wh) {
  const container = document.getElementById("wh-info-bar");
  if (!container || !wh) return;

  const formatLocation = (w) => {
    const parts = [w.address, w.city, w.state, w.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "—";
  };

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
      <div>
        <h2 style="font-size:1.125rem;font-weight:700;margin:0">${escapeHtml(wh.name || "Warehouse")}</h2>
        <p class="text-sm text-muted" style="margin:0.125rem 0 0">${escapeHtml(wh.code || "")} · ${escapeHtml(formatLocation(wh))}</p>
      </div>
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
        <div class="text-sm"><span class="text-muted">Type</span> <strong>${escapeHtml((wh.warehouse_type || "fulfillment_center").replace(/_/g, " "))}</strong></div>
        <div class="text-sm"><span class="text-muted">Status</span> ${statusBadge(wh.status || "active")}</div>
        <div class="text-sm"><span class="text-muted">Capacity</span> <strong>${wh.capacity_sqft ? formatNumber(wh.capacity_sqft) + " sqft" : "—"}</strong></div>
        <div class="text-sm"><span class="text-muted">Throughput</span> <strong>${wh.max_throughput_per_day ? formatNumber(wh.max_throughput_per_day) + "/day" : "—"}</strong></div>
        <div class="text-sm"><span class="text-muted">Zones</span> <strong>${zones.length}</strong></div>
      </div>
    </div>`;
}

/* ── Analytics Metrics ── */
function renderAnalytics() {
  const container = document.getElementById("wh-analytics");
  if (!container) return;

  if (!warehouseAnalytics) {
    container.innerHTML = "";
    const summary = document.getElementById("wh-utilization-summary");
    if (summary) summary.textContent = "Warehouse analytics unavailable.";
    return;
  }

  const a = warehouseAnalytics;
  const metrics = [
    {
      label: "Inventory Units",
      value: formatNumber(a.total_inventory_units ?? 0),
      icon: "layers",
    },
    {
      label: "Inventory Value",
      value: formatCurrency(a.total_inventory_value ?? 0),
      icon: "indian-rupee",
    },
    {
      label: "Active Orders",
      value: formatNumber(a.active_orders ?? 0),
      icon: "clipboard-list",
    },
    {
      label: "Utilization",
      value: formatPercent(a.utilization_pct ?? 0),
      icon: "bar-chart-3",
    },
    {
      label: "Fulfilled Today",
      value: formatNumber(a.orders_fulfilled_today ?? 0),
      icon: "check-check",
    },
    {
      label: "Stockout Products",
      value: formatNumber(a.stockout_products ?? 0),
      icon: "alert-octagon",
    },
  ];

  container.innerHTML = metrics
    .map(
      (m) => `
    <div class="metric-card">
      <div class="metric-card__label"><i data-lucide="${m.icon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>${m.label}</div>
      <div class="metric-card__value">${m.value}</div>
    </div>`,
    )
    .join("");
  refreshIcons();
}

function renderUtilizationChart() {
  // Removed — utilization pulse panel has been replaced by the AI simulation panel
}

/* ── Floor Map (Bird's-eye warehouse layout) ── */
function renderBuildingMap() {
  const container = document.getElementById("building-map-container");
  if (!container) return;

  if (zones.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__icon"><i data-lucide="layout"></i></div><div class="empty-state__title">No zones defined</div><div class="empty-state__description">Create zones to build the floor layout.</div></div>`;
    refreshIcons();
    return;
  }

  const ZONE_COLORS = {
    storage: { bg: "#dbeafe", border: "#2563eb", text: "#1e40af" },
    picking: { bg: "#dcfce7", border: "#16a34a", text: "#166534" },
    receiving: { bg: "#e0f2fe", border: "#0284c7", text: "#075985" },
    shipping: { bg: "#fef9c3", border: "#ca8a04", text: "#92400e" },
    packing: { bg: "#ffedd5", border: "#ea580c", text: "#9a3412" },
    cold: { bg: "#cffafe", border: "#0891b2", text: "#164e63" },
    hazmat: { bg: "#fee2e2", border: "#dc2626", text: "#991b1b" },
    quarantine: { bg: "#f3e8ff", border: "#9333ea", text: "#581c87" },
    returns: { bg: "#fce7f3", border: "#db2777", text: "#9d174d" },
  };

  const totalBins = Object.values(binsByZone).reduce((s, b) => s + b.length, 0);
  const totalOccupied = Object.values(binsByZone)
    .flat()
    .filter((b) => (b.current_occupancy || 0) > 0).length;

  const zoneBlocks = zones
    .map((z) => {
      const zId = z.id;
      const bins = binsByZone[zId] || [];
      const color = ZONE_COLORS[z.zone_type] || {
        bg: "#f1f5f9",
        border: "#94a3b8",
        text: "#475569",
      };
      const totalBinCount = bins.length;
      const occupiedCount = bins.filter(
        (b) => (b.current_occupancy || 0) > 0,
      ).length;
      const utilPct =
        totalBinCount > 0
          ? Math.round((occupiedCount / totalBinCount) * 100)
          : 0;

      const binCells =
        bins.length > 0
          ? bins
              .map((b) => {
                const occ =
                  b.capacity_units > 0
                    ? Math.round(
                        ((b.current_occupancy || 0) / b.capacity_units) * 100,
                      )
                    : 0;
                const cellBg =
                  occ > 80
                    ? "#fca5a5"
                    : occ > 50
                      ? "#fcd34d"
                      : occ > 0
                        ? "#86efac"
                        : "#f8fafc";
                const cellBorder =
                  occ > 80
                    ? "#ef4444"
                    : occ > 50
                      ? "#f59e0b"
                      : occ > 0
                        ? "#22c55e"
                        : "#e2e8f0";
                return `<div class="fmap__bin" style="background:${cellBg};border-color:${cellBorder}" title="${escapeHtml(b.bin_code || "")} — ${occ}% full">
            <span class="fmap__bin-code">${escapeHtml(b.bin_code || String(b.id || ""))}</span>
          </div>`;
              })
              .join("")
          : `<div class="fmap__empty-zone-note">No bins</div>`;

      return `
      <div class="fmap__zone" style="border-color:${color.border};background:${color.bg}">
        <div class="fmap__zone-head" style="background:${color.border}">
          <span class="fmap__zone-name">${escapeHtml(z.name || "Zone " + zId)}</span>
          <span class="fmap__zone-type">${escapeHtml((z.zone_type || "storage").replace(/_/g, " "))}</span>
        </div>
        <div class="fmap__zone-stats">
          <span>${totalBinCount} bins</span>
          <span class="fmap__util-badge" style="background:${color.border}15;color:${color.text}">${utilPct}% used</span>
        </div>
        <div class="fmap__bins-grid">${binCells}</div>
      </div>`;
    })
    .join("");

  const legendItems = [...new Set(zones.map((z) => z.zone_type || "storage"))]
    .map((type) => {
      const c = ZONE_COLORS[type] || { border: "#94a3b8" };
      return `<span class="fmap__legend-item"><span class="fmap__legend-dot" style="background:${c.border}"></span>${type.replace(/_/g, " ")}</span>`;
    })
    .join("");

  container.innerHTML = `
    <div class="fmap">
      <div class="fmap__header">
        <div class="fmap__entrance">
          <i data-lucide="arrow-up-from-line" style="width:12px;height:12px;vertical-align:-1px"></i>
          Entrance / Dock
        </div>
        <div class="fmap__summary">
          <span><strong>${zones.length}</strong> zones</span>
          <span><strong>${totalBins}</strong> bins total</span>
          <span><strong>${totalOccupied}</strong> occupied</span>
        </div>
      </div>
      <div class="fmap__floor">${zoneBlocks}</div>
      <div class="fmap__footer">
        <div class="fmap__legend">${legendItems}</div>
        <div class="fmap__bin-legend">
          <span class="fmap__legend-item"><span class="fmap__legend-dot" style="background:#86efac;border:1px solid #22c55e"></span>Occupied</span>
          <span class="fmap__legend-item"><span class="fmap__legend-dot" style="background:#fcd34d;border:1px solid #f59e0b"></span>Busy (&gt;50%)</span>
          <span class="fmap__legend-item"><span class="fmap__legend-dot" style="background:#fca5a5;border:1px solid #ef4444"></span>Full (&gt;80%)</span>
          <span class="fmap__legend-item"><span class="fmap__legend-dot" style="background:#f8fafc;border:1px solid #e2e8f0"></span>Empty</span>
        </div>
      </div>
    </div>`;
  refreshIcons();
}

/* ── AI Simulation ── */
async function runSimulation() {
  if (!selectedId) {
    toast("Select a warehouse first", "error");
    return;
  }

  const container = document.getElementById("sim-results");
  if (!container) return;

  container.innerHTML =
    '<div class="spinner spinner--sm" style="margin:1rem auto"></div>';

  try {
    const result = await Analytics.runSimulation({
      warehouse_id: selectedId,
      simulation_days: 7,
    });

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem">
        <div class="text-sm"><span class="text-muted">Orders Processed</span><br><strong>${formatNumber(result.total_orders_processed)}</strong></div>
        <div class="text-sm"><span class="text-muted">Avg Throughput/Day</span><br><strong>${Number(result.avg_throughput_per_day).toFixed(1)}</strong></div>
        <div class="text-sm"><span class="text-muted">Avg Cycle Time</span><br><strong>${Number(result.avg_order_cycle_time_minutes).toFixed(1)} min</strong></div>
        <div class="text-sm"><span class="text-muted">Bottleneck</span><br><strong>${escapeHtml(result.bottleneck_stage || "None")}</strong></div>
      </div>
      <div style="font-weight:600;font-size:0.75rem;margin-bottom:0.375rem;color:var(--clr-text-secondary)">Stage Utilization</div>
      <div style="display:grid;gap:0.25rem;margin-bottom:0.5rem">
        ${[
          { label: "Receiving", pct: result.receiving_utilization_pct },
          { label: "Picking", pct: result.picking_utilization_pct },
          { label: "Packing", pct: result.packing_utilization_pct },
          { label: "Shipping", pct: result.shipping_utilization_pct },
        ]
          .map(
            (s) =>
              '<div style="display:flex;align-items:center;gap:0.5rem">' +
              '<span style="width:65px;font-size:0.6875rem;color:var(--clr-text-muted)">' +
              s.label +
              "</span>" +
              '<div class="progress-bar" style="flex:1;height:5px"><div class="progress-bar__fill progress-bar__fill--' +
              (s.pct > 85 ? "danger" : s.pct > 60 ? "warning" : "success") +
              '" style="width:' +
              Math.min(100, s.pct || 0) +
              '%"></div></div>' +
              '<span style="width:30px;text-align:right;font-size:0.6875rem;font-weight:600">' +
              (s.pct != null ? Number(s.pct).toFixed(0) + "%" : "—") +
              "</span>" +
              "</div>",
          )
          .join("")}
      </div>
      ${
        result.recommendations && result.recommendations.length > 0
          ? '<div style="font-weight:600;font-size:0.75rem;margin-bottom:0.25rem;color:var(--clr-text-secondary)">Recommendations</div>' +
            '<ul style="margin:0 0 0 1rem;font-size:0.75rem;color:var(--clr-text-muted)">' +
            result.recommendations
              .map(
                (r) =>
                  '<li style="margin-bottom:0.125rem">' +
                  escapeHtml(String(r)) +
                  "</li>",
              )
              .join("") +
            "</ul>"
          : ""
      }
    `;
  } catch (err) {
    const msg = (err.detail || err.message || "").toLowerCase();
    if (msg.includes("unavailable") || msg.includes("service")) {
      container.innerHTML =
        '<div class="text-sm text-muted" style="padding:0.5rem">AI simulation service not available.</div>';
    } else {
      container.innerHTML =
        '<div class="text-sm text-muted" style="padding:0.5rem">' +
        escapeHtml(err.message) +
        "</div>";
    }
  }
}

/* ── Create Warehouse ── */
async function submitCreateWarehouse() {
  const name = document.getElementById("wh-name").value.trim();
  const code = document.getElementById("wh-code").value.trim();
  const address = document.getElementById("wh-address").value.trim();
  const city = document.getElementById("wh-city").value.trim();
  const state = document.getElementById("wh-state").value.trim();
  const warehouseType = document.getElementById("wh-type").value;
  const capacitySqft = parseFloat(document.getElementById("wh-capacity").value);

  if (!name || !code) {
    toast("Name and code are required", "error");
    return;
  }

  try {
    await Warehouses.create({
      name,
      code,
      warehouse_type: warehouseType,
      capacity_sqft: capacitySqft || 0,
      address: address || null,
      city: city || null,
      state: state || null,
    });
    toast("Warehouse created", "success");
    closeModal("create-wh-modal");
    await loadWarehouses();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Create Zone ── */
async function submitCreateZone() {
  if (!selectedId) {
    toast("Select a warehouse first", "error");
    return;
  }

  const name = document.getElementById("zone-name").value.trim();
  const type = document.getElementById("zone-type").value;

  if (!name) {
    toast("Zone name is required", "error");
    return;
  }

  try {
    await Warehouses.createZone({
      warehouse_id: selectedId,
      name,
      zone_type: type,
    });
    toast("Zone created", "success");
    closeModal("create-zone-modal");
    await loadWarehouseDetail(selectedId);
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Create Bin ── */
function openBinModal() {
  if (!selectedId) {
    toast("Select a warehouse first", "error");
    return;
  }

  const sel = document.getElementById("bin-zone-select");
  sel.innerHTML =
    '<option value="">Select zone</option>' +
    zones
      .map(
        (z) =>
          '<option value="' +
          z.id +
          '">' +
          escapeHtml(z.name || "Zone " + z.id) +
          "</option>",
      )
      .join("");

  document.getElementById("bin-aisle").value = "";
  document.getElementById("bin-rack").value = "";
  document.getElementById("bin-shelf").value = "";
  document.getElementById("bin-code").value = "";
  document.getElementById("bin-capacity").value = "100";
  openModal("create-bin-modal");
}

async function submitCreateBin() {
  if (!selectedId) {
    toast("Select a warehouse first", "error");
    return;
  }

  const zoneId = document.getElementById("bin-zone-select").value;
  const aisle = document.getElementById("bin-aisle").value.trim();
  const rack = document.getElementById("bin-rack").value.trim();
  const shelf = document.getElementById("bin-shelf").value.trim();
  const binCode = document.getElementById("bin-code").value.trim();
  const capacityUnits = parseInt(document.getElementById("bin-capacity").value);

  if (!zoneId || !aisle || !rack || !shelf || !binCode) {
    toast("Zone, aisle, rack, shelf, and bin code are required", "error");
    return;
  }

  try {
    await Warehouses.createBin({
      zone_id: zoneId,
      aisle,
      rack,
      shelf,
      bin_code: binCode,
      capacity_units: capacityUnits || 100,
    });
    toast("Bin created", "success");
    closeModal("create-bin-modal");
    await loadWarehouseDetail(selectedId);
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Helpers ── */
function openModal(id) {
  document.getElementById(id).style.display = "flex";
  refreshIcons();
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
