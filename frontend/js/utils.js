/**
 * utils.js — Shared Utility Functions
 */

/* ── Component Loader ── */
export async function loadComponent(containerId, path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load component: ${path}`);
    const html = await res.text();
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  } catch (err) {
    console.warn("[Component Loader]", err.message);
  }
}

export async function initShell(activePage) {
  const depth = getPathDepth();
  await loadComponent("sidebar-container", `${depth}components/sidebar.html`);
  const links = document.querySelectorAll(".sidebar__link");
  links.forEach((link) => {
    const page = link.dataset.page;
    if (page) link.setAttribute("href", `${depth}pages/${page}.html`);
    if (link.dataset.page === activePage) link.classList.add("active");
    link.addEventListener("click", () => stopAllPolling());
  });
  refreshIcons();
}

export function refreshIcons() {
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function getPathDepth() {
  return window.location.pathname.includes("/pages/") ? "../" : "";
}

/* ── Syncing Indicator ── */
let _syncTimer = null;
export function markSyncing() {
  const dot = document.querySelector(".sidebar__live-dot");
  const text = document.querySelector(".sidebar__live-text");
  if (dot) dot.style.background = "var(--clr-warning)";
  if (text) text.textContent = "Syncing…";
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    if (dot) dot.style.background = "";
    if (text) text.textContent = "Live · Auto-refresh 10s";
  }, 2000);
}

/* ── Date/Time Formatters ── */
export function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(dateStr));
  } catch (_) { return dateStr; }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(dateStr));
  } catch (_) { return dateStr; }
}

export function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Number Formatters ── */
export function formatNumber(n, decimals = 0) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCurrency(n, currency = "INR") {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export function formatPercent(n, decimals = 1) {
  if (n == null) return "—";
  return `${Number(n).toFixed(decimals)}%`;
}

/* ── Badge Helpers ── */
const STATUS_MAP = {
  created:"created", allocated:"info", picked:"picked", packed:"packed",
  shipped:"shipped", in_transit:"warning", delivered:"delivered",
  cancelled:"cancelled", returned:"returned",
  pending:"pending", picked_up:"info", out_for_delivery:"warning", exception:"critical",
  active:"active", inactive:"inactive", maintenance:"warning",
  receiving:"info", storage:"active", picking:"warning", packing:"info", shipping:"success",
  cold:"info", hazmat:"critical",
  inbound:"success", outbound:"warning", transfer:"info", adjustment:"pending",
  return:"returned", cycle_count:"info",
  critical:"critical", warning:"warning", info:"info", success:"success",
  low:"low", medium:"medium", high:"high", urgent:"urgent",
};

export function statusBadge(status, withDot = true) {
  const key = (status || "").toLowerCase().trim().replace(/\s+/g, "_");
  const cls = STATUS_MAP[key] || "info";
  const dot = withDot ? " badge--dot" : "";
  const label = (status || "").replace(/_/g, " ");
  return `<span class="badge badge--${cls}${dot}">${escapeHtml(label)}</span>`;
}

export function priorityBadge(priority) {
  const key = (priority || "").toLowerCase();
  return `<span class="badge badge--${key}">${escapeHtml(priority || "—")}</span>`;
}

/* ── DOM Helpers ── */
export const $ = (sel, p = document) => p.querySelector(sel);
export const $$ = (sel, p = document) => Array.from(p.querySelectorAll(sel));

export function createElement(tag, classes = "", html = "") {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (html) el.innerHTML = html;
  return el;
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

export function setInnerHTML(selector, html, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.innerHTML = html;
}

export function show(selector, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.classList.remove("hidden");
}

export function hide(selector, parent = document) {
  const el = parent.querySelector(selector);
  if (el) el.classList.add("hidden");
}

export function toggle(selector, condition, parent = document) {
  condition ? show(selector, parent) : hide(selector, parent);
}

/* ── Loading States ── */
export function showPageLoader(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="page-loading"><div class="spinner spinner--lg"></div><span>Loading…</span></div>`;
}

export function showError(containerId, message = "Failed to load data.") {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="empty-state"><div class="empty-state__icon"><i data-lucide="alert-triangle"></i></div><div class="empty-state__title">Something went wrong</div><div class="empty-state__description">${escapeHtml(message)}</div></div>`;
  refreshIcons();
}

export function showEmpty(containerId, title = "No data found", description = "") {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="empty-state"><div class="empty-state__icon"><i data-lucide="inbox"></i></div><div class="empty-state__title">${escapeHtml(title)}</div>${description ? `<div class="empty-state__description">${escapeHtml(description)}</div>` : ""}</div>`;
  refreshIcons();
}

