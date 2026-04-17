/**
 * orders.js — Orders Controller
 * Full order management with analytics integration, pipeline, CRUD, filtering.
 */
import { Analytics, Orders, Products, Inventory, fetchAll } from "./api.js";
import {
  initShell,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatDate,
  formatDateTime,
  statusBadge,
  priorityBadge,
  showPageLoader,
  showError,
  showEmpty,
  escapeHtml,
  toast,
  timeAgo,
  debounce,
  paginate,
  renderPagination,
  refreshIcons,
  sortBy,
} from "./utils.js";

/* ── State ── */
let allOrders = [];
let filtered = [];
let page = 1;
const perPage = 25;
let sortKey = "created_at";
let sortDir = "desc";
let search = "";
let filterStatus = "";
let filterPriority = "";
let pipelineFilter = "";

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("orders");
  bindEvents();
  await loadOrders();
});

function bindEvents() {
  const $ = (s) => document.querySelector(s);

  $("#search-input").addEventListener(
    "input",
    debounce((e) => {
      search = e.target.value.trim().toLowerCase();
      page = 1;
      applyFilters();
    }, 250),
  );
  $("#filter-status").addEventListener("change", (e) => {
    filterStatus = e.target.value;
    page = 1;
    applyFilters();
  });
  $("#filter-priority").addEventListener("change", (e) => {
    filterPriority = e.target.value;
    page = 1;
    applyFilters();
  });
  $("#btn-clear-filters").addEventListener("click", clearFilters);
  $("#btn-new-order").addEventListener("click", openCreateModal);

  // Status modal
  $("#status-modal-close").addEventListener("click", () =>
    closeModal("status-modal"),
  );
  $("#status-modal-cancel").addEventListener("click", () =>
    closeModal("status-modal"),
  );
  $("#status-modal-confirm").addEventListener("click", confirmStatusUpdate);

  // Create modal
  $("#create-modal-close").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-cancel").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-submit").addEventListener("click", submitCreateOrder);
  $("#btn-add-item").addEventListener("click", addOrderItemRow);

  // Detail modal
  $("#detail-modal-close").addEventListener("click", () =>
    closeModal("detail-modal"),
  );

  // Close modals on backdrop click
  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  });
}

function clearFilters() {
  search = "";
  filterStatus = "";
  filterPriority = "";
  pipelineFilter = "";
  document.getElementById("search-input").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-priority").value = "";
  page = 1;
  applyFilters();
}

/* ── Data Loading ── */
async function loadOrders() {
  showPageLoader("order-metrics");
  try {
    const [ordersRes, analyticsRes] = await Promise.allSettled([
      fetchAll(Orders.getAll),
      Analytics.getDashboard(),
    ]);

    allOrders = ordersRes.status === "fulfilled" ? ordersRes.value : [];
    const dash =
      analyticsRes.status === "fulfilled" ? analyticsRes.value : null;

    renderMetrics(dash);
    applyFilters();
  } catch (err) {
    showError("order-metrics", err.message);
  }
}

