import { pullOrders, DEFAULT_BASE } from "./strobe-api.js";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
} from "./queue-monitor.js";
import { scheduleJsonToCsv } from "./schedule-from-json.js";

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
      justification: "Play Bird Alert whistle when orders age past threat",
    });
  } catch (_) {
    /* already exists */
  }
}

async function playWhistle(volume) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ type: "PLAY_WHISTLE", volume });
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
  if (!removedIds.length) return;
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
      history: [...newEntries, ...history].slice(0, 5000),
    });
  }
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

  if (!cfg.strobeApiKey || cfg.monitoringPaused) {
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
          message: `${id} sitting too long — queue may need help`,
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
  if (msg?.type === "FORCE_POLL") {
    pollOnce().then(() => sendResponse({ ok: true }));
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

// Ensure alarm exists when SW wakes without install/startup events
loadPersistedMonitor().then(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
});
