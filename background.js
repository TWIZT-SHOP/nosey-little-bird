import { pullOrders, searchOrders, zeroOhVariants, normalizeApiKey, DEFAULT_BASE, LONG_WAIT_SECONDS, isWaitingQueueStatus } from "./strobe-api.js";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
  queueHasLongWait,
} from "./queue-monitor.js";
import { scheduleJsonToCsv } from "./schedule-from-json.js";
import { resolveAlertSrc, DEFAULT_ALERT_SOUND } from "./alert-sounds.js";
import { FEATURES } from "./build-profile.js";
import {
  DEFAULT_POLL_INTERVAL_SEC,
  normalizePollIntervalSec,
  pollIntervalNeedsOffscreen,
} from "./poll-cadence.js";

const ALARM = "bird-poll";

let memState = { byId: {}, whistled: {} };
let backoffUntil = 0;
let pollTick = 0;
let iconFlashOn = false;
let iconFlashWanted = false;
/** Throttle overlapping alarm + offscreen ticks. */
let lastPollStartedAt = 0;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pingOffscreen() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" });
    return !!(r && r.ok);
  } catch (_) {
    return false;
  }
}

async function ensureOffscreen() {
  if (await pingOffscreen()) return;

  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (!contexts?.length) {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification:
          "Play Bird Alert sound and run optional sub-minute Hub queue poll timer",
      });
    } catch (_) {
      /* already exists / racing create */
    }
  }

  // Wait until offscreen.js has registered listeners (create ≠ ready).
  for (let i = 0; i < 25; i++) {
    if (await pingOffscreen()) return;
    await sleep(40);
  }
}

async function syncPollCadence() {
  const data = await chrome.storage.local.get({
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
    monitoringPaused: false,
    strobeApiKey: "",
  });
  const sec = normalizePollIntervalSec(data.pollIntervalSec);
  if (sec !== data.pollIntervalSec) {
    await chrome.storage.local.set({ pollIntervalSec: sec });
  }
  // Keep 1-min alarm as safety net even when offscreen ticks faster
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });

  const wantTimer =
    pollIntervalNeedsOffscreen(sec) &&
    !data.monitoringPaused &&
    !!normalizeApiKey(data.strobeApiKey);

  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({
      type: "SET_POLL_CADENCE",
      seconds: wantTimer ? sec : 0,
    });
  } catch (_) {
    /* offscreen not ready — alarm still polls */
  }
}

async function playAlertSound(volume) {
  const cfg = await chrome.storage.local.get({
    alertSoundId: DEFAULT_ALERT_SOUND,
    alertSoundCustom: "",
  });
  const src = resolveAlertSrc(cfg.alertSoundId, cfg.alertSoundCustom);
  let lastErr = "no attempt";

  for (let attempt = 0; attempt < 3; attempt++) {
    await ensureOffscreen();
    try {
      const r = await chrome.runtime.sendMessage({
        type: "PLAY_ALERT",
        volume,
        src,
      });
      if (r && r.ok !== false && !r.error) return { ok: true };
      lastErr = String(r?.error || "offscreen returned not-ok");
    } catch (e) {
      lastErr = String(e?.message || e);
    }
    await sleep(120 * (attempt + 1));
  }
  return { ok: false, error: lastErr };
}

/** @deprecated name kept for older call sites */
async function playWhistle(volume) {
  return playAlertSound(volume);
}

function setBadge(text, color = "#e91e63") {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: text == null ? "" : String(text) });
}

async function setToolbarIcon(alertStyle) {
  try {
    await chrome.action.setIcon({
      path: alertStyle ? "icon-alert.png" : "icon.png",
    });
  } catch (_) {
    /* ignore */
  }
}

async function setIconFlash(active) {
  if (active === iconFlashWanted) return;
  iconFlashWanted = active;
  if (!active) {
    iconFlashOn = false;
    try {
      await chrome.runtime.sendMessage({ type: "STOP_ICON_FLASH" });
    } catch (_) {
      /* offscreen may be gone */
    }
    await setToolbarIcon(false);
    return;
  }
  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({ type: "START_ICON_FLASH" });
  } catch (_) {
    /* retry next poll */
  }
}