/* ── Analytics Metrics ── */
function renderMetrics(dash) {
  const container = document.getElementById("order-metrics");
  if (!container) return;

  const ok = dash?.order_kpis ?? {};
  const total = allOrders.length || ok.total_orders || 0;
  const pending = allOrders.filter((o) =>
    ["created", "allocated", "picked", "packed"].includes(o.status),
  ).length;

  const metrics = [
    {
      label: "Total Orders",
      value: formatNumber(total),
      icon: "clipboard-list",
    },
    { label: "Pending", value: formatNumber(pending), icon: "clock" },
    {
      label: "Fulfillment Rate",
      value: formatPercent((ok.fulfillment_rate ?? 0) * 100),
      icon: "check-circle",
    },
    {
      label: "On-Time Delivery",
      value: formatPercent((ok.on_time_delivery_rate ?? 0) * 100),
      icon: "timer",
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

/* ── Filters & Sort ── */
function applyFilters() {
  filtered = allOrders.filter((o) => {
    if (search) {
      const hay =
        `${o.order_number || o.id} ${o.customer_name || o.customer_id || ""} ${o.status}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (filterStatus && o.status !== filterStatus) return false;
    if (filterPriority && o.priority !== filterPriority) return false;
    if (pipelineFilter && o.status !== pipelineFilter) return false;
    return true;
  });

  filtered = sortBy(filtered, sortKey, sortDir);

  const subtitle = document.getElementById("orders-subtitle");
  if (subtitle)
    subtitle.textContent = `${formatNumber(filtered.length)} of ${formatNumber(allOrders.length)} orders`;

  const clearBtn = document.getElementById("btn-clear-filters");
  if (clearBtn)
    clearBtn.style.display =
      search || filterStatus || filterPriority || pipelineFilter
        ? "inline-flex"
        : "none";

  renderPipeline();
  renderTable();
}

/* ── Pipeline ── */
const STAGES = [
  { key: "created", label: "Created", color: "var(--clr-gray-400)" },
  { key: "allocated", label: "Allocated", color: "var(--clr-info)" },
  { key: "picked", label: "Picked", color: "#8b5cf6" },
  { key: "packed", label: "Packed", color: "var(--clr-warning)" },
  { key: "shipped", label: "Shipped", color: "var(--clr-primary)" },
  { key: "in_transit", label: "In Transit", color: "#f97316" },
  { key: "delivered", label: "Delivered", color: "var(--clr-success)" },
];

function renderPipeline() {
  const container = document.getElementById("order-pipeline");
  if (!container) return;

  const counts = {};
  STAGES.forEach((s) => (counts[s.key] = 0));
  allOrders.forEach((o) => {
    const s = (o.status || "").toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
  });

  const total = allOrders.length || 1;
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

  // Bind click events
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
  const container = document.getElementById("orders-table-container");
  if (!container) return;

  const paging = paginate(filtered, page, perPage);
  const { items } = paging;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="inbox"></i></div><div class="empty-state__title">No orders found</div><div class="empty-state__description">${allOrders.length === 0 ? "Create your first order to get started." : "Try adjusting your filters."}</div></div>`;
    document.getElementById("orders-pagination").innerHTML = "";
    refreshIcons();
    return;
  }

  const sortIcon = (key) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th class="sortable" data-key="order_number">Order${sortIcon("order_number")}</th>
          <th class="sortable" data-key="customer_name">Customer${sortIcon("customer_name")}</th>
          <th>Status</th>
          <th>Priority</th>
          <th class="sortable" data-key="created_at">Created${sortIcon("created_at")}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${items
        .map(
          (o) => `
        <tr>
          <td><span class="table__id">${escapeHtml(o.order_number || String(o.id).slice(0, 8))}</span></td>
          <td>${escapeHtml(o.customer_name || o.customer_id || "—")}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${priorityBadge(o.priority)}</td>
          <td class="text-muted">${timeAgo(o.created_at)}</td>
          <td class="table__actions">
            <button class="btn btn--ghost btn--sm" title="View" data-action="view" data-id="${o.id}"><i data-lucide="eye" style="width:14px;height:14px"></i></button>
            <button class="btn btn--ghost btn--sm" title="Update status" data-action="status" data-id="${o.id}"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>
            <button class="btn btn--ghost btn--sm" title="Auto allocate" data-action="allocate" data-id="${o.id}"><i data-lucide="zap" style="width:14px;height:14px"></i></button>
          </td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table>`;

  // Sort handlers
  container.querySelectorAll(".sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = "asc";
      }
      applyFilters();
    });
  });

  // Action handlers
  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "view") viewOrderDetail(id);
      else if (action === "status") openStatusModal(id);
      else if (action === "allocate") autoAllocate(id);
    });
  });

  renderPagination("orders-pagination", paging, (p) => {
    page = p;
    renderTable();
  });
  refreshIcons();
}

/* ── Status Update ── */
let statusOrderId = null;

function openStatusModal(id) {
  const order = allOrders.find((o) => String(o.id) === String(id));
  if (!order) return;
  statusOrderId = id;
  document.getElementById("status-modal-info").textContent =
    `Order ${id} — currently "${order.status}"`;
  document.getElementById("status-modal-select").value = order.status;
  document.getElementById("status-modal").style.display = "flex";
  refreshIcons();
}

