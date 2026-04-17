/**
 * dashboard.js — Dashboard Controller
 * KPIs, order pipeline, charts, recent orders, low stock alerts.
 * Each section renders independently for resilience.
 */
import {
  Analytics,
  Forecasts,
  Orders,
  Inventory,
  Products,
  Warehouses,
  Shipments,
  fetchAll,
} from "./api.js";
import {
  initShell,
  markSyncing,
  formatNumber,
  formatPercent,
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
  startPolling,
  refreshIcons,
  formatCurrency,
  CHART_COLORS,
  CHART_PALETTE,
  chartDefaults,
} from "./utils.js";

let ordersChart = null;
let inventoryChart = null;
let forecastChart = null;

/* Forecast picker state */
let allProducts = [];
let allWarehouses = [];

document.addEventListener("DOMContentLoaded", async () => {
  await initShell("dashboard");
  // Load products + warehouses in the background for the forecast picker
  Promise.allSettled([
    Products.getAll({ limit: 200 }),
    Warehouses.getAll(),
  ]).then(([pRes, wRes]) => {
    allProducts = pRes.status === "fulfilled" ? pRes.value : [];
    allWarehouses = wRes.status === "fulfilled" ? wRes.value : [];
    populateForecastPicker();
  });

  document
    .getElementById("btn-run-forecast")
    ?.addEventListener("click", runForecastFromPicker);

  // Also run on Enter inside selects
  ["forecast-product-sel", "forecast-wh-sel"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runForecastFromPicker();
    });
  });
  await loadDashboard();
  startPolling(
    "dashboard",
    async () => {
      markSyncing();
      await loadDashboard(true);
    },
    10000,
  );
});

async function loadDashboard(silent = false) {
  if (!silent) showPageLoader("kpi-container");

  try {
    const [dashRes, lowStockRes, stockSampleRes, ordersRes, shipmentsRes] =
      await Promise.allSettled([
        Analytics.getDashboard(),
        Inventory.getBelowReorder(),
        Inventory.getAllStock({ limit: 1 }),
        fetchAll(Orders.getAll),
        Shipments.getAll({ limit: 50 }),
      ]);

    const dash = dashRes.status === "fulfilled" ? dashRes.value : null;
    const lowStock =
      lowStockRes.status === "fulfilled" ? lowStockRes.value : [];
    const stockSample =
      stockSampleRes.status === "fulfilled" ? stockSampleRes.value : [];
    const orders = ordersRes.status === "fulfilled" ? ordersRes.value : [];
    const shipments =
      shipmentsRes.status === "fulfilled" ? shipmentsRes.value : [];

    const forecastTarget = pickForecastTarget(lowStock, stockSample);

    const [detectedAnomaliesRes, anomaliesRes] = await Promise.allSettled([
      Analytics.detectAnomalies(7),
      Analytics.getAnomalies({ limit: 6 }),
    ]);

    const anomaliesFromDetect =
      detectedAnomaliesRes.status === "fulfilled"
        ? detectedAnomaliesRes.value
        : [];
    const anomaliesFromList =
      anomaliesRes.status === "fulfilled" ? anomaliesRes.value : [];
    const anomalies =
      Array.isArray(anomaliesFromDetect) && anomaliesFromDetect.length > 0
        ? anomaliesFromDetect
        : anomaliesFromList;

    const forecasts = []; // Forecast is now user-driven via the picker

    renderKPIs(dash, orders, lowStock, shipments);
    renderOrderPipeline(orders);

    if (dash) {
      renderOrdersChart(dash);
      renderInventoryChart(dash);
    }

    renderAIInsights(dash, anomalies, forecasts);
    // renderForecastChart is only called by the picker now

    renderRecentOrders(orders);
    renderAlerts(lowStock);
    updateSidebarBadge(lowStock);
  } catch (err) {
    if (!silent) showError("kpi-container", err.message);
  }
}

function pickForecastTarget(lowStock, stockSample) {
  const sources = [
    ...(Array.isArray(lowStock) ? lowStock : []),
    ...(Array.isArray(stockSample) ? stockSample : []),
  ];
  const target = sources.find((item) => item?.product_id && item?.warehouse_id);
  if (!target) return null;
  return {
    product_id: target.product_id,
    warehouse_id: target.warehouse_id,
  };
}

