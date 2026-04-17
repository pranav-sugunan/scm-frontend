/**
 * orders.js — Orders Page Controller
 * Features: sortable table, multi-filter (status/priority/warehouse),
 * search, pagination, update status modal, allocate order.
 * Auto-polls every 10 seconds.
 */

import { Orders, Warehouses, Products } from "./api.js";
import {
  initShell,
  markSyncing,
  formatDate,
  formatDateTime,
  formatNumber,
  statusBadge,
  priorityBadge,
  showPageLoader,
  showError,
  showEmpty,
  escapeHtml,
  toast,
  sortBy,
  debounce,
  paginate,
  renderPagination,
  startPolling,
} from "./utils.js";

/* ============================================================
   STATE
   ============================================================ */
const state = {
  allOrders: [],
  filtered: [],
  warehouses: [],
  sortKey: "created_at",
  sortDir: "desc",
  page: 1,
  perPage: 20,
  filters: {
    search: "",
    status: "",
    priority: "",
    warehouse: "",
  },
};

/* ============================================================
   ORDER STATUSES (for update modal)
   ============================================================ */
const ORDER_STATUSES = [
  "created",
  "allocated",
  "picked",
  "packed",
  "shipped",
  "in_transit",
  "delivered",
  "cancelled",
  "returned",
];

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await initShell("orders", "Orders");
  await loadWarehousesForFilter();
  await loadOrders();

  bindFilterControls();
  bindSortControls();
  bindCreateOrderModal();

  // Polling
  startPolling(
    "orders",
    async () => {
      markSyncing();
      await loadOrders(true);
    },
    10000,
  );
});

/* ============================================================
   LOAD DATA
   ============================================================ */
async function loadWarehousesForFilter() {
  try {
    const data = await Warehouses.getAll();
    const list = Array.isArray(data) ? data : [];
    const sel = document.getElementById("filter-warehouse");
    if (sel) {
      list.forEach((wh) => {
        const opt = document.createElement("option");
        opt.value = wh.id;
        opt.textContent = wh.name || `WH ${wh.code}`;
        sel.appendChild(opt);
      });
    }
    // Also populate create order warehouse select
    const createSel = document.getElementById("create-order-warehouse");
    if (createSel) {
      list.forEach((wh) => {
        const opt = document.createElement("option");
        opt.value = wh.id;
        opt.textContent = wh.name || `WH ${wh.code}`;
        createSel.appendChild(opt);
      });
    }
    state.warehouses = list;
  } catch (_) {
    state.warehouses = [];
  }
}

async function loadOrders(silent = false) {
  if (!silent) showPageLoader("orders-table-container");

  try {
    const data = await Orders.getAll();
    state.allOrders = Array.isArray(data)
      ? data
      : (data?.items ?? data?.orders ?? []);
  } catch (err) {
    if (!silent) toast(`Failed to load orders: ${err.message}`, "error");
    state.allOrders = [];
  } finally {
    applyFilters();
  }
}

/* ============================================================
   FILTER & SORT
   ============================================================ */
function applyFilters() {
  const { search, status, priority, warehouse } = state.filters;
  const term = search.toLowerCase();

  state.filtered = state.allOrders.filter((order) => {
    const orderNum = (order.order_number ?? "").toLowerCase();
    const cust = (order.customer_name ?? "").toLowerCase();
    const custId = (order.customer_id ?? "").toLowerCase();
    const matchSearch =
      !term ||
      orderNum.includes(term) ||
      cust.includes(term) ||
      custId.includes(term);

    const matchStatus =
      !status || (order.status ?? "").toLowerCase() === status;
    const matchPriority =
      !priority || (order.priority ?? "").toLowerCase() === priority;
    const matchWarehouse =
      !warehouse || String(order.fulfillment_warehouse_id ?? "") === warehouse;

    return matchSearch && matchStatus && matchPriority && matchWarehouse;
  });

  // Sort
  state.filtered = sortBy(state.filtered, state.sortKey, state.sortDir);

  // Reset to page 1 on new filter
  state.page = 1;
  renderTable();
  updateFilterSummary();
}

