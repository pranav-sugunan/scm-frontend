/**
 * dashboard.js — Dashboard Page Controller
 * Fetches and renders: KPIs, Orders-over-time chart,
 * Inventory distribution chart, recent orders table.
 * Auto-polls every 10 seconds.
 */

import { Analytics, Orders, Inventory } from "./api.js";
import {
  initShell,
  markSyncing,
  formatDate,
  formatNumber,
  formatPercent,
  statusBadge,
  priorityBadge,
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
   CHART INSTANCES (kept for update/destroy)
   ============================================================ */
let ordersChart = null;
let inventoryChart = null;

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("dashboard", "Dashboard");
  await loadDashboard();

  // Auto-refresh every 10 seconds
  startPolling(
    "dashboard",
    async () => {
      markSyncing();
      await loadDashboard(true);
    },
    10000,
  );
});

/* ============================================================
   MAIN LOADER
   ============================================================ */
async function loadDashboard(silent = false) {
  if (!silent) {
    showPageLoader("kpi-container");
  }

  try {
    // Fetch dashboard + supplementary data in parallel
    const [dashData, belowReorder] = await Promise.allSettled([
      Analytics.getDashboard(),
      Inventory.getBelowReorder(),
    ]);

    const dash = dashData.status === "fulfilled" ? dashData.value : null;
    const lowStock =
      belowReorder.status === "fulfilled" ? belowReorder.value : [];

    if (dash) {
      renderKPIs(dash, lowStock);
      renderOrdersChart(dash);
      renderInventoryChart(dash);
      renderRecentOrders();
      renderAlerts(lowStock);
      updateSidebarBadge(lowStock);
    } else {
      showError(
        "kpi-container",
        "Could not load dashboard. Ensure the backend is running on port 8000.",
      );
    }
  } catch (err) {
    showError("kpi-container", err.message);
  }
}

/* ============================================================
   KPI CARDS
   ============================================================ */
function renderKPIs(dash, lowStock = []) {
  const container = document.getElementById("kpi-container");
  if (!container) return;

  // Unwrap nested KPI objects from DashboardResponse
  const orderKpis = dash.order_kpis ?? {};
  const invKpis = dash.inventory_kpis ?? {};

  const totalOrders = orderKpis.total_orders ?? dash.total_orders ?? 0;
  const pendingOrders =
    Math.round((orderKpis.backorder_rate ?? 0) * totalOrders) ||
    (dash.pending_orders ?? 0);
  const totalInventory = invKpis.total_units ?? dash.total_inventory ?? 0;
  const totalShipments = totalOrders;
  const onTimeRate = orderKpis.on_time_delivery_rate ?? 1;
  const delayedShipments =
    Math.round((1 - onTimeRate) * totalOrders) || (dash.delayed_shipments ?? 0);
  const lowStockCount = Array.isArray(lowStock)
    ? lowStock.length
    : (invKpis.items_below_reorder ?? dash.low_stock_alerts ?? 0);

  // Derived: delay rate
  const delayRate =
    totalShipments > 0
      ? ((delayedShipments / totalShipments) * 100).toFixed(1)
      : 0;

  // Derived: stock health (% items above reorder)
  const stockHealth =
    lowStockCount > 0 && totalInventory > 0
      ? Math.max(0, 100 - (lowStockCount / totalInventory) * 100).toFixed(0)
      : 100;

  const kpis = [
    {
      id: "total-orders",
      label: "Total Orders",
      value: formatNumber(totalOrders),
      sublabel: `${formatNumber(pendingOrders)} pending`,
      icon: orderIcon(),
      color: "blue",
      trend:
        pendingOrders > 0
          ? { dir: "up", label: `${pendingOrders} active` }
          : null,
    },
    {
      id: "inventory-levels",
      label: "Inventory Items",
      value: formatNumber(totalInventory),
      sublabel: `${lowStockCount} low stock`,
      icon: inventoryIcon(),
      color: lowStockCount > 0 ? "yellow" : "green",
      trend:
        lowStockCount > 0
          ? { dir: "down", label: `${lowStockCount} alerts` }
          : { dir: "up", label: "Healthy" },
    },
    {
      id: "delayed-shipments",
      label: "Delayed Shipments",
      value: formatNumber(delayedShipments),
      sublabel: `${delayRate}% delay rate`,
      icon: shipmentIcon(),
      color: delayedShipments > 0 ? "red" : "green",
      trend:
        delayedShipments > 0
          ? { dir: "down", label: `${delayRate}% rate` }
          : { dir: "up", label: "On time" },
    },
    {
      id: "low-stock-alerts",
      label: "Low Stock Alerts",
      value: formatNumber(lowStockCount),
      sublabel: `Stock health ${stockHealth}%`,
      icon: alertIcon(),
      color: lowStockCount > 5 ? "red" : lowStockCount > 0 ? "yellow" : "green",
      trend: {
        dir: lowStockCount > 0 ? "down" : "up",
        label: `${stockHealth}% healthy`,
      },
    },
  ];

  container.innerHTML = kpis.map((kpi) => kpiCardHTML(kpi)).join("");
}