/* ── KPI Cards ── */
function renderKPIs(dash, orders, lowStock, shipments) {
  const container = document.getElementById("kpi-container");
  if (!container) return;

  const ok = dash?.order_kpis ?? {};
  const ik = dash?.inventory_kpis ?? {};
  const totalOrders = orders.length || ok.total_orders || 0;
  const lowStockCount = Array.isArray(lowStock) ? lowStock.length : 0;
  const activeShipments = Array.isArray(shipments)
    ? shipments.filter(
        (s) => !["delivered", "returned", "cancelled"].includes(s.status),
      ).length
    : 0;

  const kpis = [
    {
      label: "Total Orders",
      value: formatNumber(totalOrders),
      sub: `${formatPercent((ok.fulfillment_rate ?? 0) * 100)} fulfilled`,
      icon: "clipboard-list",
    },
    {
      label: "Inventory Units",
      value: formatNumber(ik.total_units ?? 0),
      sub: ik.total_value ? formatCurrency(ik.total_value) + " value" : "—",
      icon: "package",
    },
    {
      label: "Active Shipments",
      value: formatNumber(activeShipments),
      sub: `${formatPercent((ok.on_time_delivery_rate ?? 0) * 100)} on-time`,
      icon: "truck",
    },
    {
      label: "Low Stock Alerts",
      value: formatNumber(lowStockCount),
      sub: lowStockCount === 0 ? "All stock healthy" : "Items need attention",
      icon: "alert-triangle",
    },
  ];

  container.innerHTML = kpis
    .map(
      (k) => `
    <div class="metric-card">
      <div class="metric-card__label"><i data-lucide="${k.icon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>${escapeHtml(k.label)}</div>
      <div class="metric-card__value">${k.value}</div>
      <div class="metric-card__sub">${escapeHtml(k.sub)}</div>
    </div>`,
    )
    .join("");
  refreshIcons();
}

/* ── Order Pipeline ── */
const PIPELINE_STAGES = [
  { key: "created", label: "Created", color: "var(--clr-gray-400)" },
  { key: "allocated", label: "Allocated", color: "var(--clr-info)" },
  { key: "picked", label: "Picked", color: "#8b5cf6" },
  { key: "packed", label: "Packed", color: "var(--clr-warning)" },
  { key: "shipped", label: "Shipped", color: "var(--clr-primary)" },
  { key: "in_transit", label: "In Transit", color: "#f97316" },
  { key: "delivered", label: "Delivered", color: "var(--clr-success)" },
];

function renderOrderPipeline(orders) {
  const container = document.getElementById("order-pipeline");
  if (!container) return;

  const arr = Array.isArray(orders) ? orders : [];
  if (arr.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">No orders yet</div><div class="empty-state__description">Orders will appear in the pipeline once created.</div></div>`;
    return;
  }

  const counts = {};
  PIPELINE_STAGES.forEach((s) => (counts[s.key] = 0));
  arr.forEach((o) => {
    const s = (o.status || "").toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
  });

  const total = arr.length || 1;
  const arrow = `<div class="pipeline__connector"><i data-lucide="chevron-right"></i></div>`;

  container.innerHTML = `<div class="pipeline">${PIPELINE_STAGES.map((s, i) => {
    const count = counts[s.key];
    const pct = Math.round((count / total) * 100);
    return (
      (i > 0 ? arrow : "") +
      `
      <div class="pipeline__stage${count > 0 ? " active" : ""}">
        <div class="pipeline__stage-count" style="color:${s.color}">${count}</div>
        <div class="pipeline__stage-label">${s.label}</div>
        <div class="pipeline__stage-bar">
          <div class="pipeline__stage-bar-fill" style="width:${pct}%;background:${s.color}"></div>
        </div>
      </div>`
    );
  }).join("")}</div>`;
  refreshIcons();
}