/* ── Toast ── */
let _toastContainer = null;
function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById("toast-container");
    if (!_toastContainer) {
      _toastContainer = document.createElement("div");
      _toastContainer.id = "toast-container";
      _toastContainer.className = "toast-container";
      document.body.appendChild(_toastContainer);
    }
  }
  return _toastContainer;
}

const TOAST_ICONS = { success:`<i data-lucide="check-circle"></i>`, warning:`<i data-lucide="alert-triangle"></i>`, error:`<i data-lucide="x-circle"></i>`, info:`<i data-lucide="info"></i>` };

export function toast(message, type = "info", duration = 4000) {
  const container = getToastContainer();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span class="toast__icon">${TOAST_ICONS[type]||TOAST_ICONS.info}</span><div class="toast__body"><div class="toast__message">${escapeHtml(message)}</div></div><button class="toast__close" aria-label="Dismiss"><i data-lucide="x"></i></button>`;
  const dismiss = () => { el.classList.add("removing"); el.addEventListener("animationend", () => el.remove(), { once: true }); };
  el.querySelector(".toast__close").addEventListener("click", dismiss);
  container.appendChild(el);
  refreshIcons();
  if (duration > 0) setTimeout(dismiss, duration);
}

/* ── Sorting / Debounce ── */
export function sortBy(arr, key, direction = "asc") {
  return [...arr].sort((a, b) => {
    let va = a[key] ?? "", vb = b[key] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return direction === "asc" ? -1 : 1;
    if (va > vb) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

/* ── Polling ── */
const _pollers = new Map();
export function startPolling(key, fn, interval = 10000) {
  stopPolling(key);
  fn();
  const id = setInterval(fn, interval);
  _pollers.set(key, id);
  return id;
}
export function stopPolling(key) { if (_pollers.has(key)) { clearInterval(_pollers.get(key)); _pollers.delete(key); } }
export function stopAllPolling() { _pollers.forEach((id) => clearInterval(id)); _pollers.clear(); }

/* ── Pagination ── */
export function paginate(data, page, perPage = 20) {
  const total = data.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const items = data.slice(start, start + perPage);
  return { items, total, totalPages, page, perPage };
}

export function renderPagination(containerId, { page, totalPages, total, perPage }, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ""; return; }
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const pages = getPageNumbers(page, totalPages);
  el.innerHTML = `<div class="pagination"><span class="pagination__info">${start}–${end} of ${formatNumber(total)}</span><div class="pagination__controls"><button class="pagination__btn" data-page="${page-1}" ${page<=1?"disabled":""}>‹</button>${pages.map((p) => p==="…" ? `<span class="pagination__ellipsis">…</span>` : `<button class="pagination__btn ${p===page?"active":""}" data-page="${p}">${p}</button>`).join("")}<button class="pagination__btn" data-page="${page+1}" ${page>=totalPages?"disabled":""}>›</button></div></div>`;
  el.querySelectorAll(".pagination__btn[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => { const p = parseInt(btn.dataset.page,10); if(p>=1&&p<=totalPages) onPageChange(p); });
  });
}

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) { const p = []; for(let i=1;i<=5;i++) p.push(i); p.push("…",total); return p; }
  if (current >= total - 3) { const p = [1,"…"]; for(let i=total-4;i<=total;i++) p.push(i); return p; }
  return [1, "…", current-1, current, current+1, "…", total];
}

/* ── Chart.js ── */
export const CHART_COLORS = { primary:"#2563EB", success:"#10B981", warning:"#F59E0B", danger:"#EF4444", purple:"#8B5CF6", info:"#06B6D4", orange:"#F97316", gray:"#94A3B8" };
export const CHART_PALETTE = ["#2563EB","#10B981","#F59E0B","#EF4444","#8B5CF6","#06B6D4","#F97316","#EC4899"];

export function chartDefaults(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { font: { family: "'Inter', sans-serif", size: 12 }, padding: 16, usePointStyle: true, pointStyleWidth: 8 } },
      tooltip: { backgroundColor: "#0F172A", titleFont: { family:"'Inter',sans-serif", size:12, weight:"600" }, bodyFont: { family:"'Inter',sans-serif", size:12 }, padding:10, cornerRadius:8, displayColors:true, boxWidth:8, boxHeight:8, boxPadding:4 },
    },
    scales: {
      x: { grid: { color:"#F1F5F9", drawBorder:false }, ticks: { font: { family:"'Inter',sans-serif", size:11 }, color:"#94A3B8" } },
      y: { grid: { color:"#F1F5F9", drawBorder:false }, ticks: { font: { family:"'Inter',sans-serif", size:11 }, color:"#94A3B8" } },
    },
    ...extra,
  };
}
