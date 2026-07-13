// strobe-api.js
export const THREAT_SECONDS = { high: 240, medium: 360, low: 480 };
export const DEFAULT_BASE = "https://strobe.gg";

export function normalizePulledOrders(apiJson) {
  const orders = apiJson?.pulled?.orders || apiJson?.orders || [];
  return orders
    .map((o) => ({
      id: o.publicId || o.id || "",
      status: o.status || "",
      staff: o.staffHandle || o.staff || "??",
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

/** Browser/SW fetch — not used in Node unit tests. */
export async function pullOrders({ apiKey, baseUrl = DEFAULT_BASE, code, page = 1 }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/order/pull`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
