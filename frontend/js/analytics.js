/**
 * analytics.js — Analytics & Forecasting Page Controller
 * Features: anomaly detection, alerts listing, demand forecast
 * charts by product, derived insights, auto-detect.
 */

import { Analytics } from './api.js';
import {
  initShell, markSyncing,
  formatDate, formatNumber, formatPercent,
  statusBadge,
  showPageLoader, showError, showEmpty,
  escapeHtml, toast,
  debounce, startPolling,
  CHART_COLORS, CHART_PALETTE, chartDefaults,
} from './utils.js';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  anomalies:   [],
  forecast:    null,
  productId:   '',
  detectRunning: false,
};

let forecastChart  = null;
let anomalyChart   = null;

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await initShell('analytics', 'Analytics');
  await loadAnalytics();

  bindControls();

  startPolling('analytics', async () => {
    markSyncing();
    await loadAnomalies(true);
  }, 10000);
});

/* ============================================================
   MAIN LOAD
   ============================================================ */
async function loadAnalytics(silent = false) {
  if (!silent) {
    showPageLoader('anomalies-container');
  }

  await loadAnomalies(silent);
  await loadDashboardInsights();
}

/* ============================================================
   ANOMALIES
   ============================================================ */
async function loadAnomalies(silent = false) {
  try {
    const data = await Analytics.getAnomalies();
    state.anomalies = Array.isArray(data)
      ? data
      : (data?.anomalies ?? data?.items ?? []);

    renderAnomalies();
    renderAnomalySummary();
    renderAnomalyChart();
  } catch (err) {
    if (!silent) showError('anomalies-container', `Failed to load anomalies: ${err.message}`);
  }
}

/* ============================================================
   RENDER ANOMALIES LIST
   ============================================================ */
function renderAnomalies() {
  const container = document.getElementById('anomalies-container');
  if (!container) return;

  // Update count badge
  const badge = document.getElementById('anomaly-count');
  if (badge) badge.textContent = state.anomalies.length;

  if (state.anomalies.length === 0) {
    container.innerHTML = `
      <div class="alert alert--success">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>No anomalies detected. All supply chain metrics are within normal ranges.</span>
      </div>`;
    return;
  }

  // Sort by severity: critical > warning > info
  const severityOrder = { critical: 0, high: 0, warning: 1, medium: 1, info: 2, low: 2 };
  const sorted = [...state.anomalies].sort((a, b) => {
    const sa = severityOrder[a.severity?.toLowerCase() ?? 'info'] ?? 2;
    const sb = severityOrder[b.severity?.toLowerCase() ?? 'info'] ?? 2;
    return sa - sb;
  });

  container.innerHTML = sorted.map(anomaly => anomalyCardHTML(anomaly)).join('');
}

function anomalyCardHTML(anomaly) {
  const severity  = (anomaly.severity ?? anomaly.level ?? 'info').toLowerCase();
  const type      = anomaly.type ?? anomaly.anomaly_type ?? 'Unknown Anomaly';
  const description = anomaly.description ?? anomaly.message ?? anomaly.detail ?? '—';
  const product   = anomaly.product_id ?? anomaly.product ?? anomaly.sku ?? '';
  const metric    = anomaly.metric ?? '';
  const value     = anomaly.value ?? anomaly.actual_value ?? '';
  const expected  = anomaly.expected_value ?? anomaly.threshold ?? '';
  const detectedAt= anomaly.detected_at ?? anomaly.created_at ?? anomaly.timestamp;

  const isCritical = severity === 'critical' || severity === 'high';
  const isWarning  = severity === 'warning'  || severity === 'medium';

  const borderColor = isCritical ? 'critical' : isWarning ? 'warning' : 'info';

  const iconMap = {
    critical: criticalIcon(),
    high:     criticalIcon(),
    warning:  warningIcon(),
    medium:   warningIcon(),
    info:     infoIcon(),
    low:      infoIcon(),
  };

  const bgMap = {
    critical: 'var(--clr-danger-light)',
    high:     'var(--clr-danger-light)',
    warning:  'var(--clr-warning-light)',
    medium:   'var(--clr-warning-light)',
    info:     'var(--clr-info-light)',
    low:      'var(--clr-info-light)',
  };

  const colorMap = {
    critical: 'var(--clr-danger)',
    high:     'var(--clr-danger)',
    warning:  'var(--clr-warning)',
    medium:   'var(--clr-warning)',
    info:     'var(--clr-info)',
    low:      'var(--clr-info)',
  };

  return `
    <div class="anomaly-card anomaly-card--${borderColor}">
      <div class="anomaly-card__icon"
        style="background:${bgMap[severity]};color:${colorMap[severity]}">
        ${iconMap[severity] ?? infoIcon()}
      </div>
      <div class="anomaly-card__content">
        <div class="anomaly-card__title">${escapeHtml(String(type).replace(/_/g, ' '))}</div>
        <div class="anomaly-card__description">${escapeHtml(description)}</div>
        <div class="anomaly-card__meta">
          ${product ? `<span>Product: <strong>${escapeHtml(product)}</strong></span>` : ''}
          ${metric  ? `<span>Metric: ${escapeHtml(metric)}</span>` : ''}
          ${value   ? `<span>Value: <strong>${escapeHtml(String(value))}</strong></span>` : ''}
          ${expected? `<span>Expected: ${escapeHtml(String(expected))}</span>` : ''}
          ${detectedAt ? `<span>${formatDate(detectedAt)}</span>` : ''}
        </div>
      </div>
      <div style="flex-shrink:0">
        <span class="badge badge--${isCritical ? 'critical' : isWarning ? 'warning' : 'info'} badge--dot">
          ${escapeHtml(severity)}
        </span>
      </div>
    </div>`;
}

