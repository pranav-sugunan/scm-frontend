/**
 * shipments.js — Shipments Controller
 * Pipeline, split-view table + tracking detail, carrier metrics.
 */
import { Shipments, Warehouses } from "./api.js";
import {
  initShell,
  formatNumber,
  formatCurrency,
  formatDate,
  formatDateTime,
  statusBadge,
  escapeHtml,
  toast,
  timeAgo,
  debounce,
  paginate,
  renderPagination,
  refreshIcons,
  showPageLoader,
  showError,
  showEmpty,
  sortBy,
} from "./utils.js";

/* ── State ── */
let shipments = [];
let filtered = [];
let carriers = [];
let warehouses = [];
let page = 1;
const perPage = 20;
let pipelineFilter = "";
let selectedId = null;
let searchTerm = "";
let statusFilter = "";
let carrierFilter = "";
let carrierChart = null;

const STAGES = [
  { key: "pending", label: "Pending", color: "var(--clr-gray-400)" },
  { key: "picked_up", label: "Picked Up", color: "var(--clr-info)" },
  { key: "in_transit", label: "In Transit", color: "var(--clr-warning)" },
  { key: "out_for_delivery", label: "Out for Delivery", color: "#f97316" },
  { key: "exception", label: "Exception", color: "var(--clr-danger)" },
  { key: "delivered", label: "Delivered", color: "var(--clr-success)" },
  { key: "returned", label: "Returned", color: "var(--clr-gray-400)" },
];

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("shipments");
  bindEvents();
  await loadAll();
});

function bindEvents() {
  const $ = (s) => document.querySelector(s);

  $("#btn-new-shipment").addEventListener("click", openCreateModal);

  $("#shipment-search")?.addEventListener(
    "input",
    debounce((e) => {
      searchTerm = (e.target.value || "").trim().toLowerCase();
      page = 1;
      applyFilters();
    }, 180),
  );
  $("#shipment-status-filter")?.addEventListener("change", (e) => {
    statusFilter = e.target.value;
    page = 1;
    applyFilters();
  });
  $("#shipment-carrier-filter")?.addEventListener("change", (e) => {
    carrierFilter = e.target.value;
    page = 1;
    applyFilters();
  });

  // Create modal
  $("#create-modal-close").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-cancel").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-submit").addEventListener("click", submitCreate);

  // Status modal
  $("#status-modal-close").addEventListener("click", () =>
    closeModal("status-modal"),
  );
  $("#status-modal-cancel").addEventListener("click", () =>
    closeModal("status-modal"),
  );
  $("#status-modal-confirm").addEventListener("click", confirmStatusUpdate);

  // Detail modal
  $("#detail-modal-close").addEventListener("click", () =>
    closeModal("detail-modal"),
  );

  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  });
}

/* ── Data Loading ── */
async function loadAll() {
  showPageLoader("shipment-metrics");

  try {
    const [shipRes, carrierRes, whRes] = await Promise.allSettled([
      Shipments.getAll({ limit: 200 }),
      Shipments.getCarriers(),
      Warehouses.getAll(),
    ]);

    shipments = shipRes.status === "fulfilled" ? shipRes.value : [];
    carriers = carrierRes.status === "fulfilled" ? carrierRes.value : [];
    warehouses = whRes.status === "fulfilled" ? whRes.value : [];

    renderCarrierFilter();
    renderMetrics();
    applyFilters();
    renderShipmentInsights();

    const subtitle = document.getElementById("shipments-subtitle");
    if (subtitle)
      subtitle.textContent = `${formatNumber(shipments.length)} shipments across ${carriers.length} carriers`;
  } catch (err) {
    showError("shipment-metrics", err.message);
  }
}

