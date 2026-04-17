/**
 * api.js — Central API Layer
 * All HTTP communication with the FastAPI backend.
 * Base URL: http://localhost:8000/api/v1
 *
 * Covers ALL backend endpoints: Warehouses, Products, Inventory,
 * Orders, Shipments, Forecasts, Analytics.
 */

const BASE_URL = "http://localhost:8000/api/v1";

/* ============================================================
   CUSTOM ERROR CLASS
   ============================================================ */
class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/* ============================================================
   CORE FETCH WRAPPER
   ============================================================ */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const config = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
    ...options,
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        const d = errBody.detail ?? errBody.message ?? detail;
        detail =
          typeof d === "string"
            ? d
            : Array.isArray(d)
              ? d.map((e) => e.msg || JSON.stringify(e)).join("; ")
              : JSON.stringify(d);
      } catch (_) {}
      throw new ApiError(`Request failed: ${detail}`, response.status, detail);
    }

    if (response.status === 204) return null;
    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) throw err;
    if (err.name === "AbortError") {
      throw new ApiError("Request timed out", 0, "timeout");
    }
    throw new ApiError(`Network error: ${err.message}`, 0, err.message);
  }
}

/* ============================================================
   CONVENIENCE METHODS (support query params on all verbs)
   ============================================================ */
function buildQS(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined,
    ),
  ).toString();
  return qs ? `?${qs}` : "";
}

const get = (endpoint, params = {}) => request(`${endpoint}${buildQS(params)}`);

const post = (endpoint, body = null, params = {}) => {
  const opts = { method: "POST" };
  if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
  return request(`${endpoint}${buildQS(params)}`, opts);
};

const patch = (endpoint, body = null, params = {}) => {
  const opts = { method: "PATCH" };
  if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
  return request(`${endpoint}${buildQS(params)}`, opts);
};

const del = (endpoint) => request(endpoint, { method: "DELETE" });

/* ============================================================
   WAREHOUSES
   POST   /warehouses/                     — Create Warehouse
   GET    /warehouses/                     — List Warehouses
   GET    /warehouses/{id}                 — Get Warehouse
   PATCH  /warehouses/{id}                 — Update Warehouse
   DELETE /warehouses/{id}                 — Delete Warehouse
   POST   /warehouses/zones                — Create Zone
   GET    /warehouses/{id}/zones           — List Zones
   POST   /warehouses/bins                 — Create Bin
   GET    /warehouses/zones/{zone_id}/bins — List Bins
   ============================================================ */
export const Warehouses = {
  create: (body) => post("/warehouses/", body),
  getAll: (params = {}) => get("/warehouses/", params),
  getById: (id) => get(`/warehouses/${id}`),
  update: (id, body) => patch(`/warehouses/${id}`, body),
  delete: (id) => del(`/warehouses/${id}`),
  createZone: (body) => post("/warehouses/zones", body),
  getZones: (id) => get(`/warehouses/${id}/zones`),
  createBin: (body) => post("/warehouses/bins", body),
  getBins: (zoneId) => get(`/warehouses/zones/${zoneId}/bins`),
};

/* ============================================================
   PRODUCTS
   POST /products/                  — Create Product
   GET  /products/                  — List Products
   GET  /products/{id}              — Get Product
   PATCH /products/{id}             — Update Product
   GET  /products/{id}/similar      — Get Similar Products
   POST /products/categories        — Create Category
   GET  /products/categories/list   — List Categories
   ============================================================ */
export const Products = {
  create: (body) => post("/products/", body),
  getAll: (params = {}) => get("/products/", params),
  getById: (id) => get(`/products/${id}`),
  update: (id, body) => patch(`/products/${id}`, body),
  getSimilar: (id, topK = 5) => get(`/products/${id}/similar`, { top_k: topK }),
  createCategory: (body) => post("/products/categories", body),
  getCategories: () => get("/products/categories/list"),
};

/* ============================================================
   INVENTORY
   GET  /inventory/items                    — List All Stock
   GET  /inventory/stock-level              — Get Stock Level
   GET  /inventory/warehouse/{warehouse_id} — List Inventory
   POST /inventory/receive                  — Receive Stock
   POST /inventory/transfer                 — Transfer Stock
   POST /inventory/adjust                   — Adjust Stock
   GET  /inventory/below-reorder            — Items Below Reorder
   GET  /inventory/movements                — List Movements
   ============================================================ */
