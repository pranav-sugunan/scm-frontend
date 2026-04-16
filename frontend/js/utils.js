/**
 * utils.js — Shared Utility Functions
 * Component loader, formatters, badge generators, DOM helpers,
 * toast notifications, table helpers, polling.
 */

/* ============================================================
   COMPONENT LOADER
   Injects sidebar & navbar HTML fragments into the page.
   ============================================================ */

/**
 * Load an HTML component file and inject it into a container.
 * @param {string} containerId — id of the target element
 * @param {string} path        — relative path to component HTML
 */
export async function loadComponent(containerId, path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load component: ${path}`);
    const html = await res.text();
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  } catch (err) {
    console.warn('[Component Loader]', err.message);
  }
}

/**
 * Bootstraps the shell components (sidebar + navbar) on every page.
 * Call this once at top of each page script.
 *
 * @param {string} activePage — matches data-page attribute in sidebar
 * @param {string} pageTitle  — shown in navbar breadcrumb
 */
export async function initShell(activePage, pageTitle) {
  const depth = getPathDepth();

  await Promise.all([
    loadComponent('sidebar-container', `${depth}components/sidebar.html`),
    loadComponent('navbar-container',  `${depth}components/navbar.html`),
  ]);

  // Set active link in sidebar
  const links = document.querySelectorAll('.sidebar__link');
  links.forEach(link => {
    const page = link.dataset.page;
    if (page) {
      // Recompute href at runtime so navigation works whether pages are served
      // from /pages/* or from a different base path.
      link.setAttribute('href', `${depth}pages/${page}.html`);
    }

    if (link.dataset.page === activePage) {
      link.classList.add('active');
    }

    link.addEventListener('click', () => {
      // Prevent orphaned pollers from running while the browser is navigating.
      stopAllPolling();
    });
  });

  // Set page title in navbar
  const titleEl = document.getElementById('nav-page-title');
  if (titleEl && pageTitle) titleEl.textContent = pageTitle;

  // Wire up refresh indicator
  setupRefreshIndicator();
}

/** Returns '../' or '' depending on whether page is in /pages/ */
function getPathDepth() {
  const path = window.location.pathname;
  return path.includes('/pages/') ? '../' : '';
}

/* ============================================================
   REFRESH INDICATOR
   ============================================================ */
let _refreshTimer = null;

function setupRefreshIndicator() {
  const dot  = document.querySelector('.navbar__refresh-dot');
  const text = document.querySelector('.navbar__refresh-status span');
  if (!dot) return;

  updateLastSynced(dot, text);
}

function updateLastSynced(dot, text) {
  if (text) text.textContent = 'Live';
  if (dot) dot.classList.remove('syncing');
}

export function markSyncing() {
  const dot  = document.querySelector('.navbar__refresh-dot');
  const text = document.querySelector('.navbar__refresh-status span');
  if (dot) dot.classList.add('syncing');
  if (text) text.textContent = 'Syncing…';
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => updateLastSynced(dot, text), 2000);
}

/* ============================================================
   DATE / TIME FORMATTERS
   ============================================================ */

/**
 * Format an ISO date string to a human-readable date.
 * @param {string|null} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date(dateStr));
  } catch (_) { return dateStr; }
}

/**
 * Format ISO date string to date + time.
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateStr));
  } catch (_) { return dateStr; }
}

/**
 * Returns relative time (e.g. "2 hours ago").
 */
export function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ============================================================
   NUMBER FORMATTERS
   ============================================================ */
export function formatNumber(n, decimals = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCurrency(n, currency = 'INR') {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(n);
}

export function formatPercent(n, decimals = 1) {
  if (n == null) return '—';
  return `${Number(n).toFixed(decimals)}%`;
}

/* ============================================================
   BADGE / STATUS HELPERS
   ============================================================ */

const STATUS_MAP = {
  // Order statuses
  created:          'created',
  allocated:        'info',
  picked:           'picked',
  packed:           'packed',
  shipped:          'shipped',
  in_transit:       'warning',
  delivered:        'delivered',
  cancelled:        'cancelled',
  returned:         'returned',
  // Shipment statuses
  pending:          'pending',
  picked_up:        'info',
  out_for_delivery: 'warning',
  exception:        'critical',
  // Warehouse / Zone types
  active:           'active',
  inactive:         'inactive',
  maintenance:      'warning',
  receiving:        'info',
  storage:          'active',
  picking:          'warning',
  packing:          'info',
  shipping:         'success',
  cold:             'info',
  hazmat:           'critical',
  // Movement types
  inbound:          'success',
  outbound:         'warning',
  transfer:         'info',
  adjustment:       'pending',
  return:           'returned',
  cycle_count:      'info',
  // Generic
  critical:         'critical',
  warning:          'warning',
  info:             'info',
  success:          'success',
  low:              'low',
  medium:           'medium',
  high:             'high',
  urgent:           'urgent',
};

/**
 * Returns an HTML string for a status badge.
 * @param {string} status
 * @param {boolean} withDot
 */
export function statusBadge(status, withDot = true) {
  const key = (status || '').toLowerCase().trim().replace(/\s+/g, '_');
  const cls = STATUS_MAP[key] || 'info';
  const dot = withDot ? ' badge--dot' : '';
  const label = (status || '').replace(/_/g, ' ');
  return `<span class="badge badge--${cls}${dot}">${escapeHtml(label)}</span>`;
}

/**
 * Returns an HTML string for a priority badge.
 */
export function priorityBadge(priority) {
  const key = (priority || '').toLowerCase();
  return `<span class="badge badge--${key}">${escapeHtml(priority || '—')}</span>`;
}

/* ============================================================
   DOM HELPERS
   ============================================================ */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

export function createElement(tag, classes = '', html = '') {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (html)    el.innerHTML = html;
  return el;
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function setInnerHTML(selector, html, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.innerHTML = html;
}

export function show(selector, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.classList.remove('hidden');
}

export function hide(selector, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.classList.add('hidden');
}

export function toggle(selector, condition, parent = document) {
  condition ? show(selector, parent) : hide(selector, parent);
}

/* ============================================================
   LOADING STATE
   ============================================================ */
export function showPageLoader(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="page-loading">
      <div class="spinner spinner--lg"></div>
      <span>Loading data…</span>
    </div>`;
}

