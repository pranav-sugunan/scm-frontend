/**
 * inventory.js — Inventory Controller
 * Stock levels, movements, low stock alerts with analytics integration.
 */
import { Analytics, Inventory, Warehouses } from "./api.js";
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
let stock = [];
let filteredStock = [];
let movements = [];
let lowStock = [];
let warehouses = [];
let activeTab = "stock";
let stockPage = 1;
let movPage = 1;
const perPage = 25;
let stockSearch = "";
let stockWarehouse = "";
let sortKey = "product_name";
let sortDir = "asc";

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("inventory");
  bindEvents();
  await loadAll();
});

function bindEvents() {
  const $ = (s) => document.querySelector(s);

  // Tabs
  document.querySelectorAll(".tab-bar__item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-bar__item")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => (p.style.display = "none"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      document.getElementById(`tab-${activeTab}`).style.display = "block";
    });
  });

  // Stock filters
  $("#stock-search").addEventListener(
    "input",
    debounce((e) => {
      stockSearch = e.target.value.trim().toLowerCase();
      stockPage = 1;
      applyStockFilters();
    }, 250),
  );
  $("#stock-warehouse-filter").addEventListener("change", (e) => {
    stockWarehouse = e.target.value;
    stockPage = 1;
    applyStockFilters();
  });

  // Modal bindings
  $("#btn-receive").addEventListener("click", () => openModal("receive-modal"));
  $("#btn-transfer").addEventListener("click", () =>
    openModal("transfer-modal"),
  );
  $("#btn-adjust").addEventListener("click", () => openModal("adjust-modal"));

  ["receive", "transfer", "adjust"].forEach((type) => {
    $(`#${type}-modal-close`).addEventListener("click", () =>
      closeModal(`${type}-modal`),
    );
    $(`#${type}-modal-cancel`).addEventListener("click", () =>
      closeModal(`${type}-modal`),
    );
  });

  $("#receive-modal-submit").addEventListener("click", submitReceive);
  $("#transfer-modal-submit").addEventListener("click", submitTransfer);
  $("#adjust-modal-submit").addEventListener("click", submitAdjust);

  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  });
}

/* ── Data Loading ── */
async function loadAll() {
  showPageLoader("inv-metrics");

  try {
    const [stockRes, movRes, lowRes, whRes, analyticsRes] =
      await Promise.allSettled([
        Inventory.getAllStock({ limit: 500 }),
        Inventory.getMovements({ limit: 200 }),
        Inventory.getBelowReorder(),
        Warehouses.getAll(),
        Analytics.getDashboard(),
      ]);

    stock = stockRes.status === "fulfilled" ? stockRes.value : [];
    movements = movRes.status === "fulfilled" ? movRes.value : [];
    lowStock = lowRes.status === "fulfilled" ? lowRes.value : [];
    warehouses = whRes.status === "fulfilled" ? whRes.value : [];
    const dash =
      analyticsRes.status === "fulfilled" ? analyticsRes.value : null;

    renderMetrics(dash);
    populateWarehouseFilter();
    applyStockFilters();
    renderMovements();
    renderLowStock();

    // Update subtitle & tab count
    const subtitle = document.getElementById("inv-subtitle");
    if (subtitle)
      subtitle.textContent = `${formatNumber(stock.length)} stock items across ${warehouses.length} warehouses`;

    const badge = document.getElementById("lowstock-count");
    if (badge) {
      badge.textContent = lowStock.length > 0 ? lowStock.length : "";
      badge.style.display = lowStock.length > 0 ? "inline-flex" : "none";
    }
  } catch (err) {
    showError("inv-metrics", err.message);
  }
}