/* ============================================================
   ANOMALY SUMMARY KPIs
   ============================================================ */
function renderAnomalySummary() {
  const bySeverity = (sev) => state.anomalies.filter(a =>
    (a.severity ?? a.level ?? '').toLowerCase() === sev
  ).length;

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setStat('stat-critical', bySeverity('critical') + bySeverity('high'));
  setStat('stat-warnings',  bySeverity('warning')  + bySeverity('medium'));
  setStat('stat-info-anom', bySeverity('info')      + bySeverity('low'));
  setStat('stat-total-anom', state.anomalies.length);
}

/* ============================================================
   ANOMALY SEVERITY CHART
   ============================================================ */
function renderAnomalyChart() {
  const canvas = document.getElementById('anomaly-severity-chart');
  if (!canvas) return;

  const critical = state.anomalies.filter(a => ['critical', 'high'].includes(a.severity?.toLowerCase())).length;
  const warning  = state.anomalies.filter(a => ['warning', 'medium'].includes(a.severity?.toLowerCase())).length;
  const info     = state.anomalies.filter(a => ['info', 'low'].includes(a.severity?.toLowerCase())).length;

  if (anomalyChart) anomalyChart.destroy();

  anomalyChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'Warning', 'Info'],
      datasets: [{
        data: [critical, warning, info],
        backgroundColor: [CHART_COLORS.danger, CHART_COLORS.warning, CHART_COLORS.info],
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: "'Inter', sans-serif", size: 12 }, padding: 12, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: '#0F172A',
          bodyFont: { family: "'Inter', sans-serif", size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
    },
  });
}

/* ============================================================
   DETECT ANOMALIES (POST)
   ============================================================ */
async function detectAnomalies() {
  if (state.detectRunning) return;
  state.detectRunning = true;

  const btn = document.getElementById('detect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner spinner--sm spinner--white"></div> Detecting…';
  }

  try {
    const result = await Analytics.detectAnomalies({});
    const count  = result?.count ?? result?.anomalies?.length ?? 0;

    toast(`Anomaly detection complete. Found ${count} anomaly${count !== 1 ? 's' : ''}.`,
      count > 0 ? 'warning' : 'success');

    await loadAnomalies(false);
  } catch (err) {
    toast(`Detection failed: ${err.message}`, 'error');
  } finally {
    state.detectRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        Run Detection`;
    }
  }
}

/* ============================================================
   DEMAND FORECASTING
   ============================================================ */
async function loadForecast(productId) {
  if (!productId) return;
  state.productId = productId;

  const container = document.getElementById('forecast-container');
  if (container) {
    container.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Loading forecast…</span></div>';
  }

  try {
    const data = await Analytics.getForecast(productId);
    state.forecast = data;
    renderForecast(data);
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="alert alert--danger">
          <span>No forecast available for product <strong>${escapeHtml(productId)}</strong>: ${escapeHtml(err.message)}</span>
        </div>`;
    }
  }
}