// Warehouse filter is now populated from the Warehouses API at init

function updateFilterSummary() {
  const el = document.getElementById("orders-count");
  if (el)
    el.textContent = `${formatNumber(state.filtered.length)} of ${formatNumber(state.allOrders.length)} orders`;
}

/* ============================================================
   RENDER TABLE
   ============================================================ */
function renderTable() {
  const container = document.getElementById("orders-table-container");
  if (!container) return;

  if (state.filtered.length === 0) {
    showEmpty(
      "orders-table-container",
      "No orders found",
      "Try adjusting your filters or search terms.",
    );
    document.getElementById("orders-pagination-container").innerHTML = "";
    return;
  }

  const { items, ...pagination } = paginate(
    state.filtered,
    state.page,
    state.perPage,
  );

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="table" id="orders-table">
        <thead>
          <tr>
            <th class="sortable ${state.sortKey === "order_number" ? "sorted" : ""}" data-key="order_number">
              Order # <span class="table__sort-icon">${sortIcon("order_number")}</span>
            </th>
            <th class="sortable ${state.sortKey === "customer_name" ? "sorted" : ""}" data-key="customer_name">
              Customer <span class="table__sort-icon">${sortIcon("customer_name")}</span>
            </th>
            <th class="sortable ${state.sortKey === "status" ? "sorted" : ""}" data-key="status">
              Status <span class="table__sort-icon">${sortIcon("status")}</span>
            </th>
            <th class="sortable ${state.sortKey === "priority" ? "sorted" : ""}" data-key="priority">
              Priority <span class="table__sort-icon">${sortIcon("priority")}</span>
            </th>
            <th class="sortable ${state.sortKey === "total_amount" ? "sorted" : ""}" data-key="total_amount">
              Amount <span class="table__sort-icon">${sortIcon("total_amount")}</span>
            </th>
            <th>Channel</th>
            <th class="sortable ${state.sortKey === "created_at" ? "sorted" : ""}" data-key="created_at">
              Created <span class="table__sort-icon">${sortIcon("created_at")}</span>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((order) => orderRowHTML(order)).join("")}
        </tbody>
      </table>
    </div>`;

  // Bind sort headers
  container.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      state.filtered = sortBy(state.filtered, state.sortKey, state.sortDir);
      renderTable();
    });
  });

  // Bind action buttons
  container.querySelectorAll(".btn-update-status").forEach((btn) => {
    btn.addEventListener("click", () =>
      openStatusModal(btn.dataset.id, btn.dataset.status),
    );
  });

  container.querySelectorAll(".btn-allocate").forEach((btn) => {
    btn.addEventListener("click", () => allocateOrder(btn.dataset.id, btn));
  });

  container.querySelectorAll(".btn-view-order").forEach((btn) => {
    btn.addEventListener("click", () => viewOrderDetail(btn.dataset.id));
  });

  // Pagination
  renderPagination("orders-pagination-container", pagination, (newPage) => {
    state.page = newPage;
    renderTable();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function orderRowHTML(order) {
  const id = order.id ?? "—";
  const orderNum = order.order_number ?? "—";
  const customer = order.customer_name ?? "—";
  const status = order.status ?? "created";
  const priority = order.priority ?? "standard";
  const amount = order.total_amount ?? 0;
  const channel = order.source_channel ?? "—";
  const created = order.created_at;

  return `
    <tr>
      <td><span class="table__id">${escapeHtml(orderNum)}</span></td>
      <td>
        <div style="font-weight:500">${escapeHtml(customer)}</div>
        <div class="text-xs text-muted">${escapeHtml(order.customer_id ?? "")}</div>
      </td>
      <td>${statusBadge(status)}</td>
      <td>${priorityBadge(priority)}</td>
      <td>$${formatNumber(amount, 2)}</td>
      <td><span class="tag">${escapeHtml(channel)}</span></td>
      <td class="text-muted">${formatDate(created)}</td>
      <td>
        <div class="table__actions">
          <button class="btn btn--ghost btn--sm btn-view-order"
            data-id="${escapeHtml(String(id))}"
            title="View details">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          </button>
          <button class="btn btn--secondary btn--sm btn-update-status"
            data-id="${escapeHtml(String(id))}"
            data-status="${escapeHtml(status)}"
            title="Update status">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0
                112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Update
          </button>
          <button class="btn btn--primary btn--sm btn-allocate"
            data-id="${escapeHtml(String(id))}"
            title="Allocate order">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 13l4 4L19 7"/>
            </svg>
            Allocate
          </button>
        </div>
      </td>
    </tr>`;
}

function sortIcon(key) {
  if (state.sortKey !== key) return "↕";
  return state.sortDir === "asc" ? "↑" : "↓";
}

/* ============================================================
   BIND FILTER CONTROLS
   ============================================================ */
function bindFilterControls() {
  const search = document.getElementById("search-orders");
  const status = document.getElementById("filter-status");
  const priority = document.getElementById("filter-priority");
  const warehouse = document.getElementById("filter-warehouse");
  const clearBtn = document.getElementById("clear-filters");

  const onSearch = debounce((e) => {
    state.filters.search = e.target.value;
    applyFilters();
  }, 300);

  if (search) search.addEventListener("input", onSearch);
  if (status)
    status.addEventListener("change", (e) => {
      state.filters.status = e.target.value;
      applyFilters();
    });
  if (priority)
    priority.addEventListener("change", (e) => {
      state.filters.priority = e.target.value;
      applyFilters();
    });
  if (warehouse)
    warehouse.addEventListener("change", (e) => {
      state.filters.warehouse = e.target.value;
      applyFilters();
    });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.filters = { search: "", status: "", priority: "", warehouse: "" };
      if (search) search.value = "";
      if (status) status.value = "";
      if (priority) priority.value = "";
      if (warehouse) warehouse.value = "";
      applyFilters();
    });
  }
}

function bindSortControls() {
  // handled inside renderTable via event delegation
}

/* ============================================================
   STATUS UPDATE MODAL
   ============================================================ */
let _currentOrderId = null;

function openStatusModal(orderId, currentStatus) {
  _currentOrderId = orderId;

  const modal = document.getElementById("modal-backdrop");
  const currentEl = document.getElementById("modal-current-status");
  const select = document.getElementById("modal-new-status");
  const orderIdEl = document.getElementById("modal-order-id");

  if (orderIdEl) orderIdEl.textContent = `#${orderId}`;
  if (currentEl) currentEl.innerHTML = statusBadge(currentStatus);

  if (select) {
    select.innerHTML = ORDER_STATUSES.map(
      (s) =>
        `<option value="${s}" ${s === currentStatus ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}</option>`,
    ).join("");
  }

  modal?.classList.add("active");
}