export function showError(containerId, message = 'Failed to load data. Check the backend is running.') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
      </div>
      <div class="empty-state__title">Something went wrong</div>
      <div class="empty-state__description">${escapeHtml(message)}</div>
    </div>`;
}

export function showEmpty(containerId, title = 'No data found', description = '') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
            01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      </div>
      <div class="empty-state__title">${escapeHtml(title)}</div>
      ${description ? `<div class="empty-state__description">${escapeHtml(description)}</div>` : ''}
    </div>`;
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById('toast-container');
    if (!_toastContainer) {
      _toastContainer = document.createElement('div');
      _toastContainer.id = 'toast-container';
      _toastContainer.className = 'toast-container';
      document.body.appendChild(_toastContainer);
    }
  }
  return _toastContainer;
}

const TOAST_ICONS = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
  warning: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
};

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'warning'|'error'|'info'} type
 * @param {number} duration — ms (0 = no auto-dismiss)
 */
export function toast(message, type = 'info', duration = 4000) {
  const container = getToastContainer();

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast__icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <div class="toast__body">
      <div class="toast__message">${escapeHtml(message)}</div>
    </div>
    <button class="toast__close" aria-label="Dismiss">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>`;

  const dismiss = () => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  el.querySelector('.toast__close').addEventListener('click', dismiss);
  container.appendChild(el);

  if (duration > 0) setTimeout(dismiss, duration);
}

/* ============================================================
   SORTING HELPER
   ============================================================ */

/**
 * Sorts an array of objects by a given key.
 * @param {Array}  arr
 * @param {string} key
 * @param {'asc'|'desc'} direction
 */
export function sortBy(arr, key, direction = 'asc') {
  return [...arr].sort((a, b) => {
    let va = a[key] ?? '';
    let vb = b[key] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return direction === 'asc' ? -1 : 1;
    if (va > vb) return direction === 'asc' ?  1 : -1;
    return 0;
  });
}

/* ============================================================
   DEBOUNCE
   ============================================================ */
export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ============================================================
   POLLING UTILITY
   Sets up auto-refresh of data at a given interval.
   ============================================================ */
const _pollers = new Map();

/**
 * Start polling a function at a given interval.
 * @param {string}   key      — unique name for this poller
 * @param {Function} fn       — async function to call
 * @param {number}   interval — ms (default 10 000)
 */
export function startPolling(key, fn, interval = 10000) {
  stopPolling(key);
  // Initial call
  fn();
  const id = setInterval(fn, interval);
  _pollers.set(key, id);
  return id;
}

export function stopPolling(key) {
  if (_pollers.has(key)) {
    clearInterval(_pollers.get(key));
    _pollers.delete(key);
  }
}

export function stopAllPolling() {
  _pollers.forEach((id) => clearInterval(id));
  _pollers.clear();
}

/* ============================================================
   PAGINATION HELPER
   ============================================================ */

/**
 * Returns a slice of data for the given page.
 */
export function paginate(data, page, perPage = 20) {
  const total = data.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const items = data.slice(start, start + perPage);
  return { items, total, totalPages, page, perPage };
}

/**
 * Render pagination controls into a container.
 * @param {string}   containerId
 * @param {Object}   pagination  — { page, totalPages, total, perPage }
 * @param {Function} onPageChange — callback(newPage)
 */
export function renderPagination(containerId, { page, totalPages, total, perPage }, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }

  const start = (page - 1) * perPage + 1;
  const end   = Math.min(page * perPage, total);

  const pages = getPageNumbers(page, totalPages);

  el.innerHTML = `
    <div class="pagination">
      <span class="pagination__info">Showing ${start}–${end} of ${formatNumber(total)}</span>
      <div class="pagination__controls">
        <button class="pagination__btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&#8249;</button>
        ${pages.map(p => p === '…'
          ? `<span class="pagination__btn" style="cursor:default">…</span>`
          : `<button class="pagination__btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`
        ).join('')}
        <button class="pagination__btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>&#8250;</button>
      </div>
    </div>`;

  el.querySelectorAll('.pagination__btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= totalPages) onPageChange(p);
    });
  });
}

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('…', total);
  } else if (current >= total - 3) {
    pages.push(1, '…');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1, '…', current - 1, current, current + 1, '…', total);
  }
  return pages;
}

/* ============================================================
   CHART.JS DEFAULT THEME
   ============================================================ */
export const CHART_COLORS = {
  primary:  '#2563EB',
  success:  '#10B981',
  warning:  '#F59E0B',
  danger:   '#EF4444',
  purple:   '#8B5CF6',
  info:     '#06B6D4',
  orange:   '#F97316',
  gray:     '#94A3B8',
};

export const CHART_PALETTE = [
  '#2563EB', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#06B6D4', '#F97316', '#EC4899',
];

/**
 * Returns shared Chart.js default options for a clean, branded look.
 */
export function chartDefaults(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { family: "'Inter', sans-serif", size: 12 },
          padding: 16,
          usePointStyle: true,
          pointStyleWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: '#0F172A',
        titleFont: { family: "'Inter', sans-serif", size: 12, weight: '600' },
        bodyFont:  { family: "'Inter', sans-serif", size: 12 },
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 4,
      },
    },
    scales: {
      x: {
        grid: { color: '#F1F5F9', drawBorder: false },
        ticks: { font: { family: "'Inter', sans-serif", size: 11 }, color: '#94A3B8' },
      },
      y: {
        grid: { color: '#F1F5F9', drawBorder: false },
        ticks: { font: { family: "'Inter', sans-serif", size: 11 }, color: '#94A3B8' },
      },
    },
    ...extra,
  };
}