/* ── Charts ── */
function renderOrdersChart(dash) {
  const canvas = document.getElementById("orders-chart");
  if (!canvas) return;

  const k = dash.order_kpis ?? {};
  const labels = ["Fulfillment", "On-Time", "Perfect Order", "Backorder"];
  const values = [
    +((k.fulfillment_rate ?? 0) * 100).toFixed(1),
    +((k.on_time_delivery_rate ?? 0) * 100).toFixed(1),
    +((k.perfect_order_rate ?? 0) * 100).toFixed(1),
    +((k.backorder_rate ?? 0) * 100).toFixed(1),
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
          barPercentage: 0.55,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      plugins: { ...chartDefaults().plugins, legend: { display: false } },
      scales: {
        ...chartDefaults().scales,
        y: {
          ...chartDefaults().scales.y,
          max: 100,
          ticks: {
            ...chartDefaults().scales.y.ticks,
            callback: (v) => v + "%",
          },
        },
      },
    },
  });
}

function renderInventoryChart(dash) {
  const canvas = document.getElementById("inventory-chart");
  if (!canvas) return;

  const ik = dash.inventory_kpis ?? {};
  const totalUnits = ik.total_units ?? 0;
  const belowReorder = ik.items_below_reorder ?? 0;
  const healthy = totalUnits - belowReorder;

  if (healthy === 0 && belowReorder === 0) {
    canvas.parentElement.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">No inventory data</div></div>`;
    return;
  }

  if (inventoryChart) inventoryChart.destroy();
  inventoryChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Healthy Stock", "Below Reorder"],
      datasets: [
        {
          data: [Math.max(0, healthy), belowReorder],
          backgroundColor: [CHART_COLORS.success, CHART_COLORS.warning],
          borderWidth: 0,
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
        tooltip: chartDefaults().plugins.tooltip,
      },
    },
  });
}

/* ── AI Insights ── */
function renderAIInsights(dash, anomalies, forecasts) {
  const banner = document.getElementById("ai-insights-banner");
  const feed = document.getElementById("ai-anomalies");
  if (!banner || !feed) return;

  const forecastKpis = dash?.forecast_kpis ?? {};
  const forecastRows = Array.isArray(forecasts) ? forecasts : [];
  const upcomingDemand = forecastRows
    .slice(0, 7)
    .reduce((sum, row) => sum + Number(row?.forecasted_quantity || 0), 0);
  const avgMape =
    typeof forecastKpis?.avg_mape === "number"
      ? formatPercent(forecastKpis.avg_mape * 100)
      : "—";
  const modelVersion = forecastKpis?.model_version || "n/a";

  const anomalyList = Array.isArray(anomalies) ? anomalies : [];
  const criticalCount = anomalyList.filter((a) => {
    const severity = String(a?.severity || a?.priority || "").toLowerCase();
    return severity === "high" || severity === "critical";
  }).length;

  const topMetrics = [
    {
      label: "open anomalies",
      value: formatNumber(anomalyList.length),
    },
    {
      label: "high-risk alerts",
      value: formatNumber(criticalCount),
    },
    {
      label: "7-day demand",
      value: formatNumber(Math.round(upcomingDemand)),
    },
    {
      label: `MAPE (${modelVersion})`,
      value: avgMape,
    },
  ].slice(0, 4);

  banner.innerHTML = topMetrics
    .map(
      (m) => `<div class="analytics-banner__item">
      <div class="analytics-banner__value">${escapeHtml(String(m.value))}</div>
      <div class="analytics-banner__label">${escapeHtml(m.label)}</div>
    </div>`,
    )
    .join("");

  if (anomalyList.length === 0) {
    feed.innerHTML = `<div class="empty-state" style="padding:1.25rem"><div class="empty-state__icon"><i data-lucide="shield-check"></i></div><div class="empty-state__title">AI anomaly monitor is clear</div><div class="empty-state__description">No active anomaly alerts right now.</div></div>`;
    refreshIcons();
    return;
  }

  feed.innerHTML = `<ul class="activity-feed">${anomalyList
    .slice(0, 6)
    .map((a) => {
      const severity = String(
        a?.severity || a?.priority || "medium",
      ).toLowerCase();
      const dot =
        severity === "high" || severity === "critical"
          ? "danger"
          : severity === "low"
            ? "info"
            : "warning";
      const title =
        a?.metric ||
        a?.alert_type ||
        a?.title ||
        a?.description ||
        "Anomaly alert";
      const subtitleParts = [
        a?.warehouse_id ? `Warehouse: ${a.warehouse_id}` : "",
        a?.detected_at
          ? timeAgo(a.detected_at)
          : a?.created_at
            ? timeAgo(a.created_at)
            : "",
      ].filter(Boolean);

      return `<li class="activity-feed__item"><div class="activity-feed__dot activity-feed__dot--${dot}"></div><div class="activity-feed__text"><strong>${escapeHtml(String(title))}</strong>${subtitleParts.length ? `<div class="text-xs text-muted">${escapeHtml(subtitleParts.join(" • "))}</div>` : ""}</div></li>`;
    })
    .join("")}</ul>`;
  refreshIcons();
}

