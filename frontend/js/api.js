/**
 * api.js — Central API Layer
 * All HTTP communication with the FastAPI backend.
 * Base URL: http://localhost:8000/api/v1
 *
 * Pattern: async/await + error normalisation
 * Every function returns data or throws an ApiError.
 */

const BASE_URL = 'http://localhost:8000/api/v1';

/* ============================================================
   CUSTOM ERROR CLASS
   ============================================================ */
class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
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
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
    ...options,
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    // Handle non-2xx responses
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        detail = errBody.detail || errBody.message || detail;
      } catch (_) { /* ignore parse errors */ }
      throw new ApiError(`Request failed: ${detail}`, response.status, detail);
    }

    // 204 No Content
    if (response.status === 204) return null;

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') {
      throw new ApiError('Request timed out', 0, 'timeout');
    }
    // Network / CORS / parse errors
    throw new ApiError(
      `Network error: ${err.message}`,
      0,
      err.message
    );
  }
}

/* Convenience methods */
const get    = (endpoint, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  ).toString();
  return request(qs ? `${endpoint}?${qs}` : endpoint);
};
const post   = (endpoint, body)         => request(endpoint, { method: 'POST',  body: JSON.stringify(body) });
const patch  = (endpoint, body)         => request(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
const del    = (endpoint)               => request(endpoint, { method: 'DELETE' });

async function getFirstSuccessful(endpoints, params = {}) {
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      return await get(endpoint, params);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new ApiError('Request failed for all fallback endpoints', 0, 'fallback_failed');
}

/* ============================================================
   ANALYTICS / DASHBOARD
   ============================================================ */
export const Analytics = {
  getDashboard: ()               => get('/analytics/dashboard'),
  getAnomalies: ()               => get('/analytics/anomalies'),
  detectAnomalies: (body = {})   => post('/analytics/anomalies/detect', body),
  getForecast: (productId)       => get(`/forecasts/${productId}`),
};

/* ============================================================
   ORDERS
   ============================================================ */
export const Orders = {
  getAll: (params = {}) => getFirstSuccessful(['/orders/', '/orders'], params),
  getById: (id)         => get(`/orders/${id}`),
  updateStatus: (id, status) =>
    patch(`/orders/${id}/status`, { status }),
  allocate: (id)        => post(`/orders/${id}/auto-allocate`, {}),
};

/* ============================================================
   INVENTORY
   ============================================================ */
export const Inventory = {
  getStockLevels: async (params = {}) => {
    try {
      return await getFirstSuccessful(['/inventory/items', '/inventory/items/'], params);
    } catch (err) {
      // Older backend builds may not expose /inventory/items.
      if (err?.status !== 404) throw err;

      const warehouses = await getFirstSuccessful(['/warehouses/', '/warehouses']);
      const whList = Array.isArray(warehouses) ? warehouses : (warehouses?.items ?? []);

      if (!Array.isArray(whList) || whList.length === 0) return [];

      const stockByWarehouse = await Promise.allSettled(
        whList
          .map(w => w?.id ?? w?.warehouse_id)
          .filter(Boolean)
          .map(id => get(`/inventory/warehouse/${id}`))
      );

      return stockByWarehouse
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => (Array.isArray(r.value) ? r.value : []));
    }
  },
  getMovements: (params = {})   => get('/inventory/movements', params),
  getBelowReorder: ()           => get('/inventory/below-reorder'),
};

/* ============================================================
   WAREHOUSES
   ============================================================ */
export const Warehouses = {
  getAll: ()        => getFirstSuccessful(['/warehouses/', '/warehouses']),
  getById: (id)     => get(`/warehouses/${id}`),
  getZones: (id)    => get(`/warehouses/${id}/zones`),
};

/* ============================================================
   SHIPMENTS
   ============================================================ */
export const Shipments = {
  getAll: (params = {})         => getFirstSuccessful(['/shipments/', '/shipments'], params),
  track: (trackingNumber)       => get(`/shipments/track/${trackingNumber}`),
  updateStatus: (id, status)    => patch(`/shipments/${id}/status`, { status }),
  getCarriers: ()               => get('/shipments/carriers/list'),
};

/* ============================================================
   UTILITY — Fetch with loading state management
   ============================================================ */

/**
 * Wraps any API call with automatic loading/error UI.
 *
 * @param {Function} apiFn     — async function to call
 * @param {Object}   opts
 * @param {string}   opts.loadingEl  — selector for loading element to show/hide
 * @param {Function} opts.onSuccess  — callback(data)
 * @param {Function} opts.onError    — callback(error)  (optional)
 */
export async function withLoading(apiFn, { loadingEl, onSuccess, onError } = {}) {
  const loader = loadingEl ? document.querySelector(loadingEl) : null;
  if (loader) loader.classList.remove('hidden');

  try {
    const data = await apiFn();
    if (onSuccess) onSuccess(data);
    return data;
  } catch (err) {
    console.error('[API Error]', err);
    if (onError) {
      onError(err);
    }
    return null;
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

export { ApiError };