function kpiCardHTML({ id, label, value, sublabel, icon, color, trend }) {
  const trendHtml = trend
    ? `
    <div class="kpi-card__trend kpi-card__trend--${trend.dir === "up" ? "up" : "down"}">
      ${trend.dir === "up" ? upArrow() : downArrow()}
      ${escapeHtml(trend.label)}
    </div>`
    : "";

  return `
    <div class="kpi-card kpi-card--${color} animate-fade-in" id="${id}">
      <div class="kpi-card__header">
        <div class="kpi-card__icon-wrap kpi-card__icon-wrap--${color}">${icon}</div>
        ${trendHtml}
      </div>
      <div class="kpi-card__value">${value}</div>
      <div class="kpi-card__label">${escapeHtml(label)}</div>
      ${sublabel ? `<div class="kpi-card__sublabel">${escapeHtml(sublabel)}</div>` : ""}
    </div>`;
}

/* ============================================================
   ORDERS OVER TIME CHART
   ============================================================ */
function renderOrdersChart(dash) {
  const canvas = document.getElementById("orders-chart");
  if (!canvas) return;

  // Use real order KPI data to build a summary bar chart
  const orderKpis = dash.order_kpis ?? {};
  const fulfillRate = orderKpis.fulfillment_rate ?? 0;
  const onTimeRate = orderKpis.on_time_delivery_rate ?? 0;
  const perfectRate = orderKpis.perfect_order_rate ?? 0;
  const backorderRate = orderKpis.backorder_rate ?? 0;

  const labels = [
    "Fulfillment",
    "On-Time Delivery",
    "Perfect Order",
    "Backorder",
  ];
  const values = [
    +(fulfillRate * 100).toFixed(1),
    +(onTimeRate * 100).toFixed(1),
    +(perfectRate * 100).toFixed(1),
    +(backorderRate * 100).toFixed(1),
  ];

  if (ordersChart) ordersChart.destroy();

  ordersChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Rate (%)",
          data: values,
          backgroundColor: [
            CHART_COLORS.primary,
            CHART_COLORS.success,
            CHART_COLORS.info,
            CHART_COLORS.warning,
          ],
          borderWidth: 0,
          borderRadius: 6,
          barPercentage: 0.6,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } },
      },
      plugins: {
        ...chartDefaults().plugins,
        legend: { display: false },
        tooltip: {
          ...chartDefaults().plugins?.tooltip,
          callbacks: { label: (ctx) => `${ctx.parsed.y}%` },
        },
      },
    },
  });
}

/* ============================================================
   INVENTORY DISTRIBUTION CHART
   ============================================================ */
function renderInventoryChart(dash) {
  const canvas = document.getElementById("inventory-chart");
  if (!canvas) return;

  const distribution =
    dash.inventory_distribution ?? dash.inventory_by_category ?? [];

  const invKpis = dash.inventory_kpis ?? {};

  let labels, values;
  if (distribution.length > 0) {
    labels = distribution.map((d) => d.category ?? d.name ?? "Unknown");
    values = distribution.map((d) => d.count ?? d.quantity ?? d.value ?? 0);
  } else if (invKpis.total_units) {
    // Build chart from available KPI data
    const belowReorder = invKpis.items_below_reorder ?? 0;
    const overstock = invKpis.overstock_count ?? 0;
    const healthy = Math.max(
      0,
      (invKpis.total_skus ?? 0) - belowReorder - overstock,
    );
    labels = ["Healthy Stock", "Below Reorder", "Overstock"];
    values = [healthy, belowReorder, overstock];
  } else {
    // No inventory data available
    return;
  }

  if (inventoryChart) inventoryChart.destroy();

  inventoryChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: CHART_PALETTE,
          borderWidth: 2,
          borderColor: "#ffffff",
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            font: { family: "'Inter', sans-serif", size: 12 },
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
        tooltip: {
          backgroundColor: "#0F172A",
          titleFont: { family: "'Inter', sans-serif", size: 12, weight: "600" },
          bodyFont: { family: "'Inter', sans-serif", size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
    },
  });
}

