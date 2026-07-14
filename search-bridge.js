// Extension-page bridge: can fetch strobe.gg (HubSpot page CSP cannot).
import { searchOrders, zeroOhVariants, normalizeApiKey, DEFAULT_BASE } from "./strobe-api.js";

function staffNorm(s) {
  const t = String(s || "??").trim();
  if (/^chaos$/i.test(t)) return "chAos";
  return t || "??";
}

function cleanOrderQuery(query) {
  return String(query || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function lookup(query) {
  const cleaned = cleanOrderQuery(query);
  if (!cleaned) return { ok: false, error: "Paste full order ID" };

  const cfg = await chrome.storage.local.get({
    strobeApiKey: "",
    strobeApiBase: DEFAULT_BASE,
  });
  const apiKey = normalizeApiKey(cfg.strobeApiKey);
  const baseUrl = String(cfg.strobeApiBase || DEFAULT_BASE).trim() || DEFAULT_BASE;
  if (!apiKey) {
    return { ok: false, error: "No API key - save one in bird settings" };
  }
  if (apiKey !== String(cfg.strobeApiKey || "").trim()) {
    chrome.storage.local.set({ strobeApiKey: apiKey }).catch(() => {});
  }

  const variants = zeroOhVariants(cleaned);
  let lastErr = null;
  for (const v of variants) {
    try {
      const orders = await searchOrders({
        apiKey,
        baseUrl,
        query: v,
      });
      const q = v.toUpperCase();
      const hit =
        orders.find((o) => String(o.id || "").toUpperCase() === q) ||
        orders[0] ||
        null;
      if (hit) {
        return {
          ok: true,
          order: {
            id: hit.id,
            staff: staffNorm(hit.staff),
            status: hit.status || "??",
            createdAtMs: hit.createdAtMs || null,
            note: hit.note || "",
          },
          count: orders.length,
          queryUsed: v,
          corrected: v !== cleaned,
        };
      }
    } catch (e) {
      lastErr = e;
      if (
        e?.code === "NETWORK" ||
        e?.code === "API_AUTH" ||
        /Failed to fetch|Network|auth|rejected/i.test(String(e?.message || e))
      ) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
  }
  if (lastErr) return { ok: false, error: String(lastErr?.message || lastErr) };
  return { ok: true, order: null, count: 0 };
}

function reply(target, payload) {
  try {
    target?.postMessage(payload, "*");
  } catch (_) {
    /* ignore */
  }
  try {
    if (target !== window.parent) window.parent.postMessage(payload, "*");
  } catch (_) {
    /* ignore */
  }
}

window.addEventListener("message", async (ev) => {
  const d = ev.data;
  if (!d || d.source !== "nosey-little-bird" || d.type !== "BIRD_SEARCH") return;
  try {
    const result = await lookup(d.query);
    reply(ev.source, {
      source: "nosey-little-bird",
      type: "BIRD_SEARCH_RESULT",
      id: d.id,
      ...result,
    });
  } catch (e) {
    reply(ev.source, {
      source: "nosey-little-bird",
      type: "BIRD_SEARCH_RESULT",
      id: d.id,
      ok: false,
      error: String(e?.message || e),
    });
  }
});

window.parent.postMessage({ source: "nosey-little-bird", type: "BIRD_SEARCH_READY" }, "*");