async function confirmStatusUpdate() {
  const newStatus = document.getElementById("status-modal-select").value;
  try {
    await Orders.updateStatus(statusOrderId, newStatus);
    toast("Status updated", "success");
    closeModal("status-modal");
    await loadOrders();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Auto Allocate ── */
async function autoAllocate(id) {
  try {
    await Orders.autoAllocate(id);
    toast("Order allocated", "success");
    await loadOrders();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Order Detail ── */
async function viewOrderDetail(id) {
  const modal = document.getElementById("detail-modal");
  const body = document.getElementById("detail-modal-body");
  const title = document.getElementById("detail-modal-title");
  title.textContent = `Order ${id}`;
  body.innerHTML = `<div class="spinner" style="margin:2rem auto"></div>`;
  modal.style.display = "flex";

  try {
    const order = await Orders.getById(id);
    const items = order.items || [];

    body.innerHTML = `
      <div class="detail-grid">
        <div class="detail-grid__item"><span class="detail-grid__label">Order ID</span><span class="detail-grid__value">${escapeHtml(order.order_number || String(order.id).slice(0, 8))}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Customer</span><span class="detail-grid__value">${escapeHtml(order.customer_name || order.customer_id || "—")}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Status</span><span class="detail-grid__value">${statusBadge(order.status)}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Priority</span><span class="detail-grid__value">${priorityBadge(order.priority)}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Warehouse</span><span class="detail-grid__value">${order.fulfillment_warehouse_id || "—"}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Created</span><span class="detail-grid__value">${formatDateTime(order.created_at)}</span></div>
        <div class="detail-grid__item" style="grid-column:1/-1"><span class="detail-grid__label">Shipping Address</span><span class="detail-grid__value">${escapeHtml(order.shipping_address || "—")}</span></div>
      </div>
      ${
        items.length > 0
          ? `
        <h4 style="margin:1.25rem 0 0.5rem;font-size:0.8125rem;font-weight:600">Items (${items.length})</h4>
        <table class="table">
          <thead><tr><th>Product</th><th>Quantity</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${items
            .map(
              (it) => `
            <tr>
              <td>${escapeHtml(it.product_name || it.product_id || "—")}</td>
              <td>${formatNumber(it.quantity)}</td>
              <td>${formatCurrency(it.unit_price)}</td>
              <td>${formatCurrency(it.quantity * it.unit_price)}</td>
            </tr>`,
            )
            .join("")}
          </tbody>
        </table>`
          : `<p class="text-sm text-muted" style="margin-top:1rem">No items in this order.</p>`
      }
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state__title">Failed to load</div><div class="empty-state__description">${escapeHtml(err.message)}</div></div>`;
  }
  refreshIcons();
}

/* ── Create Order ── */
function openCreateModal() {
  document.getElementById("create-customer").value = "";
  document.getElementById("create-customer-id").value = "";
  document.getElementById("create-priority").value = "standard";
  document.getElementById("create-address").value = "";
  const itemsContainer = document.getElementById("order-items-container");
  itemsContainer.innerHTML = "";
  addOrderItemRow();
  document.getElementById("create-modal").style.display = "flex";
  refreshIcons();
}

function addOrderItemRow() {
  const container = document.getElementById("order-items-container");
  const row = document.createElement("div");
  row.className = "order-item-row";
  row.style.cssText =
    "display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center";
  row.innerHTML = `
    <input type="text" class="form-input" placeholder="Product ID (UUID)" style="flex:1">
    <input type="number" class="form-input" placeholder="Qty" min="1" value="1" style="width:80px">
    <button class="btn btn--ghost btn--sm" onclick="this.parentElement.remove()"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
  `;
  container.appendChild(row);
  refreshIcons();
}

async function submitCreateOrder() {
  const customer = document.getElementById("create-customer").value.trim();
  const customerId =
    document.getElementById("create-customer-id")?.value.trim() || customer;
  const priority = document.getElementById("create-priority").value;
  const address = document.getElementById("create-address").value.trim();

  if (!customer) {
    toast("Customer name is required", "error");
    return;
  }

  const rows = document.querySelectorAll(
    "#order-items-container .order-item-row",
  );
  const items = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll("input");
    const productId = inputs[0].value.trim();
    const qty = parseInt(inputs[1].value);
    if (productId && qty > 0)
      items.push({ product_id: productId, quantity: qty, unit_price: 0 });
  }

  if (items.length === 0) {
    toast("Add at least one order item", "error");
    return;
  }

  try {
    await Orders.create({
      customer_id: customerId,
      customer_name: customer,
      priority,
      shipping_address: address,
      items,
    });
    toast("Order created", "success");
    closeModal("create-modal");
    await loadOrders();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ── Helpers ── */
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
