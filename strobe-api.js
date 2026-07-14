// strobe-api.js
export const THREAT_SECONDS = { high: 240, medium: 360, low: 480, one: 0 };
/** Toolbar icon / queue count flash when any unfilled order sits this long */
export const LONG_WAIT_SECONDS = 900; // 15 minutes
export const DEFAULT_BASE = "https://strobe.gg";

/** True when Hub status still means “needs a taker” (alert on these, not PENDING). */
export function isWaitingQueueStatus(status) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (!s) return true;
  if (s === "PENDING" || s === "PAUSED" || s === "COMPLETE" || s === "COMPLETED") {
    return false;
  }
  // UNFILLED / NEW / OPEN / anything else still in the pull → treat as waiting
  return true;
}

/** Strip accidental "Bearer " / normalize Hub keys (often need strb_ prefix). */
export function normalizeApiKey(key) {
  let k = String(key || "").trim();
  if (/^bearer\s+/i.test(k)) k = k.replace(/^bearer\s+/i, "").trim();
  // Pasted hex without strb_ prefix → Hub returns {"status":500}
  if (/^[a-f0-9]{40}$/i.test(k)) k = `strb_${k}`;
  return k;
}

export function normalizePulledOrders(apiJson) {
  const orders = apiJson?.pulled?.orders || apiJson?.orders || [];
  return orders
    .map((o) => ({
      id: o.publicId || o.id || "",
      status: o.status || "",
      staff: staffFromOrder(o),
      createdAtMs: parseCreatedAtMs(o),
      raw: o,
    }))
    .filter((o) => o.id);
}

function parseCreatedAtMs(o) {
  const candidates = [
    o.createdAt,
    o.created,
    o.orderDate,
    o.timestamps?.created,
    o.form?.extendedData?.createdAt,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "number" && Number.isFinite(c)) {
      return c < 1e12 ? c * 1000 : c;
    }
    const t = Date.parse(String(c));
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function staffFromOrder(o) {
  const raw =
    o?.staffHandle ||
    o?.staff ||
    o?.worker?.ign ||
    o?.worker?.handle ||
    o?.claimedBy ||
    o?.assignedTo ||
    "??";
  const t = String(raw).trim();
  if (/^chaos$/i.test(t)) return "chAos";
  return t || "??";
}

/** Browser/SW fetch - not used in Node unit tests. */
export async function pullOrders({ apiKey, baseUrl = DEFAULT_BASE, code, page = 1 }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/order/pull`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizeApiKey(apiKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order: { code }, page }),
  });
  if (res.status === 429) {
    const err = new Error("RATE_LIMIT");
    err.code = "RATE_LIMIT";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    err.code = "HTTP";
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data && data.success === false) {
    const err = new Error(data.message || data.error || "API_ERROR");
    err.code = "API_ERROR";
    throw err;
  }
  return normalizePulledOrders(data);
}

export function normalizeSearchOrders(apiJson) {
  const orders =
    apiJson?.results?.orders ||
    apiJson?.pulled?.orders ||
    apiJson?.orders ||
    [];
  return orders
    .map((o) => ({
      id: o.publicId || o.id || "",
      status: o.status || "",
      staff: staffFromOrder(o),
      createdAtMs: parseCreatedAtMs(o) || (o.dateCreated ? Date.parse(o.dateCreated) : null),
      startedAtMs: o.dateStarted ? Date.parse(o.dateStarted) : null,
      note: o.workerNote || o.note || "",
      raw: o,
    }))
    .filter((o) => o.id);
}

/** Lookup by full public order id (or Hub search query). */
export async function searchOrders({ apiKey, baseUrl = DEFAULT_BASE, query, page = 1 }) {
  const q = String(query || "").trim();
  if (!q) return [];
  const url = `${baseUrl.replace(/\/$/, "")}/api/order/search`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalizeApiKey(apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q, page }),
    });
  } catch (e) {
    const err = new Error(`Network: ${e?.message || e}`);
    err.code = "NETWORK";
    throw err;
  }
  if (res.status === 429) {
    const err = new Error("RATE_LIMIT");
    err.code = "RATE_LIMIT";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    err.code = "HTTP";
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data && data.success === false) {
    const err = new Error(data.message || data.error || "API_ERROR");
    err.code = "API_ERROR";
    throw err;
  }
  // Bad/missing auth or double-"Bearer " paste often returns HTTP 200 + {"status":500}
  if (data?.status === 500 || data?.status === 401 || data?.status === 403) {
    const err = new Error(
      "Hub rejected API key (need full strb_… key, not bare hex / Bearer)"
    );
    err.code = "API_AUTH";
    throw err;
  }
  if (data && data.success !== true && data.results == null && data.pulled == null && data.orders == null) {
    const err = new Error("Unexpected search response - check API key / base URL");
    err.code = "API_ERROR";
    throw err;
  }
  return normalizeSearchOrders(data);
}

/** Order IDs often confuse O and 0 in chat fonts - try flipped variants. */
export function zeroOhVariants(id) {
  const raw = String(id || "").trim().toUpperCase();
  if (!raw) return [];
  const out = new Set([raw]);
  const idxs = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "O" || raw[i] === "0") idxs.push(i);
  }
  const limit = Math.min(idxs.length, 6);
  const n = 1 << limit;
  for (let mask = 1; mask < n; mask++) {
    const chars = raw.split("");
    for (let b = 0; b < limit; b++) {
      if (mask & (1 << b)) {
        const i = idxs[b];
        chars[i] = chars[i] === "O" ? "0" : "O";
      }
    }
    out.add(chars.join(""));
  }
  return [...out];
}