/* ============================================================
   RECENT ORDERS TABLE
   ============================================================ */
async function renderRecentOrders() {
  const container = document.getElementById("recent-orders-container");
  if (!container) return;

  let orders = [];

  try {
    const data = await Orders.getAll({ limit: 8, offset: 0 });
    orders = Array.isArray(data)
      ? data.slice(0, 8)
      : (data?.items ?? []).slice(0, 8);
  } catch (_) {
    /* silently skip */
  }

  if (orders.length === 0) {
    showEmpty(
      "recent-orders-container",
      "No recent orders",
      "Orders will appear here once created.",
    );
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Order #</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map(
              (order) => `
            <tr>
              <td><span class="table__id">${escapeHtml(order.order_number ?? "—")}</span></td>
              <td>${escapeHtml(order.customer_name ?? "—")}</td>
              <td>$${formatNumber(order.total_amount, 2)}</td>
              <td>${statusBadge(order.status)}</td>
              <td>${priorityBadge(order.priority)}</td>
              <td class="text-muted">${formatDate(order.created_at)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

/* ============================================================
   ALERTS PANEL (Low Stock)
   ============================================================ */
function renderAlerts(lowStock = []) {
  const container = document.getElementById("alerts-container");
  if (!container) return;

  if (!Array.isArray(lowStock) || lowStock.length === 0) {
    container.innerHTML = `
      <div class="alert alert--success">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>All inventory levels are healthy. No reorder needed.</span>
      </div>`;
    return;
  }

  const items = lowStock.slice(0, 5);
  container.innerHTML = `
    <div class="alert alert--warning" style="margin-bottom:1rem">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      <span>${lowStock.length} item(s) are below reorder point and need restocking.</span>
    </div>
    ${items
      .map(
        (item) => `
      <div class="anomaly-card anomaly-card--warning">
        <div class="anomaly-card__icon" style="background:var(--clr-warning-light);color:var(--clr-warning)">
          ${alertIcon()}
        </div>
        <div class="anomaly-card__content">
          <div class="anomaly-card__title">${escapeHtml(item.product_name ?? "Unknown Item")}</div>
          <div class="anomaly-card__description">
            Stock: <strong>${formatNumber(item.total_quantity ?? 0)}</strong>
            / Reorder at: <strong>${formatNumber(item.reorder_point ?? 0)}</strong>
          </div>
          <div class="anomaly-card__meta">
            ${item.warehouse_id ? `<span>Warehouse: ${escapeHtml(String(item.warehouse_id).slice(0, 8))}…</span>` : ""}
          </div>
        </div>
      </div>`,
      )
      .join("")}
    ${
      lowStock.length > 5
        ? `<div class="text-sm text-secondary" style="margin-top:.5rem;padding:.5rem">
      +${lowStock.length - 5} more items below reorder point. <a href="inventory.html" style="color:var(--clr-primary)">View all →</a>
    </div>`
        : ""
    }`;
}

/* ============================================================
   HELPERS — SVG Icons
   ============================================================ */
function orderIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0
      002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>`;
}

function inventoryIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`;
}

function shipmentIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0
      011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0
      001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/></svg>`;
}

function alertIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`;
}

function upArrow() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:12px;height:12px">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg>`;
}

function downArrow() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:12px;height:12px">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>`;
}

/* ============================================================
   SIDEBAR LOW STOCK BADGE
   ============================================================ */
function updateSidebarBadge(lowStock) {
  const badge = document.getElementById("low-stock-sidebar-badge");
  if (!badge) return;
  const count = Array.isArray(lowStock) ? lowStock.length : 0;
  badge.textContent = count;
  badge.style.display = count > 0 ? "inline-flex" : "none";
}
