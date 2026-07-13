# API-First Nosey Little Bird Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Nosey Little Bird so it polls Strobe Hub API with each user’s key, alerts only when unfilled orders age past the threat marker, and keeps schedule/HubSpot helpers without requiring a Strobe tab.

**Architecture:** MV3 service worker uses `chrome.alarms` to `POST /api/order/pull` (`NEW_OR_PENDING` + `PAUSED`). Pure modules (`strobe-api.js`, `queue-monitor.js`, `schedule-from-json.js`) are unit-tested in Node. Whistle audio uses an offscreen document. Schedule comes from `https://strobe.twizt.shop/schedule.json` after Cloudflare Access unlock (content script). HubSpot keeps click-to-copy and hydrates paused HUD from storage.

**Tech Stack:** Chrome/Brave MV3 extension (vanilla JS), Node assert tests, Strobe Hub REST API, Cloudflare Access–gated schedule host.

**Spec:** `docs/superpowers/specs/2026-07-13-api-first-bird-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `strobe-api.js` | Hub pull helper + order normalize (SW + tests) |
| `queue-monitor.js` | Age timers, threat crossing, whistled set (pure) |
| `schedule-from-json.js` | `schedule.json` → CSV rows + who’s-on-now names |
| `background.js` | Alarms, poll loop, notify, badge, storage, offscreen whistle |
| `offscreen.html` / `offscreen.js` | Play `whistle.mp3` for SW |
| `schedule-content.js` | On `strobe.twizt.shop` / future `strobe.gg`, fetch `schedule.json` after unlock |
| `manifest.json` | Permissions, SW, content scripts, host perms |
| `popup.html` / `popup.js` | API key UI; show paused; schedule status |
| `content.js` | HubSpot HUD + copy; remove Unfilled DOM as source of truth |
| `tests/*.test.mjs` | Node unit tests for pure modules |
| `README.md` | Install + API key + schedule unlock |

---

### Task 1: Hub API client (pure)

**Files:**
- Create: `package.json` (only `"type": "module"` so Node can import `.js` ESM)
- Create: `strobe-api.js`
- Create: `tests/strobe-api.test.mjs`

- [ ] **Step 0: Add package type**

```json
{ "name": "nosey-little-bird", "private": true, "type": "module" }
```

- [ ] **Step 1: Write the failing test**

```js
// tests/strobe-api.test.mjs
import assert from "node:assert/strict";
import { normalizePulledOrders, THREAT_SECONDS } from "../strobe-api.js";

const sample = {
  success: true,
  pulled: {
    orders: [
      {
        publicId: "ABC123DEF45678",
        status: "NEW",
        form: { extendedData: {} },
        breakdown: { total: 1500 },
      },
    ],
  },
};

const orders = normalizePulledOrders(sample);
assert.equal(orders.length, 1);
assert.equal(orders[0].id, "ABC123DEF45678");
assert.equal(orders[0].status, "NEW");
assert.equal(THREAT_SECONDS.high, 240);
assert.equal(THREAT_SECONDS.medium, 360);
assert.equal(THREAT_SECONDS.low, 480);
console.log("strobe-api tests ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/strobe-api.test.mjs`  
Expected: FAIL — module not found / export missing

- [ ] **Step 3: Write minimal implementation**

```js
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
```

Note: MV3 classic SW cannot use ES `export`. For the extension, either:
- set `"type": "module"` on the service worker and use `import`, **or**
- duplicate a classic IIFE build. **Prefer module SW:** in `manifest.json` use `"background": { "service_worker": "background.js", "type": "module" }` and `import` these files.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/strobe-api.test.mjs`  
Expected: `strobe-api tests ok`

- [ ] **Step 5: Commit**

```bash
git add strobe-api.js tests/strobe-api.test.mjs
git commit -m "feat: add Strobe Hub pull normalize helper"
```

---

### Task 2: Queue age / threat logic (pure)

**Files:**
- Create: `queue-monitor.js`
- Create: `tests/queue-monitor.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/queue-monitor.test.mjs
import assert from "node:assert/strict";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
  THREAT_SECONDS,
} from "../queue-monitor.js";

let state = { byId: {}, whistled: {} };
const t0 = 1_000_000;

state = applyQueueSnapshot(state, [{ id: "A", createdAtMs: null }], t0);
assert.equal(state.byId.A.firstSeenAt, t0);

state = applyQueueSnapshot(state, [{ id: "A", createdAtMs: null }], t0 + 1000);
assert.equal(state.byId.A.firstSeenAt, t0);

const cross = ordersCrossingThreat(
  state,
  t0 + THREAT_SECONDS.high * 1000,
  "high"
);
assert.deepEqual(cross, ["A"]);

state = markWhistled(state, ["A"]);
assert.deepEqual(
  ordersCrossingThreat(state, t0 + THREAT_SECONDS.high * 1000, "high"),
  []
);

state = applyQueueSnapshot(state, [], t0 + 5000);
assert.equal(state.byId.A, undefined);
console.log("queue-monitor tests ok");
```

(Update the import line to include `markWhistled`.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `node tests/queue-monitor.test.mjs`

- [ ] **Step 3: Implement**

```js
// queue-monitor.js
import { THREAT_SECONDS } from "./strobe-api.js";
export { THREAT_SECONDS };

export function applyQueueSnapshot(state, orders, nowMs) {
  const byId = { ...(state.byId || {}) };
  const seen = new Set();
  for (const o of orders) {
    seen.add(o.id);
    const existing = byId[o.id];
    const firstSeenAt =
      existing?.firstSeenAt ??
      (o.createdAtMs != null ? o.createdAtMs : nowMs);
    byId[o.id] = {
      id: o.id,
      staff: o.staff || existing?.staff || "??",
      status: o.status || existing?.status || "",
      firstSeenAt,
    };
  }
  for (const id of Object.keys(byId)) {
    if (!seen.has(id)) delete byId[id];
  }
  const whistled = { ...(state.whistled || {}) };
  for (const id of Object.keys(whistled)) {
    if (!byId[id]) delete whistled[id];
  }
  return { byId, whistled };
}

export function ordersCrossingThreat(state, nowMs, threatLevel) {
  if (!threatLevel || threatLevel === "off") return [];
  const need = THREAT_SECONDS[threatLevel];
  if (need == null) return [];
  const out = [];
  for (const [id, row] of Object.entries(state.byId || {})) {
    if (state.whistled?.[id]) continue;
    if (nowMs - row.firstSeenAt >= need * 1000) out.push(id);
  }
  return out;
}

export function markWhistled(state, ids) {
  const whistled = { ...(state.whistled || {}) };
  for (const id of ids) whistled[id] = true;
  return { ...state, whistled };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node tests/queue-monitor.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add queue-monitor.js tests/queue-monitor.test.mjs
git commit -m "feat: add queue age and threat-crossing helpers"
```

---

### Task 3: Schedule JSON → who’s on now

**Files:**
- Create: `schedule-from-json.js`
- Create: `tests/schedule-from-json.test.mjs`
- Fixture: inline minimal week in the test (do not commit huge `schedule.json`)

- [ ] **Step 1: Failing test**

```js
// tests/schedule-from-json.test.mjs
import assert from "node:assert/strict";
import {
  scheduleJsonToCsv,
  namesOnDutyAt,
} from "../schedule-from-json.js";

const sample = {
  sourceTz: "America/Phoenix",
  weeks: [
    {
      dates: [{ iso: "2026-07-13", label: "Jul 13" }],
      columns: [
        [
          {
            name: "chAos",
            start: "13:00",
            end: "18:00",
            startIso: "2026-07-13T13:00:00-07:00",
            endIso: "2026-07-13T18:00:00-07:00",
          },
        ],
      ],
    },
  ],
};

const csv = scheduleJsonToCsv(sample);
assert.match(csv, /Nookmart/);
assert.match(csv, /chAos/);

const at = Date.parse("2026-07-13T15:00:00-07:00");
const names = namesOnDutyAt(sample, at);
assert.deepEqual(names, ["chAos"]);
console.log("schedule-from-json tests ok");
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```js
// schedule-from-json.js
export function scheduleJsonToCsv(data) {
  const lines = ["Section,Date,Day,Users,Start,End,Hours,Notes"];
  const weeks = data?.weeks || [];
  for (const week of weeks) {
    const dates = week.dates || [];
    const columns = week.columns || [];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      const shifts = columns[i] || [];
      const iso = d.iso || "";
      const [y, m, day] = iso.split("-").map(Number);
      const dateStr = iso ? `${m}/${day}/${String(y).slice(-2)}` : d.label || "";
      const dayName = iso
        ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: "UTC",
          })
        : "";
      for (const s of shifts) {
        if (!s?.name || /^OPEN$/i.test(s.name)) continue;
        lines.push(
          ["Nookmart", dateStr, dayName, s.name, s.start || "", s.end || "", "", ""]
            .map(csvEscape)
            .join(",")
        );
      }
    }
  }
  return lines.join("\n");
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function namesOnDutyAt(data, nowMs) {
  const names = [];
  for (const week of data?.weeks || []) {
    for (const col of week.columns || []) {
      for (const s of col || []) {
        if (!s?.name || /^OPEN$/i.test(s.name)) continue;
        const a = Date.parse(s.startIso);
        const b = Date.parse(s.endIso);
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        if (nowMs >= a && nowMs < b) names.push(normalizeName(s.name));
      }
    }
  }
  return [...new Set(names)];
}

function normalizeName(n) {
  const t = String(n).trim();
  if (/^chaos$/i.test(t)) return "chAos";
  return t;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add schedule-from-json.js tests/schedule-from-json.test.mjs
git commit -m "feat: convert Strobe Team schedule.json to bird CSV"
```

---

### Task 4: Manifest + offscreen whistle

**Files:**
- Modify: `manifest.json`
- Create: `offscreen.html`, `offscreen.js`

- [ ] **Step 1: Update manifest**

Replace permissions/background/content_scripts as follows (keep icon/action/history resources):

```json
{
  "manifest_version": 3,
  "name": "Nosey Little Bird! Who Dat? Edition",
  "short_name": "Who Dat? Bird",
  "version": "2.0.0",
  "description": "Polls Strobe Hub API for unfilled/paused orders, alerts when orders sit past your threat level, shows who's on shift from the coverage schedule.",
  "permissions": [
    "storage",
    "unlimitedStorage",
    "alarms",
    "notifications",
    "offscreen",
    "tabs"
  ],
  "host_permissions": [
    "https://strobe.gg/*",
    "https://strobe.twizt.shop/*",
    "https://docs.google.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  },
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  },
  "content_scripts": [
    {
      "matches": ["https://app.hubspot.com/live-messages/*"],
      "js": ["content.js"]
    },
    {
      "matches": [
        "https://strobe.twizt.shop/*",
        "https://strobe.gg/*"
      ],
      "js": ["schedule-content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["whistle.mp3", "history.html", "schedules/latest.csv"],
      "matches": ["https://*.strobe.gg/*", "https://strobe.twizt.shop/*", "https://app.hubspot.com/*"]
    }
  ]
}
```

- [ ] **Step 2: Offscreen audio**

```html
<!-- offscreen.html -->
<!DOCTYPE html>
<html><body><script type="module" src="offscreen.js"></script></body></html>
```

```js
// offscreen.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "PLAY_WHISTLE") return;
  const vol = Math.min(2, Math.max(0, Number(msg.volume) || 0.5));
  const audio = new Audio(chrome.runtime.getURL("whistle.mp3"));
  audio.volume = Math.min(1, vol);
  audio.play().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
```

- [ ] **Step 3: Manual check** — load unpacked later in Task 5 smoke; for now ensure files exist.

- [ ] **Step 4: Commit**

```bash
git add manifest.json offscreen.html offscreen.js
git commit -m "chore: MV3 module SW, alarms, offscreen whistle, schedule hosts"
```

---

### Task 5: Background poll loop

**Files:**
- Rewrite: `background.js` (module)

- [ ] **Step 1: Implement SW**

```js
// background.js
import { pullOrders, DEFAULT_BASE } from "./strobe-api.js";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
} from "./queue-monitor.js";

const ALARM = "bird-poll";
const POLL_MINUTES = 0.25; // 15s — chrome.alarms minimum is 1 min in stable Chrome; use 1 min period + setInterval fallback while SW alive

// IMPORTANT: chrome.alarms periodInMinutes minimum is often 1.
// Use periodInMinutes: 1 for reliability; also run poll once on startup/install.

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
});
```

Document in README: Brave/Chrome alarm cadence is ~1 minute (extension platform limit). That is within the 30/min API budget even with paused every other tick.

- [ ] **Step 2: Smoke with real key (operator machine)**

```bash
# Do NOT commit the key. Temporarily paste in popup after load.
# Or one-off node check:
node -e '
import { pullOrders } from "./strobe-api.js";
import fs from "fs";
const env = fs.readFileSync(process.env.HOME+"/.config/twizt-shop/strobe.env","utf8");
const key = env.match(/STROBE_API_KEY=(.*)/)?.[1]?.trim();
const orders = await pullOrders({ apiKey: key, code: "NEW_OR_PENDING" });
console.log("count", orders.length, orders.slice(0,3));
'
```

Expected: prints count without throw.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: background Hub poll, threat notify, paused every other tick"
```

---

### Task 6: Popup — API key + paused list

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Add API key + paused UI to `popup.html`**

Insert **above** the volume box:

```html
  <div class="vol-box" id="apiKeyBox">
    <div class="label" style="margin-top:0">Strobe Hub API key</div>
    <input id="apiKeyInput" type="password" placeholder="Paste API key" style="width:100%;box-sizing:border-box;padding:6px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;margin-top:4px" />
    <div class="vol-row" style="margin-top:8px">
      <button id="apiKeySave" class="test-btn">Save</button>
      <button id="apiKeyClear" class="test-btn">Clear</button>
      <button id="forcePoll" class="test-btn">Poll now</button>
    </div>
    <div id="pollStatus" class="label" style="margin-top:6px;text-transform:none;color:#888"></div>
  </div>
```

After Current Orders box, add:

```html
  <div class="label">Paused (API)</div>
  <div class="order-box" id="pausedList"></div>
```

In schedule box, change empty hint to: `Open strobe.twizt.shop (Access) to refresh` when no cache.

- [ ] **Step 2: Wire `popup.js`**

Add handlers (keep existing threat/volume/schedule display):

```js
document.getElementById("apiKeySave").onclick = () => {
  const key = document.getElementById("apiKeyInput").value.trim();
  chrome.storage.local.set({ strobeApiKey: key }, () => {
    document.getElementById("apiKeyInput").value = "";
    document.getElementById("pollStatus").textContent = key ? "Key saved" : "Empty key";
    chrome.runtime.sendMessage({ type: "FORCE_POLL" });
  });
};
document.getElementById("apiKeyClear").onclick = () => {
  chrome.storage.local.set({ strobeApiKey: "" }, updateUI);
};
document.getElementById("forcePoll").onclick = () => {
  chrome.runtime.sendMessage({ type: "FORCE_POLL" }, updateUI);
};
```

In `updateUI` `chrome.storage.local.get`, also read `strobeApiKey`, `pausedOrders`, `lastPollOkAt`, `lastPollError`, `scheduleCachedAt`.  
If `strobeApiKey` present, show `•••• saved` in status (do not put raw key back into the input).  
Render `pausedList` like `orderList` (copy on click).  
Include `pausedOrders` / `lastPollError` in `onChanged` listener keys.

Retire reliance on `monitorOnlyOnShift` for alerts (may leave key unused).

- [ ] **Step 3: Manual UI check** — load unpacked, save key, Poll now, see Current Orders.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: popup API key, poll status, paused list"
```

---

### Task 7: Schedule content script

**Files:**
- Create: `schedule-content.js`

- [ ] **Step 1: Implement**

```js
// schedule-content.js
(async function () {
  // Cloudflare Access login pages won't have schedule.json
  async function tryFetchSchedule() {
    try {
      const url = new URL("/schedule.json", location.origin).href;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const data = await tryFetchSchedule();
  if (!data?.weeks) return;

  // Dynamic import not available in classic content scripts — inline minimal converter
  // OR register this file as module: use importScripts-equivalent via type module content script.
  // Manifest: "js": ["schedule-content.js"] with "type": "module" is supported in Chrome 120+ via
  // "world" options — simplest path: duplicate thin converter call via message to SW.

  chrome.runtime.sendMessage({ type: "SCHEDULE_RAW_JSON", data }, () => {});
})();
```

Prefer converting in the SW to reuse `schedule-from-json.js`:

Update `background.js` message handler:

```js
import { scheduleJsonToCsv } from "./schedule-from-json.js";

// in onMessage:
if (msg?.type === "SCHEDULE_RAW_JSON" && msg.data) {
  const csv = scheduleJsonToCsv(msg.data);
  chrome.storage.local.set({
    scheduleJson: msg.data,
    scheduleCsv: csv,
    scheduleCachedAt: Date.now(),
  }).then(() => sendResponse({ ok: true }));
  return true;
}
```

Keep paste-CSV path in popup as manual fallback.

- [ ] **Step 2: Manual** — with Access session, open https://strobe.twizt.shop → popup who’s-on-now updates.

- [ ] **Step 3: Commit**

```bash
git add schedule-content.js background.js
git commit -m "feat: cache schedule.json after Access unlock"
```

---

### Task 8: HubSpot content — API paused, drop Strobe DOM truth

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Gate Strobe-only scan**

At top, keep `isHubspot` / `isStrobe`.  
If `isStrobe`: either remove file from Strobe matches (already removed in Task 4 manifest) **or** no-op scan. Manifest in Task 4 already drops `*.strobe.gg` content script except schedule host — **delete or strip Strobe DOM scan paths** so dead code does not confuse. Prefer strip: remove `scanOrders` interval for Strobe; keep HubSpot HUD + copy helpers.

HubSpot path: keep existing HUD hydrate from `pausedOrders` in storage (already present). Ensure it does not require visiting Strobe Paused.

Click-to-copy: keep wrapping order IDs on HubSpot.

- [ ] **Step 2: Manual** — HubSpot live messages: paused HUD shows API ids; click copies.

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "fix: HubSpot HUD from API paused; drop Strobe DOM monitor"
```

---

### Task 9: README + version polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite Features / Usage**

Document:
1. Load unpacked
2. Paste Strobe Hub API key in popup
3. Threat HIGH/MED/LOW — notify only when past marker
4. Open https://strobe.twizt.shop once (Cloudflare Access) so bird caches schedule
5. No need to keep Unfilled Orders open
6. HubSpot click-to-copy + paused HUD
7. Disclaimer: needs valid personal API key; rate limit 30/min

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: explain API-first bird setup for staff"
```

---

### Task 10: End-to-end acceptance

- [ ] **Step 1: Run unit tests**

```bash
node tests/strobe-api.test.mjs
node tests/queue-monitor.test.mjs
node tests/schedule-from-json.test.mjs
```

Expected: all print `… tests ok`

- [ ] **Step 2: Brave unpacked checklist**

1. `brave://extensions` → Reload  
2. Paste key → Poll now → Current Orders matches Hub  
3. Leave YouTube up → when an order ages past threat (or temporarily set HIGH and wait / mock `firstSeenAt` via temporary test hook), notification + whistle  
4. Paused list + HubSpot HUD  
5. Visit strobe.twizt.shop after Access → who’s on now  
6. Clear key → badge `!`

- [ ] **Step 3: Final commit if any fixes**

```bash
git add -u
git commit -m "fix: acceptance tweaks for API-first bird"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Per-user API key | 6 |
| Background poll, no Strobe tab | 5 |
| Threat-only alerts 4/6/8 | 2, 5, 6 |
| Whole NEW_OR_PENDING queue | 5 |
| Who’s on now via schedule unlock | 3, 7 |
| Never store Access password | 7 (cookies only) |
| HubSpot copy + paused via API | 5, 8 |
| 429 backoff | 5 |
| Badge count | 5 |
| No monitorOnlyOnShift gate | 5, 6 |
| README | 9 |
| Acceptance | 10 |

## Notes for implementers

- **Alarm floor:** Chrome may clamp `periodInMinutes` to 1. Do not promise 15s polls in user-facing copy; say “about every minute.”
- **Whistle:** Requires `offscreen` permission; if createDocument fails, still show desktop notification.
- **Schedule Access:** Content script cannot bypass Cloudflare Access. User must unlock in the browser first.
- **Overflow:** New coverage `schedule.json` is a single duty roster; map to Nookmart CSV section. Overflow UI may show empty unless data exists — acceptable for v2.
- **Do not commit** `~/.config/twizt-shop/strobe.env` or any real API key.