function renderForecast(data) {
  const container = document.getElementById('forecast-container');
  if (!container) return;

  const forecast = data?.forecast ?? data?.predictions ?? data ?? [];
  const productName = data?.product_name ?? data?.sku ?? state.productId;

  if (!Array.isArray(forecast) || forecast.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">No forecast data</div>
        <div class="empty-state__description">No predictions available for this product.</div>
      </div>`;
    return;
  }

  const labels   = forecast.map(f => formatDate(f.date ?? f.period ?? f.ds));
  const actuals  = forecast.map(f => f.actual ?? f.y ?? null).filter(v => v != null);
  const predicted= forecast.map(f => f.predicted ?? f.forecast ?? f.yhat ?? 0);
  const upper    = forecast.map(f => f.upper_bound ?? f.yhat_upper ?? null).filter(v => v != null);
  const lower    = forecast.map(f => f.lower_bound ?? f.yhat_lower ?? null).filter(v => v != null);

  container.innerHTML = `
    <div class="chart-card">
      <div class="chart-card__header">
        <div>
          <div class="chart-card__title">Demand Forecast — ${escapeHtml(productName)}</div>
          <div class="chart-card__subtitle">Predicted vs Actual demand over time</div>
        </div>
      </div>
      <div class="chart-card__body">
        <div class="chart-wrapper">
          <canvas id="forecast-chart"></canvas>
        </div>
      </div>
    </div>`;

  const canvas = document.getElementById('forecast-chart');
  if (!canvas) return;

  const datasets = [
    {
      label: 'Forecasted',
      data: predicted,
      borderColor: CHART_COLORS.primary,
      backgroundColor: 'rgba(37,99,235,0.08)',
      borderWidth: 2.5,
      pointRadius: 3,
      fill: true,
      tension: 0.4,
    },
  ];

  if (actuals.length > 0) {
    datasets.unshift({
      label: 'Actual',
      data: [...actuals, ...Array(labels.length - actuals.length).fill(null)],
      borderColor: CHART_COLORS.success,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 4,
      fill: false,
      tension: 0.3,
    });
  }

  if (upper.length > 0) {
    datasets.push({
      label: 'Upper Bound',
      data: upper,
      borderColor: 'rgba(37,99,235,0.2)',
      backgroundColor: 'rgba(37,99,235,0.04)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: '-1',
      tension: 0.4,
    });
  }

  if (forecastChart) forecastChart.destroy();
  forecastChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartDefaults(),
  });
}

/* ============================================================
   DASHBOARD INSIGHTS
   ============================================================ */
async function loadDashboardInsights() {
  try {
    const data = await Analytics.getDashboard();
    renderInsights(data);
  } catch (_) { /* silently skip */ }
}

function renderInsights(data) {
  if (!data) return;

  const insightsEl = document.getElementById('insights-container');
  if (!insightsEl) return;

  const orderKpis = data.order_kpis ?? {};
  const invKpis   = data.inventory_kpis ?? {};

  const totalOrders      = orderKpis.total_orders ?? data.total_orders ?? 0;
  const lowStock         = invKpis.items_below_reorder ?? data.low_stock_alerts ?? 0;

  const fulfillRate = ((orderKpis.fulfillment_rate ?? 0) * 100).toFixed(1);
  const onTimeRate  = orderKpis.on_time_delivery_rate ?? 1;
  const delayRate   = ((1 - onTimeRate) * 100).toFixed(1);

  insightsEl.innerHTML = `
    <div class="stat-row">
      <span class="stat-row__label">Fulfillment Rate</span>
      <span class="stat-row__value" style="color:${fulfillRate >= 90 ? 'var(--clr-success)' : 'var(--clr-warning)'}">
        ${formatPercent(fulfillRate)}
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-row__label">Shipment Delay Rate</span>
      <span class="stat-row__value" style="color:${delayRate > 10 ? 'var(--clr-danger)' : 'var(--clr-success)'}">
        ${formatPercent(delayRate)}
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-row__label">Low Stock Items</span>
      <span class="stat-row__value" style="color:${lowStock > 0 ? 'var(--clr-warning)' : 'var(--clr-success)'}">
        ${formatNumber(lowStock)}
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-row__label">Total Orders</span>
      <span class="stat-row__value">${formatNumber(totalOrders)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-row__label">Anomalies Detected</span>
      <span class="stat-row__value" style="color:${state.anomalies.length > 0 ? 'var(--clr-danger)' : 'var(--clr-success)'}">
        ${state.anomalies.length}
      </span>
    </div>`;
}

/* ============================================================
   BIND CONTROLS
   ============================================================ */
function bindControls() {
  // Detect anomalies button
  document.getElementById('detect-btn')?.addEventListener('click', detectAnomalies);

  // Forecast search
  const forecastInput = document.getElementById('forecast-product-input');
  const forecastBtn   = document.getElementById('forecast-search-btn');

  const doForecast = () => {
    const val = forecastInput?.value?.trim();
    if (!val) { toast('Enter a product ID or SKU', 'warning'); return; }
    loadForecast(val);
  };

  forecastBtn?.addEventListener('click', doForecast);
  forecastInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doForecast(); });

  // Severity filter
  const severityFilter = document.getElementById('filter-severity');
  if (severityFilter) {
    severityFilter.addEventListener('change', () => {
      const val = severityFilter.value.toLowerCase();
      const filtered = !val ? state.anomalies
        : state.anomalies.filter(a =>
            (a.severity ?? a.level ?? '').toLowerCase() === val
            || (val === 'critical' && (a.severity ?? '').toLowerCase() === 'high')
            || (val === 'warning'  && (a.severity ?? '').toLowerCase() === 'medium')
            || (val === 'info'     && (a.severity ?? '').toLowerCase() === 'low')
          );

      const container = document.getElementById('anomalies-container');
      if (!container) return;
      if (filtered.length === 0) {
        showEmpty('anomalies-container', `No ${val || ''} anomalies`, '');
      } else {
        container.innerHTML = filtered.map(anomaly => anomalyCardHTML(anomaly)).join('');
      }
    });
  }
}

/* ============================================================
   SVG ICONS
   ============================================================ */
function criticalIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
  </svg>`;
}

function warningIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`;
}

function infoIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`;
}