/* ── Forecast Picker ── */
function populateForecastPicker() {
  const prodSel = document.getElementById("forecast-product-sel");
  const whSel = document.getElementById("forecast-wh-sel");
  if (!prodSel || !whSel) return;

  prodSel.innerHTML =
    '<option value="">Select a product…</option>' +
    allProducts
      .map(
        (p) =>
          `<option value="${escapeHtml(String(p.id))}">${escapeHtml(
            p.name || p.sku || String(p.id),
          )}</option>`,
      )
      .join("");

  whSel.innerHTML =
    '<option value="">All warehouses</option>' +
    allWarehouses
      .map(
        (w) =>
          `<option value="${escapeHtml(String(w.id))}">${escapeHtml(
            w.name || w.code || String(w.id),
          )}</option>`,
      )
      .join("");
}

async function runForecastFromPicker() {
  const prodId = document.getElementById("forecast-product-sel")?.value;
  const whId = document.getElementById("forecast-wh-sel")?.value;
  const btn = document.getElementById("btn-run-forecast");

  if (!prodId) {
    toast("Select a product to forecast", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading…";
  }

  const wrap = document.getElementById("forecast-chart-wrap");
  const meta = document.getElementById("forecast-meta");
  if (wrap)
    wrap.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
  if (meta) meta.textContent = "";

  try {
    const payload = { product_id: prodId, horizon_days: 14 };
    if (whId) payload.warehouse_id = whId;

    const forecasts = await Forecasts.generate(payload);
    const productName =
      allProducts.find((p) => String(p.id) === prodId)?.name || prodId;
    const whName = whId
      ? allWarehouses.find((w) => String(w.id) === whId)?.name || whId
      : "all warehouses";

    renderForecastChart(forecasts, { label: `${productName} — ${whName}` });
  } catch (err) {
    const wrap2 = document.getElementById("forecast-chart-wrap");
    if (wrap2)
      wrap2.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">Forecast failed</div><div class="empty-state__description">${escapeHtml(err.message)}</div></div>`;
    if (meta) meta.textContent = "";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Run";
    }
  }
}