/* ── Analytics Metrics ── */
function renderMetrics(dash) {
  const container = document.getElementById("inv-metrics");
  if (!container) return;

  const ik = dash?.inventory_kpis ?? {};

  const metrics = [
    {
      label: "Total SKUs",
      value: formatNumber(ik.total_skus ?? stock.length),
      icon: "box",
    },
    {
      label: "Total Units",
      value: formatNumber(ik.total_units ?? 0),
      icon: "layers",
    },
    {
      label: "Inventory Value",
      value: formatCurrency(ik.total_value ?? 0),
      icon: "indian-rupee",
    },
    {
      label: "Below Reorder",
      value: formatNumber(lowStock.length),
      icon: "alert-triangle",
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

/* ── Warehouse Filter ── */
function populateWarehouseFilter() {
  const sel = document.getElementById("stock-warehouse-filter");
  if (!sel) return;
  sel.innerHTML =
    `<option value="">All warehouses</option>` +
    warehouses
      .map(
        (w) =>
          `<option value="${w.id}">${escapeHtml(w.name || `Warehouse ${w.id}`)}</option>`,
      )
      .join("");
}

/* ── Stock Table ── */
function applyStockFilters() {
  filteredStock = stock.filter((s) => {
    if (stockSearch) {
      const hay =
        `${s.product_name || s.product_id || ""} ${s.warehouse_name || s.warehouse_id || ""}`.toLowerCase();
      if (!hay.includes(stockSearch)) return false;
    }
    if (stockWarehouse && String(s.warehouse_id) !== stockWarehouse)
      return false;
    return true;
  });

  filteredStock = sortBy(filteredStock, sortKey, sortDir);
  renderStockTable();
}

function renderStockTable() {
  const container = document.getElementById("stock-table-container");
  if (!container) return;

  const paging = paginate(filteredStock, stockPage, perPage);
  const { items } = paging;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="package"></i></div><div class="empty-state__title">No stock found</div><div class="empty-state__description">${stock.length === 0 ? "No inventory records yet." : "Try adjusting your filters."}</div></div>`;
    document.getElementById("stock-pagination").innerHTML = "";
    refreshIcons();
    return;
  }

  const sortIcon = (key) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th class="sortable" data-key="product_name">Product${sortIcon("product_name")}</th>
          <th>Warehouse</th>
          <th class="sortable" data-key="quantity">Quantity${sortIcon("quantity")}</th>
          <th>Reorder Pt</th>
          <th>Health</th>
          <th class="sortable" data-key="last_counted_at">Last Counted${sortIcon("last_counted_at")}</th>
        </tr>
      </thead>
      <tbody>${items
        .map((s) => {
          const pct =
            s.reorder_point > 0
              ? Math.min(100, Math.round((s.quantity / s.reorder_point) * 100))
              : 100;
          const cls = pct < 50 ? "danger" : pct < 100 ? "warning" : "success";
          return `
          <tr>
            <td><strong>${escapeHtml(s.product_name || String(s.product_id || "—"))}</strong></td>
            <td>${escapeHtml(s.warehouse_name || String(s.warehouse_id || "—"))}</td>
            <td>${formatNumber(s.quantity)}</td>
            <td class="text-muted">${formatNumber(s.reorder_point ?? 0)}</td>
            <td style="min-width:80px">
              <div class="progress-bar" style="height:6px">
                <div class="progress-bar__fill progress-bar__fill--${cls}" style="width:${Math.min(pct, 100)}%"></div>
              </div>
            </td>
            <td class="text-muted">${timeAgo(s.last_counted_at || s.created_at)}</td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>`;

  container.querySelectorAll(".sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = "asc";
      }
      applyStockFilters();
    });
  });

  renderPagination("stock-pagination", paging, (p) => {
    stockPage = p;
    renderStockTable();
  });
  refreshIcons();
}

/* ── Movements ── */
function renderMovements() {
  const container = document.getElementById("movements-container");
  if (!container) return;

  if (movements.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="arrow-right-left"></i></div><div class="empty-state__title">No movements</div><div class="empty-state__description">Stock movements will appear here.</div></div>`;
    refreshIcons();
    return;
  }

  const movPaging = paginate(movements, movPage, 20);
  const { items } = movPaging;

  const typeIcon = {
    inbound: "package-plus",
    outbound: "truck",
    transfer: "arrow-right-left",
    adjustment: "sliders",
    return: "undo-2",
    cycle_count: "clipboard-check",
  };
  const typeColor = {
    inbound: "success",
    outbound: "primary",
    transfer: "info",
    adjustment: "warning",
    return: "danger",
    cycle_count: "default",
  };

  container.innerHTML = `
    <table class="table">
      <thead><tr><th>Type</th><th>Product</th><th>From → To</th><th>Quantity</th><th>Date</th></tr></thead>
      <tbody>${items
        .map(
          (m) => `
        <tr>
          <td><span class="badge badge--${typeColor[m.movement_type] || "default"}">${escapeHtml(m.movement_type || "—")}</span></td>
          <td>${escapeHtml(m.product_name || String(m.product_id || "—"))}</td>
          <td>${escapeHtml(String(m.from_warehouse_id || "—"))} → ${escapeHtml(String(m.to_warehouse_id || "—"))}</td>
          <td>${m.quantity > 0 ? "+" : ""}${formatNumber(m.quantity)}</td>
          <td class="text-muted">${timeAgo(m.created_at)}</td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table>`;

  renderPagination("movements-pagination", movPaging, (p) => {
    movPage = p;
    renderMovements();
  });
}

/* ── Low Stock ── */
function renderLowStock() {
  const container = document.getElementById("lowstock-container");
  if (!container) return;

  if (lowStock.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="check-circle"></i></div><div class="empty-state__title">All stock healthy</div><div class="empty-state__description">No items are below their reorder point.</div></div>`;
    refreshIcons();
    return;
  }

  container.innerHTML = `
    <table class="table">
      <thead><tr><th>Product</th><th>Warehouse</th><th>Current</th><th>Reorder Point</th><th>Deficit</th><th>Health</th></tr></thead>
      <tbody>${lowStock
        .map((s) => {
          const pct =
            s.reorder_point > 0
              ? Math.round((s.quantity / s.reorder_point) * 100)
              : 0;
          const deficit = Math.max(
            0,
            (s.reorder_point || 0) - (s.quantity || 0),
          );
          const cls = pct < 25 ? "danger" : pct < 50 ? "warning" : "info";
          return `
          <tr>
            <td><strong>${escapeHtml(s.product_name || String(s.product_id || "—"))}</strong></td>
            <td>${escapeHtml(s.warehouse_name || String(s.warehouse_id || "—"))}</td>
            <td>${formatNumber(s.quantity)}</td>
            <td>${formatNumber(s.reorder_point)}</td>
            <td class="text-danger"><strong>−${formatNumber(deficit)}</strong></td>
            <td style="min-width:80px">
              <div class="progress-bar" style="height:6px">
                <div class="progress-bar__fill progress-bar__fill--${cls}" style="width:${pct}%"></div>
              </div>
            </td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>`;
}

/* ── Modal Actions ── */
function openModal(id) {
  document.getElementById(id).style.display = "flex";
  refreshIcons();
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function submitReceive() {
  const productId = document.getElementById("receive-product").value.trim();
  const warehouseId = document.getElementById("receive-warehouse").value.trim();
  const qty = parseInt(document.getElementById("receive-qty").value);

  if (!productId || !warehouseId || !qty || qty <= 0) {
    toast("All fields are required and quantity must be positive", "error");
    return;
  }

  try {
    await Inventory.receiveStock({
      product_id: productId,
      warehouse_id: warehouseId,
      quantity: qty,
    });
    toast("Stock received", "success");
    closeModal("receive-modal");
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function submitTransfer() {
  const productId = document.getElementById("transfer-product").value.trim();
  const from = document.getElementById("transfer-from").value.trim();
  const to = document.getElementById("transfer-to").value.trim();
  const qty = parseInt(document.getElementById("transfer-qty").value);

  if (!productId || !from || !to || !qty || qty <= 0) {
    toast("All fields are required", "error");
    return;
  }

  try {
    await Inventory.transferStock({
      product_id: productId,
      from_warehouse_id: from,
      to_warehouse_id: to,
      quantity: qty,
    });
    toast("Stock transferred", "success");
    closeModal("transfer-modal");
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function submitAdjust() {
  const productId = document.getElementById("adjust-product").value.trim();
  const warehouseId = document.getElementById("adjust-warehouse").value.trim();
  const qty = parseInt(document.getElementById("adjust-qty").value);
  const reason = document.getElementById("adjust-reason").value.trim();

  if (!productId || !warehouseId || isNaN(qty)) {
    toast("Product, warehouse and quantity are required", "error");
    return;
  }

  try {
    await Inventory.adjustStock({
      product_id: productId,
      warehouse_id: warehouseId,
      quantity_delta: qty,
      reason,
    });
    toast("Stock adjusted", "success");
    closeModal("adjust-modal");
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  }
}