function closeStatusModal() {
  const modal = document.getElementById("modal-backdrop");
  modal?.classList.remove("active");
  _currentOrderId = null;
}

// Bind modal buttons
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("modal-cancel")
    ?.addEventListener("click", closeStatusModal);
  document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeStatusModal();
  });

  document
    .getElementById("modal-confirm")
    ?.addEventListener("click", async () => {
      if (!_currentOrderId) return;
      const select = document.getElementById("modal-new-status");
      const newStatus = select?.value;
      if (!newStatus) return;

      const btn = document.getElementById("modal-confirm");
      btn.classList.add("loading");
      btn.innerHTML =
        '<div class="spinner spinner--sm spinner--white"></div> Saving…';

      try {
        await Orders.updateStatus(_currentOrderId, newStatus, null, null);

        // Update local state
        const order = state.allOrders.find(
          (o) => String(o.id) === String(_currentOrderId),
        );
        if (order) order.status = newStatus;

        toast(
          `Order #${_currentOrderId} status updated to "${newStatus}"`,
          "success",
        );
        closeStatusModal();
        applyFilters();
      } catch (err) {
        toast(`Failed to update status: ${err.message}`, "error");
      } finally {
        btn.classList.remove("loading");
        btn.innerHTML = "Save Changes";
      }
    });
});