async function onIconFlashTick() {
  if (!iconFlashWanted) return;
  iconFlashOn = !iconFlashOn;
  await setToolbarIcon(iconFlashOn);
  try {
    await chrome.action.setBadgeBackgroundColor({
      color: iconFlashOn ? "#ff1744" : "#7f0000",
    });
  } catch (_) {
    /* ignore */
  }
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

async function pollOnce(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (now < backoffUntil) return;

  const cfg = await chrome.storage.local.get({
    strobeApiKey: "",
    strobeApiBase: DEFAULT_BASE,
    threatLevel: "high",
    mute: false,
    volume: 0.5,
    monitoringPaused: false,
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
  });

  const intervalSec = normalizePollIntervalSec(cfg.pollIntervalSec);
  if (!force && lastPollStartedAt) {
    const minGap = Math.max(5, intervalSec) * 1000 * 0.85;
    if (now - lastPollStartedAt < minGap) return;
  }
  lastPollStartedAt = now;

  const healedKey = normalizeApiKey(cfg.strobeApiKey);
  if (healedKey && healedKey !== String(cfg.strobeApiKey || "").trim()) {
    cfg.strobeApiKey = healedKey;
    chrome.storage.local.set({ strobeApiKey: healedKey }).catch(() => {});
  }

  if (cfg.monitoringPaused) {
    setBadge("");
    setIconFlash(false);
    return;
  }
  if (!cfg.strobeApiKey) {
    setBadge("!", "#f44");
    setIconFlash(false);
    return;
  }

  try {
    const pulled = await pullOrders({
      apiKey: cfg.strobeApiKey,
      baseUrl: cfg.strobeApiBase,
      code: "NEW_OR_PENDING",
    });
    // Alerts / badge / age tracking = waiting queue only (not PENDING mid-order).
    const waiting = pulled.filter((o) => isWaitingQueueStatus(o.status));

    const prevById = memState.byId || {};
    const newIds = new Set(waiting.map((o) => o.id));
    const removedIds = Object.keys(prevById).filter((id) => !newIds.has(id));
    if (removedIds.length) {
      await appendHistoryForRemoved(removedIds, prevById, now);
    }

    memState = applyQueueSnapshot(memState, waiting, now);
    const threat = cfg.mute ? "off" : cfg.threatLevel;
    // "one" uses THREAT_SECONDS.one === 0 → alert once per waiting id (via whistled).
    const crossing = ordersCrossingThreat(memState, now, threat);

    if (crossing.length && threat !== "off") {
      const isOne = threat === "one";
      for (const id of crossing) {
        // Stable id → replace, don't stack, if we retry sound next poll.
        chrome.notifications.create(`bird-threat-${id}`, {
          type: "basic",
          iconUrl: "icon.png",
          title: isOne ? "Order in queue" : "Order past threat marker",
          message: isOne
            ? `${id} — 1-order / slow-shift alert`
            : `${id} sitting too long - queue may need help`,
          priority: 2,
          requireInteraction: true,
          silent: false,
        });
      }
      let soundOk = false;
      let soundErr = "";
      try {
        const sr = await playWhistle(cfg.volume);
        soundOk = !!(sr && sr.ok !== false && !sr.error);
        if (sr && sr.error) soundErr = String(sr.error);
        if (!soundOk && !soundErr) soundErr = "sound did not play";
      } catch (e) {
        soundErr = String(e?.message || e);
      }
      // Only mark whistled after sound plays — silent fail used to eat the only ping.
      if (soundOk) {
        memState = markWhistled(memState, crossing);
      }
      await chrome.storage.local.set({
        lastBirdAlertAt: now,
        lastBirdAlertIds: crossing,
        lastBirdAlertMode: threat,
        lastBirdAlertSoundOk: soundOk,
        lastBirdAlertSoundError: soundErr,
      });
    }

    await chrome.storage.local.set({
      currentOrders: pulled.map((o) => {
        const row = memState.byId[o.id];
        const firstSeen = row?.firstSeenAt || now;
        return {
          id: o.id,
          user: row?.staff || o.staff || "??",
          status: o.status || "UNFILLED",
          ageSec: Math.floor((now - firstSeen) / 1000),
        };
      }),
      lastPollOkAt: now,
      lastPollError: "",
    });

    const longWait = queueHasLongWait(memState, now, LONG_WAIT_SECONDS);
    const badgeColor = longWait ? "#ff1744" : "#e91e63";
    setBadge(String(waiting.length), badgeColor);
    await setIconFlash(longWait && waiting.length > 0);

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
    await setIconFlash(false);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await loadPersistedMonitor();
  if (!FEATURES.birdBrain) {
    chrome.storage.local.remove(["history", "birdBrainLog", "alertSoundCustom"]);
  }
  // After update: re-arm 1-ORDER so a quiet day with a live queue can ping once.
  if (details?.reason === "update") {
    const cfg = await chrome.storage.local.get({
      threatLevel: "high",
      mute: false,
    });
    if (!cfg.mute && cfg.threatLevel === "one") {
      memState = { ...memState, whistled: {} };
      await saveMonitor();
    }
  }
  await syncPollCadence();
  pollOnce({ force: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadPersistedMonitor();
  await syncPollCadence();
  pollOnce({ force: true });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) pollOnce();
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "ICON_FLASH_TICK") {
    onIconFlashTick().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "POLL_TICK") {
    pollOnce().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "FORCE_POLL") {
    pollOnce({ force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "TEST_ALERT_SOUND") {
    chrome.storage.local
      .get({ volume: 0.5 })
      .then((cfg) => playAlertSound(cfg.volume))
      .then((r) => sendResponse(r && r.ok !== false && !r.error ? { ok: true } : { ok: false, error: r?.error || "play failed" }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "SYNC_POLL_CADENCE") {
    syncPollCadence()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
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
  if (
    Object.prototype.hasOwnProperty.call(changes, "pollIntervalSec") ||
    Object.prototype.hasOwnProperty.call(changes, "strobeApiKey") ||
    Object.prototype.hasOwnProperty.call(changes, "monitoringPaused")
  ) {
    syncPollCadence().catch(() => {});
  }
  if (Object.prototype.hasOwnProperty.call(changes, "monitoringPaused")) {
    if (changes.monitoringPaused?.newValue) {
      setBadge("");
      setIconFlash(false);
    } else pollOnce({ force: true }).catch(() => {});
  }
  // Entering 1-ORDER: clear whistled so current waiting orders can ping once.
  if (
    changes.threatLevel &&
    changes.threatLevel.newValue === "one" &&
    changes.threatLevel.oldValue !== "one"
  ) {
    memState = { ...memState, whistled: {} };
    saveMonitor()
      .then(() => pollOnce({ force: true }))
      .catch(() => {});
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

// Ensure alarm + cadence when SW wakes without install/startup events
loadPersistedMonitor().then(() => syncPollCadence());