/* ── Metrics ── */
function renderMetrics() {
  const container = document.getElementById("shipment-metrics");
  if (!container) return;

  const inTransit = shipments.filter((s) =>
    ["in_transit", "out_for_delivery"].includes(s.status),
  ).length;
  const delivered = shipments.filter((s) => s.status === "delivered").length;
  const pending = shipments.filter((s) => s.status === "pending").length;
  const avgCost =
    shipments.length > 0
      ? shipments.reduce((s, sh) => s + (sh.cost || 0), 0) / shipments.length
      : 0;

  const metrics = [
    {
      label: "Total Shipments",
      value: formatNumber(shipments.length),
      icon: "truck",
    },
    { label: "In Transit", value: formatNumber(inTransit), icon: "navigation" },
    {
      label: "Delivered",
      value: formatNumber(delivered),
      icon: "check-circle",
    },
    { label: "Avg Cost", value: formatCurrency(avgCost), icon: "indian-rupee" },
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

/* ── Filters ── */
function applyFilters() {
  filtered = shipments.filter((s) => {
    if (pipelineFilter && s.status !== pipelineFilter) return false;
    if (statusFilter && s.status !== statusFilter) return false;
    if (carrierFilter && String(s.carrier_id) !== String(carrierFilter))
      return false;

    if (searchTerm) {
      const haystack = [s.tracking_number, s.order_id, s.id, s.carrier_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  filtered = sortBy(filtered, "created_at", "desc");
  renderPipeline();
  renderTable();
  renderShipmentInsights();
}

function renderCarrierFilter() {
  const carrierSelect = document.getElementById("shipment-carrier-filter");
  if (!carrierSelect) return;

  carrierSelect.innerHTML =
    '<option value="">All Carriers</option>' +
    carriers
      .map(
        (carrier) =>
          `<option value="${carrier.id}">${escapeHtml(
            carrier.name || String(carrier.id),
          )}</option>`,
      )
      .join("");
}

function renderShipmentInsights() {
  renderCarrierChart();
  renderDeliveryHealth();
}

function renderCarrierChart() {
  const wrap = document.getElementById("carrier-chart-wrap");
  if (!wrap) return;

  let canvas = document.getElementById("carrier-chart");
  if (!canvas) {
    wrap.innerHTML = '<canvas id="carrier-chart"></canvas>';
    canvas = document.getElementById("carrier-chart");
  }

  if (carrierChart) {
    carrierChart.destroy();
    carrierChart = null;
  }

  const hasActiveFilters = Boolean(
    searchTerm || statusFilter || pipelineFilter || carrierFilter,
  );
  const list = hasActiveFilters ? filtered : shipments;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    typeof Chart === "undefined"
  ) {
    wrap.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">No shipment data</div></div>`;
    return;
  }

  const counts = new Map();
  list.forEach((shipment) => {
    const carrierName =
      carriers.find(
        (carrier) => String(carrier.id) === String(shipment.carrier_id),
      )?.name || String(shipment.carrier_id || "Unassigned");
    counts.set(carrierName, (counts.get(carrierName) || 0) + 1);
  });

  const labels = [...counts.keys()];
  const values = [...counts.values()];

  carrierChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 10,
            font: { family: "'Inter', sans-serif", size: 12 },
          },
        },
      },
    },
  });
}

function renderDeliveryHealth() {
  const container = document.getElementById("shipment-health");
  if (!container) return;

  const hasActiveFilters = Boolean(
    searchTerm || statusFilter || pipelineFilter || carrierFilter,
  );
  const list = hasActiveFilters ? filtered : shipments;
  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">No data</div></div>`;
    return;
  }

  const total = list.length || 1;
  const delivered = list.filter((s) => s.status === "delivered").length;
  const inTransit = list.filter((s) =>
    ["picked_up", "in_transit", "out_for_delivery"].includes(s.status),
  ).length;
  const exception = list.filter((s) =>
    ["exception", "returned"].includes(s.status),
  ).length;
  const pending = list.filter((s) => s.status === "pending").length;

  const rows = [
    { label: "Delivered", value: delivered, tone: "success" },
    { label: "In Transit", value: inTransit, tone: "info" },
    { label: "Pending", value: pending, tone: "warning" },
    { label: "Exceptions", value: exception, tone: "danger" },
  ];

  container.innerHTML = `<div class="progress-list">${rows
    .map((row) => {
      const pct = Math.round((row.value / total) * 100);
      const tone = row.tone === "info" ? "warning" : row.tone;
      return `<div class="progress-list__item">
        <div class="progress-list__label">${row.label}</div>
        <div class="progress-bar" style="height:7px"><div class="progress-bar__fill progress-bar__fill--${tone}" style="width:${pct}%"></div></div>
        <div class="progress-list__value">${pct}%</div>
      </div>`;
    })
    .join("")}</div>`;
}

/* ── Pipeline ── */
function renderPipeline() {
  const container = document.getElementById("shipment-pipeline");
  if (!container) return;

  const counts = {};
  STAGES.forEach((s) => (counts[s.key] = 0));
  shipments.forEach((s) => {
    const st = (s.status || "").toLowerCase();
    if (counts[st] !== undefined) counts[st]++;
  });

  const total = shipments.length || 1;
  const arrow = `<div class="pipeline__connector"><i data-lucide="chevron-right"></i></div>`;

  container.innerHTML = `<div class="pipeline">${STAGES.map((s, i) => {
    const count = counts[s.key];
    const pct = Math.round((count / total) * 100);
    const active = pipelineFilter === s.key ? " active" : "";
    return (
      (i > 0 ? arrow : "") +
      `
      <div class="pipeline__stage${active}" data-stage="${s.key}" style="cursor:pointer">
        <div class="pipeline__stage-count" style="color:${s.color}">${count}</div>
        <div class="pipeline__stage-label">${s.label}</div>
        <div class="pipeline__stage-bar">
          <div class="pipeline__stage-bar-fill" style="width:${pct}%;background:${s.color}"></div>
        </div>
      </div>`
    );
  }).join("")}</div>`;

  container.querySelectorAll(".pipeline__stage").forEach((el) => {
    el.addEventListener("click", () => {
      const stage = el.dataset.stage;
      pipelineFilter = pipelineFilter === stage ? "" : stage;
      page = 1;
      applyFilters();
    });
  });
  refreshIcons();
}

