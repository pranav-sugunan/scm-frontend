/**
 * products.js — Products Controller
 * Catalog management with consistent metric-card KPIs, filtering, detail view.
 */
import { Products } from "./api.js";
import {
  initShell,
  formatNumber,
  formatCurrency,
  formatDate,
  formatDateTime,
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
let products = [];
let filtered = [];
let categories = [];
let page = 1;
const perPage = 25;
let sortKey = "name";
let sortDir = "asc";
let search = "";
let categoryFilter = "";
let abcFilter = "";

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("products");
  bindEvents();
  await loadAll();
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
  $("#filter-category").addEventListener("change", (e) => {
    categoryFilter = e.target.value;
    page = 1;
    applyFilters();
  });
  $("#filter-abc").addEventListener("change", (e) => {
    abcFilter = e.target.value;
    page = 1;
    applyFilters();
  });
  $("#btn-new-product").addEventListener("click", openCreateModal);

  $("#create-modal-close").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-cancel").addEventListener("click", () =>
    closeModal("create-modal"),
  );
  $("#create-modal-submit").addEventListener("click", submitCreate);
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
  showPageLoader("product-metrics");

  try {
    const [prodRes, catRes] = await Promise.allSettled([
      Products.getAll({ limit: 500 }),
      Products.getCategories(),
    ]);

    products = prodRes.status === "fulfilled" ? prodRes.value : [];
    categories = catRes.status === "fulfilled" ? catRes.value : [];

    renderMetrics();
    populateCategories();
    applyFilters();

    const subtitle = document.getElementById("products-subtitle");
    if (subtitle)
      subtitle.textContent = `${formatNumber(products.length)} products in ${categories.length} categories`;
  } catch (err) {
    showError("product-metrics", err.message);
  }
}

