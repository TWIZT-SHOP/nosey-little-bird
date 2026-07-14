import { pullOrders, searchOrders, zeroOhVariants, normalizeApiKey, DEFAULT_BASE } from "./strobe-api.js";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
} from "./queue-monitor.js";
import { scheduleJsonToCsv } from "./schedule-from-json.js";
import { resolveAlertSrc, DEFAULT_ALERT_SOUND } from "./alert-sounds.js";
import { FEATURES } from "./build-profile.js";

const ALARM = "bird-poll";

let memState = { byId: {}, whistled: {} };
let backoffUntil = 0;
let pollTick = 0;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts && contexts.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play Bird Alert sound when orders age past threat",
    });
  } catch (_) {
    /* already exists */
  }
}

async function playAlertSound(volume) {
  await ensureOffscreen();
  const cfg = await chrome.storage.local.get({
    alertSoundId: DEFAULT_ALERT_SOUND,
    alertSoundCustom: "",
  });
  const src = resolveAlertSrc(cfg.alertSoundId, cfg.alertSoundCustom);
  return chrome.runtime.sendMessage({
    type: "PLAY_ALERT",
    volume,
    src,
  });
}

/** @deprecated name kept for older call sites */
async function playWhistle(volume) {
  return playAlertSound(volume);
}

function setBadge(text, color = "#e91e63") {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: text == null ? "" : String(text) });
}

async function loadPersistedMonitor() {
  const data = await chrome.storage.local.get({
    queueMonitorState: { byId: {}, whistled: {} },
  });
  memState = data.queueMonitorState || { byId: {}, whistled: {} };
}

async function saveMonitor() {
  await chrome.storage.local.set({ queueMonitorState: memState });
}

function parseSatSecs(s) {
  if (!s || typeof s !== "string") return 0;
  const m =
    String(s).match(/(\d+)\s*m\s*(\d+)\s*s/i) || String(s).match(/(\d+)/);
  return m ? (m[2] ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : parseInt(m[1], 10)) : 0;
}