/* ── Table ── */
function renderTable() {
  const container = document.getElementById("shipments-table-container");
  if (!container) return;

  const paging = paginate(filtered, page, perPage);
  const { items } = paging;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="truck"></i></div><div class="empty-state__title">No shipments found</div></div>`;
    document.getElementById("shipments-pagination").innerHTML = "";
    refreshIcons();
    return;
  }

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Tracking</th>
          <th>Order</th>
          <th>Carrier</th>
          <th>Status</th>
          <th>Weight</th>
          <th>Cost</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${items
        .map((s) => {
          const isSelected = String(s.id) === String(selectedId);
          const carrierName =
            carriers.find((c) => String(c.id) === String(s.carrier_id))?.name ||
            String(s.carrier_id || "—");
          return `
          <tr class="shipment-row${isSelected ? " row--highlight" : ""}" data-id="${s.id}" style="cursor:pointer">
            <td><span class="table__id">${escapeHtml(s.tracking_number || String(s.id))}</span></td>
            <td class="text-muted">${escapeHtml(String(s.order_id || "—"))}</td>
            <td>${escapeHtml(carrierName)}</td>
            <td>${statusBadge(s.status)}</td>
            <td class="text-muted">${s.weight_kg ? s.weight_kg + " kg" : "—"}</td>
            <td>${s.cost ? formatCurrency(s.cost) : "—"}</td>
            <td class="text-muted">${timeAgo(s.created_at)}</td>
            <td class="table__actions">
              <button class="btn btn--ghost btn--sm" title="Update status" data-action="status" data-id="${s.id}"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>
            </td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>`;

  // Row click → detail
  container.querySelectorAll(".shipment-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      loadDetail(row.dataset.id);
    });
  });

  // Status action
  container.querySelectorAll("[data-action='status']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openStatusModal(btn.dataset.id);
    });
  });

  renderPagination("shipments-pagination", paging, (p) => {
    page = p;
    renderTable();
  });
  refreshIcons();
}

/* ── Detail Modal ── */
async function loadDetail(id) {
  selectedId = id;
  renderTable(); // Highlight row

  const modal = document.getElementById("detail-modal");
  const body = document.getElementById("detail-modal-body");
  const title = document.getElementById("detail-modal-title");
  if (title) title.textContent = `Shipment ${id}`;
  body.innerHTML = `<div class="spinner" style="margin:2rem auto"></div>`;
  modal.style.display = "flex";

  try {
    const ship = await Shipments.getById(id);
    const events = ship.events || [];
    const carrierName =
      carriers.find((c) => String(c.id) === String(ship.carrier_id))?.name ||
      String(ship.carrier_id || "—");
    const originWh = ship.origin_warehouse_id
      ? warehouses.find(
          (w) => String(w.id) === String(ship.origin_warehouse_id),
        )?.name || `WH-${ship.origin_warehouse_id}`
      : "—";

    // Tracking stepper — proper horizontal connector layout
    const stageOrder = STAGES.map((s) => s.key);
    const currentIdx = stageOrder.indexOf((ship.status || "").toLowerCase());

    const stepperHtml = `<div class="tracking-stepper">
      ${stageOrder
        .map((stage, i) => {
          const isCompleted = i < currentIdx;
          const isCurrent = i === currentIdx;
          const stepCls = isCurrent
            ? "current"
            : isCompleted
              ? "completed"
              : "";
          const label = STAGES.find((s) => s.key === stage)?.label || stage;
          const hasConnector = i < stageOrder.length - 1;
          return `<div class="tracking-stepper__step ${stepCls}">
          <div class="tracking-stepper__top">
            <div class="tracking-stepper__dot"></div>
            ${hasConnector ? `<div class="tracking-stepper__connector ${isCompleted ? "tracking-stepper__connector--done" : ""}"></div>` : ""}
          </div>
          <div class="tracking-stepper__label">${label}</div>
        </div>`;
        })
        .join("")}
    </div>`;

    // Detail info rows
    const fields = [
      {
        label: "Tracking No.",
        value: escapeHtml(ship.tracking_number || "—"),
        mono: true,
      },
      { label: "Order ID", value: escapeHtml(String(ship.order_id || "—")) },
      { label: "Carrier", value: escapeHtml(carrierName) },
      { label: "Status", value: statusBadge(ship.status) },
      { label: "Origin Warehouse", value: escapeHtml(originWh) },
      { label: "Weight", value: ship.weight_kg ? `${ship.weight_kg} kg` : "—" },
      { label: "Cost", value: ship.cost ? formatCurrency(ship.cost) : "—" },
      {
        label: "Created",
        value: ship.created_at ? formatDateTime(ship.created_at) : "—",
      },
      ...(ship.estimated_delivery_date
        ? [
            {
              label: "Est. Delivery",
              value: formatDate(ship.estimated_delivery_date),
            },
          ]
        : []),
    ];

    body.innerHTML = `
      ${stepperHtml}

      <div class="ship-detail-section">
        <div class="ship-detail-label-row">
          <i data-lucide="info" style="width:13px;height:13px"></i> Shipment Details
        </div>
        <div class="detail-grid" style="margin-top:0.5rem">
          ${fields
            .map(
              (f) => `
            <div class="detail-grid__item">
              <span class="detail-grid__label">${f.label}</span>
              <span class="detail-grid__value${f.mono ? " font-mono" : ""}">${f.value}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>

      ${
        events.length > 0
          ? `
      <div class="ship-detail-section">
        <div class="ship-detail-label-row">
          <i data-lucide="map-pin" style="width:13px;height:13px"></i> Tracking Events
        </div>
        <ul class="timeline" style="margin-top:0.5rem">
          ${events
            .map(
              (ev) => `
            <li class="timeline__item">
              <div class="timeline__dot"></div>
              <div class="timeline__content">
                <strong>${escapeHtml(ev.status || ev.event || "—")}</strong>
                <div class="text-xs text-muted">${formatDateTime(ev.timestamp || ev.created_at)}</div>
                ${ev.location ? `<div class="text-xs text-muted"><i data-lucide="map-pin" style="width:10px;height:10px;vertical-align:-1px"></i> ${escapeHtml(ev.location)}</div>` : ""}
              </div>
            </li>`,
            )
            .join("")}
        </ul>
      </div>`
          : ""
      }
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state__title">Failed to load</div><div class="empty-state__description">${escapeHtml(err.message)}</div></div>`;
  }
  refreshIcons();
}

/* ── Status Update ── */
let statusShipmentId = null;

function openStatusModal(id) {
  const ship = shipments.find((s) => String(s.id) === String(id));
  if (!ship) return;
  statusShipmentId = id;
  document.getElementById("status-modal-info").textContent =
    `Shipment ${ship.tracking_number || id} — currently "${ship.status}"`;
  document.getElementById("status-modal-select").value = ship.status;
  document.getElementById("status-modal").style.display = "flex";
  refreshIcons();
}

async function confirmStatusUpdate() {
  const newStatus = document.getElementById("status-modal-select").value;
  try {
    await Shipments.updateStatus(statusShipmentId, { status: newStatus });
    toast("Status updated", "success");
    closeModal("status-modal");
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Create Shipment ── */
function openCreateModal() {
  // Populate dropdowns
  const carrierSel = document.getElementById("create-carrier");
  carrierSel.innerHTML =
    `<option value="">Select carrier</option>` +
    carriers
      .map(
        (c) =>
          `<option value="${c.id}">${escapeHtml(c.name || `Carrier ${c.id}`)}</option>`,
      )
      .join("");

  const whSel = document.getElementById("create-warehouse");
  whSel.innerHTML =
    `<option value="">Select warehouse</option>` +
    warehouses
      .map(
        (w) =>
          `<option value="${w.id}">${escapeHtml(w.name || `WH ${w.id}`)}</option>`,
      )
      .join("");

  document.getElementById("create-order").value = "";
  document.getElementById("create-modal").style.display = "flex";
  refreshIcons();
}

async function submitCreate() {
  const orderId = document.getElementById("create-order").value.trim();
  const carrierId = document.getElementById("create-carrier").value;
  const warehouseId = document.getElementById("create-warehouse").value;

  if (!orderId) {
    toast("Order ID is required", "error");
    return;
  }

  const payload = { order_id: orderId };
  if (carrierId) payload.carrier_id = carrierId;
  if (warehouseId) payload.origin_warehouse_id = warehouseId;

  try {
    await Shipments.create(payload);
    toast("Shipment created", "success");
    closeModal("create-modal");
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Helpers ── */
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