function renderForecastChart(forecasts, target) {
  const wrap = document.getElementById("forecast-chart-wrap");
  const meta = document.getElementById("forecast-meta");
  if (!wrap || !meta) return;

  let canvas = document.getElementById("forecast-chart");
  if (!canvas) {
    wrap.innerHTML = '<canvas id="forecast-chart"></canvas>';
    canvas = document.getElementById("forecast-chart");
  }

  const rows = (Array.isArray(forecasts) ? forecasts : [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.forecast_date).getTime() -
        new Date(b.forecast_date).getTime(),
    )
    .slice(0, 14);

  if (forecastChart) {
    forecastChart.destroy();
    forecastChart = null;
  }

  if (rows.length === 0 || typeof Chart === "undefined") {
    wrap.innerHTML = `<div class="empty-state" style="padding:1.5rem"><div class="empty-state__title">No forecast data</div><div class="empty-state__description">Generate inventory demand forecast to view a 14-day projection.</div></div>`;
    meta.textContent =
      "Forecast endpoint did not return rows for the current sample.";
    return;
  }

  const labels = rows.map((row) => formatDate(row.forecast_date));
  const demand = rows.map((row) => Number(row.forecasted_quantity || 0));
  const lower = rows.map((row) =>
    row.confidence_lower == null ? null : Number(row.confidence_lower),
  );
  const upper = rows.map((row) =>
    row.confidence_upper == null ? null : Number(row.confidence_upper),
  );

  forecastChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Forecast",
          data: demand,
          borderColor: CHART_COLORS.primary,
          backgroundColor: "rgba(37, 99, 235, 0.15)",
          pointRadius: 2,
          tension: 0.25,
          fill: true,
        },
        {
          label: "Lower CI",
          data: lower,
          borderColor: CHART_COLORS.info,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.2,
        },
        {
          label: "Upper CI",
          data: upper,
          borderColor: CHART_COLORS.warning,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        legend: {
          display: true,
          position: "bottom",
          labels: {
            ...chartDefaults().plugins.legend?.labels,
            boxWidth: 10,
          },
        },
      },
    },
  });

  const total = demand.reduce((sum, val) => sum + val, 0);
  const targetText =
    target?.label ||
    (target?.product_id
      ? `Product ${String(target.product_id).slice(0, 8)} • WH ${String(target.warehouse_id || "all").slice(0, 8)}`
      : "");
  meta.innerHTML = `${targetText ? `<span>${escapeHtml(targetText)}</span>` : ""}<strong>${formatNumber(Math.round(total))} forecast units (14 days)</strong>`;
}

/* ── Recent Orders ── */
function renderRecentOrders(orders) {
  const container = document.getElementById("recent-orders");
  if (!container) return;

  const arr = Array.isArray(orders) ? orders : [];
  if (arr.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__title">No orders yet</div></div>`;
    return;
  }

  const rows = arr
    .slice(0, 8)
    .map(
      (o) => `
    <tr>
      <td><a href="orders.html" class="table__id">${escapeHtml(String(o.order_id || o.id))}</a></td>
      <td>${escapeHtml(o.customer_name || o.customer_id || "—")}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${priorityBadge(o.priority)}</td>
      <td class="text-muted">${timeAgo(o.created_at)}</td>
    </tr>`,
    )
    .join("");

  container.innerHTML = `
    <table class="table">
      <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ── Low Stock Alerts ── */
function renderAlerts(lowStock) {
  const container = document.getElementById("alerts-container");
  if (!container) return;

  const arr = Array.isArray(lowStock) ? lowStock : [];
  if (arr.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__icon"><i data-lucide="check-circle"></i></div><div class="empty-state__title">All stock healthy</div><div class="empty-state__description">No items below reorder point.</div></div>`;
    refreshIcons();
    return;
  }

  container.innerHTML = `<ul class="activity-feed">${arr
    .slice(0, 6)
    .map((item) => {
      const pct =
        item.reorder_point > 0
          ? Math.min(
              100,
              Math.round((item.quantity / item.reorder_point) * 100),
            )
          : 0;
      const cls = pct < 25 ? "danger" : pct < 50 ? "warning" : "info";
      return `
      <li class="activity-feed__item">
        <div class="activity-feed__dot activity-feed__dot--${cls}"></div>
        <div class="activity-feed__text">
          <strong>${escapeHtml(item.product_name || item.product_id || "Unknown")}</strong>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem">
            <div class="progress-bar" style="flex:1;height:4px">
              <div class="progress-bar__fill progress-bar__fill--${cls === "danger" ? "danger" : "warning"}" style="width:${pct}%"></div>
            </div>
            <span class="text-xs text-muted">${formatNumber(item.quantity)} / ${formatNumber(item.reorder_point)}</span>
          </div>
        </div>
      </li>`;
    })
    .join("")}</ul>`;
}

/* ── Sidebar badge ── */
function updateSidebarBadge(lowStock) {
  const badge = document.getElementById("low-stock-sidebar-badge");
  if (!badge) return;
  const count = Array.isArray(lowStock) ? lowStock.length : 0;
  badge.textContent = count > 0 ? count : "";
  badge.style.display = count > 0 ? "inline-flex" : "none";
}