/* ── Metrics ── */
function renderMetrics() {
  const container = document.getElementById("product-metrics");
  if (!container) return;

  const avgCost =
    products.length > 0
      ? products.reduce((s, p) => s + (p.unit_cost || 0), 0) / products.length
      : 0;
  const avgPrice =
    products.length > 0
      ? products.reduce((s, p) => s + (p.unit_price || 0), 0) / products.length
      : 0;
  const classA = products.filter(
    (p) => (p.abc_class || "").toUpperCase() === "A",
  ).length;

  const metrics = [
    {
      label: "Total Products",
      value: formatNumber(products.length),
      icon: "package",
    },
    { label: "Avg Cost", value: formatCurrency(avgCost), icon: "indian-rupee" },
    { label: "Avg Price", value: formatCurrency(avgPrice), icon: "tag" },
    { label: "Class A Items", value: formatNumber(classA), icon: "star" },
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

/* ── Categories ── */
function populateCategories() {
  const filterSel = document.getElementById("filter-category");
  const createSel = document.getElementById("create-category");

  const normalized = categories
    .map((c) => {
      if (typeof c === "string") {
        return { id: c, name: c };
      }
      return {
        id: c?.id || c?.category_id || c?.name || "",
        name: c?.name || c?.category_name || c?.id || "Unknown",
      };
    })
    .filter((c) => c.id);

  const options = normalized
    .map(
      (c) =>
        `<option value="${escapeHtml(String(c.id))}">${escapeHtml(String(c.name))}</option>`,
    )
    .join("");

  if (filterSel) {
    filterSel.innerHTML = `<option value="">All categories</option>${options}`;
  }

  if (createSel) {
    createSel.innerHTML = `<option value="">Select category</option>${options}`;
  }
}

function getCategoryNameById(categoryId) {
  const id = String(categoryId || "");
  if (!id) return "—";
  const cat = categories.find(
    (c) => String(c?.id || c?.category_id || c?.name || "") === id,
  );
  return cat?.name || cat?.category_name || id;
}

/* ── Filters ── */
function applyFilters() {
  filtered = products.filter((p) => {
    const categoryName = getCategoryNameById(p.category_id);

    if (search) {
      const hay =
        `${p.name || ""} ${p.sku || ""} ${categoryName}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (categoryFilter && String(p.category_id || "") !== categoryFilter)
      return false;
    if (abcFilter && (p.abc_class || "").toUpperCase() !== abcFilter)
      return false;
    return true;
  });

  filtered = sortBy(filtered, sortKey, sortDir);
  renderTable();
}

/* ── Table ── */
function renderTable() {
  const container = document.getElementById("products-table-container");
  if (!container) return;

  const paging = paginate(filtered, page, perPage);
  const { items } = paging;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="empty-state__icon"><i data-lucide="package"></i></div><div class="empty-state__title">No products found</div><div class="empty-state__description">${products.length === 0 ? "Add your first product." : "Try adjusting your filters."}</div></div>`;
    document.getElementById("products-pagination").innerHTML = "";
    refreshIcons();
    return;
  }

  const sortIcon = (key) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>SKU</th>
          <th class="sortable" data-key="name">Name${sortIcon("name")}</th>
          <th>Category</th>
          <th class="sortable" data-key="unit_cost">Cost${sortIcon("unit_cost")}</th>
          <th class="sortable" data-key="unit_price">Price${sortIcon("unit_price")}</th>
          <th>Weight (kg)</th>
          <th>ABC</th>
          <th>Reorder Pt</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${items
        .map(
          (p) => `
        <tr>
          <td><span class="table__id">${escapeHtml(p.sku || "—")}</span></td>
          <td><strong>${escapeHtml(p.name || "—")}</strong></td>
          <td>${escapeHtml(getCategoryNameById(p.category_id))}</td>
          <td>${formatCurrency(p.unit_cost)}</td>
          <td>${formatCurrency(p.unit_price)}</td>
          <td class="text-muted">${p.weight_kg ? p.weight_kg + " kg" : "—"}</td>
          <td><span class="badge badge--${(p.abc_class || "").toUpperCase() === "A" ? "success" : (p.abc_class || "").toUpperCase() === "B" ? "warning" : "default"}">${escapeHtml((p.abc_class || "—").toUpperCase())}</span></td>
          <td class="text-muted">${formatNumber(p.reorder_point ?? 0)}</td>
          <td class="table__actions">
            <button class="btn btn--ghost btn--sm" title="View" data-action="view" data-id="${p.id}"><i data-lucide="eye" style="width:14px;height:14px"></i></button>
          </td>
        </tr>`,
        )
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
      applyFilters();
    });
  });

  container.querySelectorAll("[data-action='view']").forEach((btn) => {
    btn.addEventListener("click", () => loadDetail(btn.dataset.id));
  });

  renderPagination("products-pagination", paging, (p) => {
    page = p;
    renderTable();
  });
  refreshIcons();
}

/* ── Detail Modal ── */
async function loadDetail(id) {
  const modal = document.getElementById("detail-modal");
  const body = document.getElementById("detail-modal-body");
  const title = document.getElementById("detail-modal-title");
  body.innerHTML = `<div class="spinner" style="margin:2rem auto"></div>`;
  modal.style.display = "flex";

  try {
    const [productRes, similarRes] = await Promise.allSettled([
      Products.getById(id),
      Products.getSimilar(id, 4),
    ]);

    if (productRes.status !== "fulfilled") {
      throw new Error("Failed to load product details");
    }

    const p = productRes.value;
    const similar =
      similarRes.status === "fulfilled" && Array.isArray(similarRes.value)
        ? similarRes.value
        : [];

    title.textContent = p.name || `Product ${id}`;
    const margin =
      p.unit_price && p.unit_cost
        ? (((p.unit_price - p.unit_cost) / p.unit_price) * 100).toFixed(1)
        : null;

    body.innerHTML = `
      <div class="detail-grid">
        <div class="detail-grid__item"><span class="detail-grid__label">SKU</span><span class="detail-grid__value">${escapeHtml(p.sku || "—")}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Category</span><span class="detail-grid__value">${escapeHtml(getCategoryNameById(p.category_id))}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Unit Cost</span><span class="detail-grid__value">${formatCurrency(p.unit_cost)}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Unit Price</span><span class="detail-grid__value">${formatCurrency(p.unit_price)}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Weight</span><span class="detail-grid__value">${p.weight_kg ? p.weight_kg + " kg" : "—"}</span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">ABC Class</span><span class="detail-grid__value"><span class="badge badge--${(p.abc_class || "").toUpperCase() === "A" ? "success" : "default"}">${escapeHtml((p.abc_class || "—").toUpperCase())}</span></span></div>
        <div class="detail-grid__item"><span class="detail-grid__label">Reorder Point</span><span class="detail-grid__value">${formatNumber(p.reorder_point ?? 0)}</span></div>
        ${margin !== null ? `<div class="detail-grid__item"><span class="detail-grid__label">Margin</span><span class="detail-grid__value">${margin}%</span></div>` : ""}
        <div class="detail-grid__item"><span class="detail-grid__label">Created</span><span class="detail-grid__value">${formatDateTime(p.created_at)}</span></div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel__head">
          <h4 class="panel__title"><i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>AI Similar Products</h4>
        </div>
        <div class="panel__body ${similar.length === 0 ? "" : "panel__body--flush"}">
          ${
            similar.length === 0
              ? '<div class="text-sm text-muted">No similarity insights available for this product yet.</div>'
              : `<ul class="activity-feed">${similar
                  .map((sp) => {
                    const score =
                      typeof sp?.similarity_score === "number"
                        ? sp.similarity_score
                        : typeof sp?.score === "number"
                          ? sp.score
                          : null;
                    const scoreLabel =
                      score === null
                        ? ""
                        : score <= 1
                          ? `${(score * 100).toFixed(1)}% match`
                          : `${score.toFixed(1)} score`;
                    return `<li class="activity-feed__item"><div class="activity-feed__dot activity-feed__dot--info"></div><div class="activity-feed__text"><strong>${escapeHtml(sp?.name || sp?.product_name || String(sp?.product_id || sp?.id || "Unknown"))}</strong>${scoreLabel ? `<div class="text-xs text-muted">${escapeHtml(scoreLabel)}</div>` : ""}</div></li>`;
                  })
                  .join("")}</ul>`
          }
        </div>
      </div>`;
    refreshIcons();
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state__title">Failed to load</div><div class="empty-state__description">${escapeHtml(err.message)}</div></div>`;
  }
}

/* ── Create Modal ── */
function openCreateModal() {
  [
    "create-name",
    "create-sku",
    "create-category",
    "create-cost",
    "create-price",
    "create-weight",
    "create-reorder",
  ].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("create-category").value = "";
  document.getElementById("create-modal").style.display = "flex";
  refreshIcons();
}

async function submitCreate() {
  const name = document.getElementById("create-name").value.trim();
  const sku = document.getElementById("create-sku").value.trim();
  const categoryId = document.getElementById("create-category").value;
  const unitCost = parseFloat(document.getElementById("create-cost").value);
  const unitPrice = parseFloat(document.getElementById("create-price").value);
  const weightKg = parseFloat(document.getElementById("create-weight").value);
  const reorderPoint = parseInt(
    document.getElementById("create-reorder").value,
    10,
  );

  if (!name || !sku || !categoryId) {
    toast("Name, SKU and category are required", "error");
    return;
  }

  try {
    await Products.create({
      name,
      sku,
      category_id: categoryId,
      unit_cost: unitCost || 0,
      unit_price: unitPrice || 0,
      weight_kg: weightKg || 0,
      reorder_point: reorderPoint || 0,
    });
    toast("Product created", "success");
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