async function appendHistoryForRemoved(removedIds, prevById, now) {
  if (!FEATURES.birdBrain || !removedIds.length) return;
  const max = FEATURES.historyMaxEntries || 2000;
  const data = await chrome.storage.local.get({ history: [] });
  let history = data.history || [];
  const newEntries = [];

  for (const id of removedIds) {
    const row = prevById[id];
    if (!row) continue;
    const entry = {
      id,
      user: row.staff || "??",
      status: "TAKEN",
      source: "poll",
      born: new Date(row.firstSeenAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      bornDate: new Date(row.firstSeenAt).toLocaleDateString(),
      taken: new Date(now).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      date: new Date(now).toLocaleDateString(),
      satFor: `${Math.floor((now - row.firstSeenAt) / 60000)}m ${Math.floor(((now - row.firstSeenAt) % 60000) / 1000)}s`,
      timestamp: now,
    };
    const existing = history.find((i) => i.id === id);
    if (existing && parseSatSecs(entry.satFor) <= parseSatSecs(existing.satFor)) continue;
    history = history.filter((i) => i.id !== id);
    newEntries.push(entry);
  }

  if (newEntries.length) {
    await chrome.storage.local.set({
      history: [...newEntries, ...history].slice(0, max),
    });
  }
}

/** Log a Hub lookup / HUD GO into Bird Brain (history). Dev only. */
async function recordHistorySight(sight) {
  if (!FEATURES.birdBrain) return { ok: true, skipped: true };
  const id = String(sight?.id || "").trim().toUpperCase();
  if (!id) return { ok: false, error: "missing id" };
  const now = Date.now();
  const max = FEATURES.historyMaxEntries || 2000;
  const data = await chrome.storage.local.get({ history: [] });
  let history = (data.history || []).filter((i) => String(i.id || "").toUpperCase() !== id);

  const placedMs = sight.createdAtMs && Number.isFinite(sight.createdAtMs) ? sight.createdAtMs : null;
  const entry = {
    id,
    user: sight.user || sight.staff || "??",
    status: sight.status || "??",
    source: sight.source || "lookup",
    born: placedMs
      ? new Date(placedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—",
    bornDate: placedMs ? new Date(placedMs).toLocaleDateString() : "",
    taken: new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    date: new Date(now).toLocaleDateString(),
    satFor: "—",
    note: sight.note || "",
    timestamp: now,
  };

  await chrome.storage.local.set({
    history: [entry, ...history].slice(0, max),
  });
  return { ok: true, entry };
}

async function pollOnce() {
  const now = Date.now();
  if (now < backoffUntil) return;

  const cfg = await chrome.storage.local.get({
    strobeApiKey: "",
    strobeApiBase: DEFAULT_BASE,
    threatLevel: "high",
    mute: false,
    volume: 0.5,
    monitoringPaused: false,
  });

  const healedKey = normalizeApiKey(cfg.strobeApiKey);
  if (healedKey && healedKey !== String(cfg.strobeApiKey || "").trim()) {
    cfg.strobeApiKey = healedKey;
    chrome.storage.local.set({ strobeApiKey: healedKey }).catch(() => {});
  }

  if (cfg.monitoringPaused) {
    setBadge("");
    return;
  }
  if (!cfg.strobeApiKey) {
    setBadge("!", "#f44");
    return;
  }

  try {
    const unfilled = await pullOrders({
      apiKey: cfg.strobeApiKey,
      baseUrl: cfg.strobeApiBase,
      code: "NEW_OR_PENDING",
    });

    const prevById = memState.byId || {};
    const newIds = new Set(unfilled.map((o) => o.id));
    const removedIds = Object.keys(prevById).filter((id) => !newIds.has(id));
    if (removedIds.length) {
      await appendHistoryForRemoved(removedIds, prevById, now);
    }

    memState = applyQueueSnapshot(memState, unfilled, now);
    const crossing = ordersCrossingThreat(memState, now, cfg.threatLevel);
    if (crossing.length && !cfg.mute && cfg.threatLevel !== "off") {
      for (const id of crossing) {
        chrome.notifications.create(`bird-threat-${id}-${now}`, {
          type: "basic",
          iconUrl: "icon.png",
          title: "Order past threat marker",
          message: `${id} sitting too long - queue may need help`,
          priority: 2,
          requireInteraction: true,
        });
      }
      await playWhistle(cfg.volume);
      memState = markWhistled(memState, crossing);
    }

    await chrome.storage.local.set({
      currentOrders: unfilled.map((o) => ({
        id: o.id,
        user: memState.byId[o.id]?.staff || o.staff || "??",
        status: o.status || "UNFILLED",
        ageSec: Math.floor((now - (memState.byId[o.id]?.firstSeenAt || now)) / 1000),
      })),
      lastPollOkAt: now,
      lastPollError: "",
    });
    setBadge(String(unfilled.length), "#e91e63");

    pollTick += 1;
    if (pollTick % 2 === 0) {
      const paused = await pullOrders({
        apiKey: cfg.strobeApiKey,
        baseUrl: cfg.strobeApiBase,
        code: "PAUSED",
      });
      await chrome.storage.local.set({
        pausedOrders: paused.map((o) => ({
          id: o.id,
          staff: o.staff || "??",
          status: "Paused",
          pausedAt: now,
        })),
      });
    }

    await saveMonitor();
  } catch (e) {
    if (e?.code === "RATE_LIMIT") {
      backoffUntil = Date.now() + 60_000;
    }
    await chrome.storage.local.set({
      lastPollError: String(e?.message || e),
    });
    setBadge("!", "#f44");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadPersistedMonitor();
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  if (!FEATURES.birdBrain) {
    chrome.storage.local.remove(["history", "birdBrainLog", "alertSoundCustom"]);
  }
  pollOnce();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadPersistedMonitor();
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  pollOnce();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) pollOnce();
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "FORCE_POLL") {
    pollOnce().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "SEARCH_ORDER") {
    handleSearchQuery(msg.query)
      .then(async (r) => {
        if (r?.ok && r.order?.id) {
          await recordHistorySight({
            id: r.order.id,
            user: r.order.staff,
            status: r.order.status,
            createdAtMs: r.order.createdAtMs,
            note: r.order.note,
            source: "lookup",
          });
        }
        sendResponse(r);
      })
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "SCHEDULE_JSON") {
    chrome.storage.local.set({
      scheduleJson: msg.data,
      scheduleCsv: msg.csv,
      scheduleCachedAt: Date.now(),
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "SCHEDULE_RAW_JSON" && msg.data) {
    const csv = scheduleJsonToCsv(msg.data);
    chrome.storage.local.set({
      scheduleJson: msg.data,
      scheduleCsv: csv,
      scheduleCachedAt: Date.now(),
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleSearchQuery(query) {
  const cleaned = String(query || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return { ok: false, error: "Paste full order ID" };

  const cfg = await chrome.storage.local.get({
    strobeApiKey: "",
    strobeApiBase: DEFAULT_BASE,
  });
  const apiKey = normalizeApiKey(cfg.strobeApiKey);
  const baseUrl = String(cfg.strobeApiBase || DEFAULT_BASE).trim() || DEFAULT_BASE;
  if (!apiKey) return { ok: false, error: "No API key - save one in bird settings" };

  // Heal keys that were saved with a leading "Bearer "
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
            staff: hit.staff || "??",
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
      // Network / auth failure - don't burn through all O/0 variants
      if (
        e?.code === "NETWORK" ||
        e?.code === "API_AUTH" ||
        /Failed to fetch|Network|auth/i.test(String(e?.message || e))
      ) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
  }

  if (lastErr) return { ok: false, error: String(lastErr?.message || lastErr) };
  return { ok: true, order: null, count: 0 };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bird-search") return;
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "SEARCH_ORDER") return;
    try {
      port.postMessage(await handleSearchQuery(msg.query));
    } catch (e) {
      port.postMessage({ ok: false, error: String(e?.message || e) });
    }
  });
});

// Storage relay - survives flaky sendMessage ports (Brave SW sleep)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.prototype.hasOwnProperty.call(changes, "monitoringPaused")) {
    if (changes.monitoringPaused?.newValue) setBadge("");
    else pollOnce().catch(() => {});
  }
  if (!changes.birdSearchRequest?.newValue) return;
  const req = changes.birdSearchRequest.newValue;
  if (!req?.id || !req?.query) return;
  handleSearchQuery(req.query)
    .then((result) =>
      chrome.storage.local.set({
        birdSearchResult: { id: req.id, at: Date.now(), ...result },
      })
    )
    .catch((e) =>
      chrome.storage.local.set({
        birdSearchResult: {
          id: req.id,
          at: Date.now(),
          ok: false,
          error: String(e?.message || e),
        },
      })
    );
});

// Ensure alarm exists when SW wakes without install/startup events
loadPersistedMonitor().then(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
});