/* ============================================================
   ALLOCATE ORDER
   ============================================================ */
async function allocateOrder(orderId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner--sm spinner--white"></div>';

  try {
    await Orders.autoAllocate(orderId);
    toast(`Order #${orderId} allocated successfully`, "success");

    // Update local state
    const order = state.allOrders.find((o) => String(o.id) === String(orderId));
    if (order) order.status = "picked";
    applyFilters();
  } catch (err) {
    toast(`Allocation failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg> Allocate`;
  }
}

/* ============================================================
   VIEW ORDER DETAIL
   ============================================================ */
async function viewOrderDetail(orderId) {
  const detailModal = document.getElementById("order-detail-modal");
  const detailContent = document.getElementById("order-detail-content");
  if (!detailModal || !detailContent) return;

  detailContent.innerHTML =
    '<div class="page-loading"><div class="spinner"></div><span>Loading order…</span></div>';
  detailModal.classList.add("active");

  try {
    const order = await Orders.getById(orderId);
    detailContent.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div class="stat-row"><span class="stat-row__label">Order #</span><span class="stat-row__value">${escapeHtml(order.order_number)}</span></div>
        <div class="stat-row"><span class="stat-row__label">Status</span><span class="stat-row__value">${statusBadge(order.status)}</span></div>
        <div class="stat-row"><span class="stat-row__label">Customer</span><span class="stat-row__value">${escapeHtml(order.customer_name ?? order.customer_id)}</span></div>
        <div class="stat-row"><span class="stat-row__label">Priority</span><span class="stat-row__value">${priorityBadge(order.priority)}</span></div>
        <div class="stat-row"><span class="stat-row__label">Total</span><span class="stat-row__value">$${formatNumber(order.total_amount, 2)}</span></div>
        <div class="stat-row"><span class="stat-row__label">Channel</span><span class="stat-row__value">${escapeHtml(order.source_channel ?? "—")}</span></div>
        <div class="stat-row"><span class="stat-row__label">Shipping</span><span class="stat-row__value">${escapeHtml([order.shipping_address, order.shipping_city, order.shipping_state].filter(Boolean).join(", ") || "—")}</span></div>
        <div class="stat-row"><span class="stat-row__label">Created</span><span class="stat-row__value">${formatDateTime(order.created_at)}</span></div>
      </div>
      ${
        order.items && order.items.length > 0
          ? `
        <div style="margin-top:1rem">
          <div style="font-weight:600;margin-bottom:.5rem">Order Items (${order.items.length})</div>
          <div class="table-wrapper">
            <table class="table">
              <thead><tr><th>Product ID</th><th>Qty</th><th>Unit Price</th><th>Total</th><th>Allocation</th></tr></thead>
              <tbody>
                ${order.items
                  .map(
                    (item) => `
                  <tr>
                    <td><span class="table__id">${escapeHtml(String(item.product_id).slice(0, 8))}…</span></td>
                    <td>${item.quantity}</td>
                    <td>$${formatNumber(item.unit_price, 2)}</td>
                    <td>$${formatNumber(item.total_price, 2)}</td>
                    <td>${statusBadge(item.allocation_status)}</td>
                  </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>`
          : ""
      }
      ${
        order.events && order.events.length > 0
          ? `
        <div style="margin-top:1rem">
          <div style="font-weight:600;margin-bottom:.5rem">Order Events</div>
          ${order.events
            .map(
              (ev) => `
            <div style="display:flex;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--clr-border)">
              <span class="text-muted text-xs">${formatDateTime(ev.created_at)}</span>
              <span>${escapeHtml(ev.event_type)}</span>
              ${ev.old_status ? `<span class="text-muted">${escapeHtml(ev.old_status)} → ${escapeHtml(ev.new_status)}</span>` : ""}
              ${ev.notes ? `<span class="text-muted text-sm">${escapeHtml(ev.notes)}</span>` : ""}
            </div>`,
            )
            .join("")}
        </div>`
          : ""
      }
    `;
  } catch (err) {
    detailContent.innerHTML = `<div class="alert alert--danger"><span>Failed to load order: ${escapeHtml(err.message)}</span></div>`;
  }
}

/* ============================================================
   CREATE ORDER MODAL
   ============================================================ */
let _createOrderItems = [];

function bindCreateOrderModal() {
  const openBtn = document.getElementById("create-order-btn");
  const modal = document.getElementById("create-order-modal");
  const cancelBtn = document.getElementById("create-order-cancel");
  const cancelFooter = document.getElementById("create-order-cancel-footer");
  const submitBtn = document.getElementById("create-order-submit");
  const addItemBtn = document.getElementById("add-order-item-btn");

  if (!openBtn || !modal) return;

  openBtn.addEventListener("click", () => {
    _createOrderItems = [{ product_id: "", quantity: 1, unit_price: 0 }];
    renderOrderItemRows();
    modal.classList.add("active");
  });

  const closeModal = () => modal.classList.remove("active");
  cancelBtn?.addEventListener("click", closeModal);
  cancelFooter?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  addItemBtn?.addEventListener("click", () => {
    _createOrderItems.push({ product_id: "", quantity: 1, unit_price: 0 });
    renderOrderItemRows();
  });

  submitBtn?.addEventListener("click", async () => {
    const customerId = document
      .getElementById("create-order-customer")
      ?.value?.trim();
    const customerName = document
      .getElementById("create-order-customer-name")
      ?.value?.trim();
    const priority = document.getElementById("create-order-priority")?.value;
    const channel = document
      .getElementById("create-order-channel")
      ?.value?.trim();
    const address = document
      .getElementById("create-order-address")
      ?.value?.trim();

    if (!customerId) {
      toast("Customer ID is required", "warning");
      return;
    }

    // Collect items from DOM
    const itemRows = document.querySelectorAll(".order-item-row");
    const items = [];
    for (const row of itemRows) {
      const pid = row.querySelector(".item-product-id")?.value?.trim();
      const qty = parseInt(row.querySelector(".item-quantity")?.value, 10);
      const price = parseFloat(row.querySelector(".item-price")?.value);
      if (!pid || !qty || isNaN(price)) {
        toast("All item fields are required", "warning");
        return;
      }
      items.push({ product_id: pid, quantity: qty, unit_price: price });
    }
    if (items.length === 0) {
      toast("Add at least one item", "warning");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML =
      '<div class="spinner spinner--sm spinner--white"></div> Creating…';

    try {
      const body = {
        customer_id: customerId,
        items,
        ...(customerName && { customer_name: customerName }),
        ...(priority && { priority }),
        ...(channel && { source_channel: channel }),
        ...(address && { shipping_address: address }),
      };
      await Orders.create(body);
      toast("Order created successfully", "success");
      closeModal();
      await loadOrders();
    } catch (err) {
      toast(`Failed to create order: ${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Create Order";
    }
  });
}

function renderOrderItemRows() {
  const container = document.getElementById("order-items-container");
  if (!container) return;
  container.innerHTML = _createOrderItems
    .map(
      (item, idx) => `
    <div class="order-item-row" style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem">
      <input type="text" class="form-input item-product-id" placeholder="Product UUID" value="${escapeHtml(item.product_id)}" style="flex:2">
      <input type="number" class="form-input item-quantity" placeholder="Qty" value="${item.quantity}" min="1" style="flex:1">
      <input type="number" class="form-input item-price" placeholder="Price" value="${item.unit_price}" min="0" step="0.01" style="flex:1">
      ${_createOrderItems.length > 1 ? `<button class="btn btn--ghost btn--sm remove-item-btn" data-idx="${idx}" title="Remove">✕</button>` : ""}
    </div>`,
    )
    .join("");

  container.querySelectorAll(".remove-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _createOrderItems.splice(parseInt(btn.dataset.idx, 10), 1);
      renderOrderItemRows();
    });
  });
}