export const Inventory = {
  getAllStock: (params = {}) => get("/inventory/items", params),
  getStockLevel: (productId, warehouseId) =>
    get("/inventory/stock-level", {
      product_id: productId,
      warehouse_id: warehouseId,
    }),
  getByWarehouse: (warehouseId, params = {}) =>
    get(`/inventory/warehouse/${warehouseId}`, params),
  receiveStock: (body) => post("/inventory/receive", body),
  transferStock: (body) => post("/inventory/transfer", body),
  adjustStock: (body) => post("/inventory/adjust", body),
  getBelowReorder: () => get("/inventory/below-reorder"),
  getMovements: (params = {}) => get("/inventory/movements", params),
};

/* ============================================================
   ORDERS
   POST  /orders/                     — Create Order
   GET   /orders/                     — List Orders
   GET   /orders/{id}                 — Get Order
   PATCH /orders/{id}/status          — Update Order Status
   POST  /orders/{id}/allocate        — Allocate Order
   POST  /orders/{id}/auto-allocate   — Auto Allocate Order
   ============================================================ */
export const Orders = {
  create: (body) => post("/orders/", body),
  getAll: (params = {}) => get("/orders/", params),
  getById: (id) => get(`/orders/${id}`),
  updateStatus: (id, status, notes, performedBy) =>
    patch(`/orders/${id}/status`, {
      status,
      ...(notes && { notes }),
      ...(performedBy && { performed_by: performedBy }),
    }),
  allocate: (id, warehouseId) =>
    post(`/orders/${id}/allocate`, null, { warehouse_id: warehouseId }),
  autoAllocate: (id) => post(`/orders/${id}/auto-allocate`),
};

/* ============================================================
   SHIPMENTS
   POST  /shipments/                         — Create Shipment
   GET   /shipments/                         — List Shipments
   GET   /shipments/track/{tracking_number}  — Track Shipment
   GET   /shipments/{id}                     — Get Shipment
   PATCH /shipments/{id}/status              — Update Shipment Status
   POST  /shipments/carriers                 — Create Carrier
   GET   /shipments/carriers/list            — List Carriers
   ============================================================ */
export const Shipments = {
  create: (body) => post("/shipments/", body),
  getAll: (params = {}) => get("/shipments/", params),
  track: (trackingNumber) =>
    get(`/shipments/track/${encodeURIComponent(trackingNumber)}`),
  getById: (id) => get(`/shipments/${id}`),
  updateStatus: (id, body) => patch(`/shipments/${id}/status`, body),
  createCarrier: (body) => post("/shipments/carriers", body),
  getCarriers: () => get("/shipments/carriers/list"),
};

/* ============================================================
   FORECASTS
   POST /forecasts/generate       — Generate Forecast
   GET  /forecasts/{product_id}   — Get Forecasts
   ============================================================ */
export const Forecasts = {
  generate: (body) => post("/forecasts/generate", body),
  getByProduct: (productId, params = {}) =>
    get(`/forecasts/${productId}`, params),
};

/* ============================================================
   ANALYTICS
   GET   /analytics/dashboard                      — Get Dashboard
   GET   /analytics/warehouse/{warehouse_id}       — Get Warehouse Analytics
   POST  /analytics/anomalies/detect               — Detect Anomalies
   GET   /analytics/anomalies                      — List Anomalies
   PATCH /analytics/anomalies/{alert_id}/resolve   — Resolve Anomaly
   POST  /analytics/simulation/run                 — Run Simulation
   ============================================================ */
export const Analytics = {
  getDashboard: () => get("/analytics/dashboard"),
  getWarehouseAnalytics: (warehouseId) =>
    get(`/analytics/warehouse/${warehouseId}`),
  detectAnomalies: (windowDays = 7) =>
    post("/analytics/anomalies/detect", null, { window_days: windowDays }),
  getAnomalies: (params = {}) => get("/analytics/anomalies", params),
  resolveAnomaly: (alertId, resolvedBy = "admin") =>
    patch(`/analytics/anomalies/${alertId}/resolve`, null, {
      resolved_by: resolvedBy,
    }),
  runSimulation: (body) => post("/analytics/simulation/run", body),
};

/* ============================================================
   PAGINATED FETCH — fetch all records across pages
   ============================================================ */
/**
 * Fetch all records from a paginated list endpoint.
 * Automatically pages through using offset/limit.
 * @param {Function} apiFn — function(params) that returns a list
 * @param {Object}   baseParams — extra query params
 * @param {number}   pageSize — items per request (max 500)
 * @returns {Promise<Array>}
 */
export async function fetchAll(apiFn, baseParams = {}, pageSize = 500) {
  let all = [];
  let offset = 0;
  while (true) {
    const batch = await apiFn({ ...baseParams, limit: pageSize, offset });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export { ApiError };
