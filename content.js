// HubSpot inbox only - API-first bird does not scan Strobe DOM.
// FEATURES come from content-features.js (classic inject; modules break in some Brave builds).
const FEATURES = globalThis.__BIRD_FEATURES__ || {
  birdBrain: false,
  birdBrainImportExport: false,
  customAlertSound: false,
  historyPage: false,
  historyMaxEntries: 0,
  hudRefreshMs: 8000,
  showBuildBadge: true,
  buildLabel: "STAFF",
};

if (!location.hostname.includes("app.hubspot.com")) {
  // no-op
} else {
  const IS_TOP = window === window.top;
  const DARK_CLASS = "bird-hubspot-dark";
  const DARK_STYLE_ATTR = "data-bird-dark-css";

  // Invert-page dark mode (HubSpot has no solid native dark for inbox).
  // Nested filter on HUD / media / our ID chips cancels the invert.
  const DARK_CSS = `
html.${DARK_CLASS} {
  background: #111 !important;
  filter: invert(1) hue-rotate(180deg) contrast(0.95) !important;
}
html.${DARK_CLASS} img,
html.${DARK_CLASS} video,
html.${DARK_CLASS} canvas,
html.${DARK_CLASS} iframe,
html.${DARK_CLASS} svg image,
html.${DARK_CLASS} [data-bird-hud],
html.${DARK_CLASS} .bird-id-hit,
html.${DARK_CLASS} .bird-id-copyable,
html.${DARK_CLASS} .bird-id-clickable,
html.${DARK_CLASS} .bird-dodo-copyable {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

  function ensureDarkStyle() {
    const host = document.head || document.documentElement;
    if (!host || host.querySelector(`style[${DARK_STYLE_ATTR}]`)) return;
    const style = document.createElement("style");
    style.setAttribute(DARK_STYLE_ATTR, "1");
    style.textContent = DARK_CSS;
    host.appendChild(style);
  }

  function applyHubspotDark(on) {
    ensureDarkStyle();
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle(DARK_CLASS, !!on);
  }

  chrome.storage.local.get({ hubspotDarkMode: true }, (d) => applyHubspotDark(!!d.hubspotDarkMode));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.hubspotDarkMode) return;
    applyHubspotDark(!!changes.hubspotDarkMode.newValue);
  });

  // === BIRD BRAIN HUD (top frame only; all_frames also injects for chat iframes) ===
  let hud = null;
  let loreBox = null;
  let hudSearchInput = null;
  let hudSearchOut = null;
  let hudSearchWrap = null;
  let runHudSearch = null;
  let hudShowSearch = true;
  let hudShowPaused = false;
  const hudRows = new Map(); // id -> { el, staff, status, satFor, note, color }
  const hudOrderIds = []; // most-recent first

  let hudSearchBridge = null;
  let hudSearchBridgeReady = null;

  function extPageOrigin() {
    return `chrome-extension://${chrome.runtime.id}`;
  }

  function ensureSearchBridge() {
    if (hudSearchBridgeReady) return hudSearchBridgeReady;
    hudSearchBridgeReady = new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.src = chrome.runtime.getURL("search-bridge.html");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
      let settled = false;
      const finish = (ok, val) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onReady);
        if (ok) resolve(val);
        else {
          hudSearchBridgeReady = null;
          reject(val instanceof Error ? val : new Error(String(val)));
        }
      };
      const onReady = (e) => {
        if (e.origin !== extPageOrigin()) return;
        if (e.data?.source !== "nosey-little-bird" || e.data.type !== "BIRD_SEARCH_READY") return;
        finish(true, iframe);
      };
      window.addEventListener("message", onReady);
      iframe.onerror = () => finish(false, new Error("Search bridge blocked (HubSpot CSP?)"));
      (document.documentElement || document.body).appendChild(iframe);
      hudSearchBridge = iframe;
      setTimeout(() => finish(false, new Error("Search bridge failed to load - reload extension")), 4000);
    });
    return hudSearchBridgeReady;
  }

  function cleanOrderQuery(query) {
    return String(query || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function lookupViaServiceWorker(query) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (resp) => {
        if (settled) return;
        settled = true;
        resolve(resp);
      };
      try {
        chrome.runtime.sendMessage({ type: "SEARCH_ORDER", query }, (resp) => {
          if (chrome.runtime.lastError) {
            done(null);
            return;
          }
          done(resp || null);
        });
      } catch (_) {
        done(null);
        return;
      }
      setTimeout(() => done(null), 8000);
    });
  }

  function lookupViaBridge(query) {
    return ensureSearchBridge()
      .then(
        (iframe) =>
          new Promise((resolve) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            let settled = false;
            const done = (resp) => {
              if (settled) return;
              settled = true;
              window.removeEventListener("message", onMsg);
              resolve(resp);
            };
            const onMsg = (e) => {
              if (e.origin !== extPageOrigin()) return;
              const d = e.data;
              if (!d || d.source !== "nosey-little-bird" || d.type !== "BIRD_SEARCH_RESULT") return;
              if (d.id !== requestId) return;
              done(d);
            };
            window.addEventListener("message", onMsg);
            try {
              if (!iframe.contentWindow) {
                done({ ok: false, error: "Search bridge not ready" });
                return;
              }
              iframe.contentWindow.postMessage(
                { source: "nosey-little-bird", type: "BIRD_SEARCH", id: requestId, query },
                extPageOrigin()
              );
            } catch (e) {
              done({ ok: false, error: String(e?.message || e) });
              return;
            }
            setTimeout(() => {
              done({ ok: false, error: "Search timed out - reload extension, then refresh HubSpot" });
            }, 15000);
          })
      )
      .catch((e) => ({ ok: false, error: String(e?.message || e) }));
  }

  /** Prefer SW fetch; fall back to hidden extension iframe (HubSpot CSP). */
  async function birdLookupOrder(query) {
    const q = cleanOrderQuery(query);
    if (!q) return { ok: false, error: "Paste full order ID" };

    const viaSw = await lookupViaServiceWorker(q);
    if (viaSw && (viaSw.ok === true || viaSw.error)) return viaSw;

    return lookupViaBridge(q);
  }

  function fillHudSearch(value, { run = true } = {}) {
    const v = String(value || "").trim();
    if (!v) return;
    if (!IS_TOP) {
      try {
        window.top.postMessage({ source: "nosey-little-bird", type: "BIRD_FILL_SEARCH", value: v, run }, "*");
      } catch (_) { /* cross-origin */ }
      return;
    }
    if (!hudSearchInput) return;
    hudSearchInput.value = v;
    if (run && typeof runHudSearch === "function") runHudSearch();
  }

  if (IS_TOP) {
    window.addEventListener("message", (e) => {
      const d = e?.data;
      if (!d || d.source !== "nosey-little-bird" || d.type !== "BIRD_FILL_SEARCH") return;
      fillHudSearch(d.value, { run: d.run !== false });
    });

    hud = document.createElement("div");
    hud.dataset.birdHud = "1";
    hud.style =
      "position:fixed; bottom:10px; left:10px; width:320px; background:rgba(10,10,10,0.95); color:#eee; font-family:monospace; font-size:11px; border:1px solid #444; border-radius:6px; z-index:999999; box-shadow:0 0 15px rgba(0,0,0,0.7); display:flex; flex-direction:column;";
    hud.style.cursor = "move";
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    hud.addEventListener("mousedown", (e) => {
      if (e.target === hudSearchInput || e.target?.closest?.("button")) return;
      if (e.target === hud || hud.contains(e.target)) {
        isDragging = true;
        const rect = hud.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        hud.style.userSelect = "none";
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        hud.style.left = e.clientX - dragOffset.x + "px";
        hud.style.top = e.clientY - dragOffset.y + "px";
        hud.style.right = "auto";
        hud.style.bottom = "auto";
      }
    });
    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        hud.style.userSelect = "";
      }
    });

    const hudBar = document.createElement("div");
    hudBar.style =
      "display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #333;cursor:move;";
    const hudTitle = document.createElement("span");
    hudTitle.textContent = "BIRD HUD";
    hudTitle.style = "font-size:10px;color:#666;letter-spacing:0.5px;";
    hudBar.appendChild(hudTitle);
    hud.appendChild(hudBar);

    const searchWrap = document.createElement("div");
    hudSearchWrap = searchWrap;
    searchWrap.style = "padding:6px 8px;border-bottom:1px solid #333;";
    searchWrap.addEventListener("mousedown", (e) => e.stopPropagation());
    const searchRow = document.createElement("div");
    searchRow.style = "display:flex;gap:4px;";
    hudSearchInput = document.createElement("input");
    hudSearchInput.type = "text";
    hudSearchInput.placeholder = "Order ID lookup";
    hudSearchInput.autocomplete = "off";
    hudSearchInput.spellcheck = false;
    hudSearchInput.style =
      "flex:1;min-width:0;padding:5px 6px;background:#000;color:#eee;border:1px solid #444;border-radius:3px;font-size:10px;font-family:monospace;";
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.textContent = "GO";
    searchBtn.style =
      "cursor:pointer;font-size:10px;font-weight:bold;font-family:monospace;background:#222;border:1px solid #444;border-radius:3px;padding:4px 8px;color:#ff9800;";
    hudSearchOut = document.createElement("div");
    hudSearchOut.style = "margin-top:6px;font-size:10px;color:#888;line-height:1.35;min-height:1.2em;";
    hudSearchOut.textContent = "Click an orange order ID to look up";
    runHudSearch = async function runHudSearchFn() {
      const q = hudSearchInput.value.trim();
      if (!q) {
        hudSearchOut.style.color = "#888";
        hudSearchOut.textContent = "Paste full order ID";
        return;
      }
      hudSearchOut.style.color = "#888";
      hudSearchOut.textContent = "Searching…";
      const resp = await birdLookupOrder(q);
      if (!resp?.ok) {
        hudSearchOut.style.color = "#f44";
        hudSearchOut.textContent = resp?.error || "Search failed";
        return;
      }
      if (!resp.order) {
        hudSearchOut.style.color = "#888";
        hudSearchOut.textContent = "No order found (try flipping O/0)";
        return;
      }
      if (resp.corrected && resp.queryUsed && hudSearchInput) {
        hudSearchInput.value = resp.queryUsed;
      }
      const staff = resp.order.staff || "??";
      const status = resp.order.status || "??";
      const oid = resp.order.id || q;
      const note = String(resp.order.note || "").trim();
      hudSearchOut.style.color = "#eee";
      const fix = resp.corrected
        ? ` <span style="color:#666;font-size:9px">(O/0→${resp.queryUsed})</span>`
        : "";
      const noteHtml = note
        ? `<div style="color:#ffcc80;font-size:10px;margin-top:4px;line-height:1.35">Note: ${note
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</div>`
        : "";
      hudSearchOut.innerHTML = `<span style="color:#ff9800;font-weight:bold">${staff}</span> · <span style="color:#4caf50;font-weight:bold">${status}</span>${fix}${noteHtml}`;
      if (FEATURES.birdBrain) {
        saveHistorySight({
          id: oid,
          user: staff,
          status,
          createdAtMs: resp.order.createdAtMs || null,
          note: note || "",
          source: "lookup",
        });
      }
    };
    searchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      runHudSearch();
    });
    hudSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runHudSearch();
      }
    });
    searchRow.appendChild(hudSearchInput);
    searchRow.appendChild(searchBtn);
    searchWrap.appendChild(searchRow);
    searchWrap.appendChild(hudSearchOut);
    hud.appendChild(searchWrap);

    if (document.body) document.body.appendChild(hud);
    else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(hud));

    loreBox = document.createElement("div");
    loreBox.style = "padding:8px; max-height:180px; overflow-y:auto; display:none;";
    hud.appendChild(loreBox);

    chrome.storage.local.get(
      { hubspotDarkMode: true, showHudPaused: false, showHudSearch: true },
      (d) => {
        applyHubspotDark(!!d.hubspotDarkMode);
        // Drop legacy HUD lookup list (lookups belong in Bird Brain page only)
        chrome.storage.local.remove("birdBrainLog");
        applyHudPausedVisible(!!d.showHudPaused);
        applyHudSearchVisible(d.showHudSearch !== false);
      }
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.showHudPaused) applyHudPausedVisible(!!changes.showHudPaused.newValue);
      if (changes.showHudSearch) applyHudSearchVisible(changes.showHudSearch.newValue !== false);
    });
  }

  /** Write to Bird Brain history (dev build only). */
  function saveHistorySight(sight) {
    if (!FEATURES.birdBrain) return;
    const id = String(sight?.id || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!id) return;
    const now = Date.now();
    const max = FEATURES.historyMaxEntries || 2000;
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = (data.history || []).filter(
        (i) => String(i.id || "").toUpperCase() !== id
      );
      const placedMs =
        sight.createdAtMs && Number.isFinite(sight.createdAtMs) ? sight.createdAtMs : null;
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
      chrome.storage.local.set({ history: [entry, ...history].slice(0, max) });
    });
  }

  function syncLoreBoxVisible() {
    if (!loreBox) return;
    loreBox.style.display = hudShowPaused && hudOrderIds.length ? "" : "none";
  }

  function syncHudShell() {
    if (!hud) return;
    const show = hudShowSearch || hudShowPaused;
    hud.style.display = show ? "flex" : "none";
    if (hudSearchWrap) hudSearchWrap.style.display = hudShowSearch ? "" : "none";
    // Title-only husk when paused on but empty: still show shell so user knows HUD exists
    syncLoreBoxVisible();
  }

  function clearHudPausedRows() {
    hudOrderIds.slice().forEach((id) => {
      const row = hudRows.get(id);
      if (row?.el) row.el.remove();
      hudRows.delete(id);
    });
    hudOrderIds.length = 0;
    if (loreBox) {
      while (loreBox.firstChild) loreBox.removeChild(loreBox.firstChild);
    }
  }

  function applyHudSearchVisible(on) {
    hudShowSearch = !!on;
    if (!on) {
      if (hudSearchInput) hudSearchInput.value = "";
      if (hudSearchOut) {
        hudSearchOut.style.color = "#888";
        hudSearchOut.textContent = "Click an orange order ID to look up";
      }
    }
    syncHudShell();
  }

  function applyHudPausedVisible(on) {
    hudShowPaused = !!on;
    if (loreBox) loreBox.dataset.showPaused = on ? "1" : "0";
    if (on) refreshHubspotHud();
    else clearHudPausedRows();
    syncHudShell();
  }

  function moveToFront(id) {
    const idx = hudOrderIds.indexOf(id);
    if (idx >= 0) hudOrderIds.splice(idx, 1);
    hudOrderIds.unshift(id);
    while (hudOrderIds.length > 8) {
      const evict = hudOrderIds.pop();
      const row = hudRows.get(evict);
      if (row?.el) row.el.remove();
      hudRows.delete(evict);
    }
  }

  function renderRow(id) {
    const row = hudRows.get(id);
    if (!row?.el) return;
    const staff = row.staff && row.staff !== "??" ? row.staff : "??";
    const right = row.note || row.status || "SEEN";
    row.el.style = `padding:5px; border-bottom:1px solid #222; cursor:default; display:flex; justify-content:space-between; color:${row.color || "#888"}`;
    row.el.innerHTML = `
      <div style="min-width:0; flex:1;">
        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><b>${id}</b></div>
        <div style="font-size:10px; opacity:0.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <span style="color:#ff9800; font-weight:bold;">${staff}</span>
        </div>
      </div>
      <div style="margin-left:8px; white-space:nowrap; font-weight:bold; color:${row.color || "#bbb"};">${right}</div>
    `;
  }

  /** Paused-only rows in the HUD list (lookups go to Bird Brain page). */
  function upsertHudOrder(update) {
    if (!IS_TOP || !loreBox) return;
    const id = String(update?.id || "").trim().toUpperCase();
    if (!id) return;
    const status = String(update.status || "").toLowerCase();
    if (status !== "paused") return;

    let row = hudRows.get(id);
    if (!row) {
      const el = document.createElement("div");
      row = {
        el,
        staff: update.staff || "??",
        status: update.status || "paused",
        satFor: update.satFor ?? null,
        note: "PAUSED",
        color: "#00e5ff",
      };
      hudRows.set(id, row);
    } else {
      if (update.staff != null) row.staff = update.staff;
      row.status = update.status || "paused";
      row.note = "PAUSED";
      row.color = "#00e5ff";
    }
    moveToFront(id);
    while (loreBox.firstChild) loreBox.removeChild(loreBox.firstChild);
    hudOrderIds.forEach((rid) => {
      const r = hudRows.get(rid);
      if (r?.el) loreBox.appendChild(r.el);
    });
    renderRow(id);
    syncLoreBoxVisible();
  }

  // === ORDER ID + DODO HIGHLIGHT / CLICK-TO-COPY ===
  const ORDER_ID_RE = /\b[A-Z0-9]{14}\b/g;
  // ACNH dodo: 5 chars, must mix letter+digit (not a plain word). No I/O/Z (Nintendo charset).
  // Same idea as ACNHSuperPoker vision_guided.DODO_RE.
  const DODO_RE =
    /\b(?=[A-HJ-NP-Y0-9]*\d)(?=[A-HJ-NP-Y0-9]*[A-HJ-NP-Y])[A-HJ-NP-Y0-9]{5}\b/gi;
  const DODO_BLOCKLIST = new Set([
    "FILES",
    "EMPTY",
    "LOCAL",
    "GATES",
    "ERROR",
    "CLOSE",
    "READY",
    "START",
    "GATE5",
    "CODE0",
  ]);
  const BIRD_STYLE_ATTR = "data-bird-style";
  const STYLE_TEXT = `
.bird-id-hit { color: #00e5ff !important; font-weight: bold; text-decoration: underline; }
.bird-id-copyable { color: #ff9800 !important; font-weight: bold; }
.bird-dodo-copyable { color: #e040fb !important; font-weight: bold; letter-spacing: 0.04em; }
.bird-id-clickable { cursor: pointer !important; }
.bird-id-clickable:hover { opacity: 0.8; }
.bird-hud-bounce { animation: birdHudBounce 0.6s ease-out 2; }
@keyframes birdHudBounce {
  0%, 100% { transform: scale(1); }
  25% { transform: scale(1.02); }
  50% { transform: scale(0.98); }
  75% { transform: scale(1.01); }
}
.bird-hud-flash { animation: birdFlash 0.8s ease-in-out 2; }
@keyframes birdFlash {
  0%   { background-color: rgba(76, 175, 80, 0.05); }
  50%  { background-color: rgba(76, 175, 80, 0.2); }
  100% { background-color: rgba(76, 175, 80, 0.05); }
}
.bird-page-flash { animation: birdFlash 0.8s ease-in-out 2 !important; }
.bird-page-bounce { animation: birdHudBounce 0.6s ease-out 2 !important; }
`;

  let applyingHighlight = false;

  function injectBirdStyles(root) {
    const host = root === document ? document.head || document.documentElement : root;
    if (!host || host.querySelector?.(`style[${BIRD_STYLE_ATTR}]`)) return;
    const style = document.createElement("style");
    style.setAttribute(BIRD_STYLE_ATTR, "1");
    style.textContent = STYLE_TEXT;
    host.appendChild(style);
  }

  injectBirdStyles(document);

  function isInsideBirdHud(node) {
    return !!(hud && node && hud.contains(node));
  }

  function isBirdIdSpan(el) {
    return !!(
      el &&
      el.classList &&
      (el.classList.contains("bird-id-hit") ||
        el.classList.contains("bird-id-copyable") ||
        el.classList.contains("bird-dodo-copyable") ||
        el.classList.contains("bird-id-clickable"))
    );
  }

  function makeCopySpan(value, kind, isHudMatch) {
    const span = document.createElement("span");
    const color =
      kind === "dodo" ? "#e040fb" : isHudMatch ? "#00e5ff" : "#ff9800";
    span.className =
      kind === "dodo"
        ? "bird-dodo-copyable bird-id-clickable"
        : isHudMatch
          ? "bird-id-hit bird-id-clickable"
          : "bird-id-copyable bird-id-clickable";
    span.textContent = value;
    span.title =
      kind === "dodo"
        ? "Click to copy dodo code"
        : "Click to copy (fills bird HUD search when HUD is on)";
    if (kind === "dodo") span.dataset.birdDodo = value;
    else span.dataset.birdOrderId = value;
    span.style.cssText =
      kind === "dodo"
        ? `color:${color}!important;font-weight:bold;letter-spacing:0.04em;cursor:pointer;`
        : isHudMatch
          ? `color:${color}!important;font-weight:bold;text-decoration:underline;cursor:pointer;`
          : `color:${color}!important;font-weight:bold;cursor:pointer;`;
    span.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(value).catch(() => {});
        if (kind === "order") {
          chrome.storage.local.get({ showHudSearch: true }, (d) => {
            if (d.showHudSearch !== false) fillHudSearch(value, { run: true });
          });
        }
        const orig = span.textContent;
        span.textContent = "COPIED";
        span.style.color = "#4caf50";
        setTimeout(() => {
          span.textContent = orig;
          span.style.color = color;
        }, 1000);
      },
      true
    );
    return span;
  }

  function collectCopyTargets(text) {
    const hits = [];
    let m;
    ORDER_ID_RE.lastIndex = 0;
    while ((m = ORDER_ID_RE.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, kind: "order", value: m[0] });
    }
    DODO_RE.lastIndex = 0;
    while ((m = DODO_RE.exec(text)) !== null) {
      const value = m[0].toUpperCase();
      if (DODO_BLOCKLIST.has(value)) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, kind: "dodo", value });
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let lastEnd = -1;
    for (const h of hits) {
      if (h.start < lastEnd) continue;
      out.push(h);
      lastEnd = h.end;
    }
    return out;
  }

  let highlightTimer = null;
  function scheduleHighlight() {
    if (applyingHighlight) return;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      chrome.storage.local.get({ pausedOrders: [] }, (data) => {
        const paused = (data.pausedOrders || []).filter(
          (p) => p && (p.status || "").toLowerCase() === "paused"
        );
        highlightHubspotMatches(paused);
      });
    }, 150);
  }

  const observedRoots = new WeakSet();
  const birdMo = new MutationObserver(() => {
    if (!applyingHighlight) scheduleHighlight();
  });

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    try {
      birdMo.observe(root, { childList: true, subtree: true, characterData: true });
    } catch (_) {
      /* closed or detached */
    }
  }

  observeRoot(document.documentElement);

  function collectRoots(start) {
    const roots = [];
    const stack = [start];
    while (stack.length) {
      const root = stack.pop();
      if (!root) continue;
      roots.push(root);
      observeRoot(root === document ? document.documentElement : root);
      injectBirdStyles(root === document ? document : root);
      const scope = root === document ? document.body : root;
      if (!scope || !scope.querySelectorAll) continue;
      scope.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) stack.push(el.shadowRoot);
      });
    }
    return roots;
  }

  function wrapMatchesInTextNode(textNode, pausedIds) {
    const parent = textNode.parentNode;
    if (!parent || isBirdIdSpan(parent) || isInsideBirdHud(textNode)) return false;
    const text = textNode.textContent || "";
    const hits = collectCopyTargets(text);
    if (!hits.length) return false;

    const frag = document.createDocumentFragment();
    let last = 0;
    for (const h of hits) {
      if (h.start > last) frag.appendChild(document.createTextNode(text.slice(last, h.start)));
      frag.appendChild(
        makeCopySpan(h.value, h.kind, h.kind === "order" && pausedIds.has(h.value))
      );
      last = h.end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    parent.replaceChild(frag, textNode);
    return true;
  }

  function findBirdIdSpan(id) {
    const roots = collectRoots(document);
    for (const root of roots) {
      const scope = root === document ? document : root;
      const hit = scope.querySelector?.(`[data-bird-order-id="${id}"]`);
      if (hit) return hit;
    }
    return null;
  }

  function textLooksInteresting(t) {
    if (!t || t.length < 5) return false;
    if (/[A-Z0-9]{14}/i.test(t)) return true;
    DODO_RE.lastIndex = 0;
    const ok = DODO_RE.test(t);
    DODO_RE.lastIndex = 0;
    return ok;
  }

  function isExactDodoText(s) {
    const t = String(s || "").trim().toUpperCase();
    if (t.length !== 5 || DODO_BLOCKLIST.has(t)) return false;
    DODO_RE.lastIndex = 0;
    const m = t.match(DODO_RE);
    DODO_RE.lastIndex = 0;
    return !!(m && m.length === 1 && m[0].toUpperCase() === t);
  }

  function decorateExactDodoBubbles(scope, pausedIds) {
    // HubSpot often splits short messages into several text nodes; decorate the
    // deepest element whose full innerText is exactly a dodo (e.g. "1SSX5").
    const nodes = scope.querySelectorAll("div, span, p, li, td, button");
    const exact = [];
    for (const el of nodes) {
      if (isInsideBirdHud(el) || isBirdIdSpan(el)) continue;
      if (el.dataset.birdDodoBound === "1") continue;
      if (!isExactDodoText(el.innerText || "")) continue;
      exact.push(el);
    }
    for (const el of exact) {
      if (exact.some((other) => other !== el && el.contains(other))) continue;
      const value = String(el.innerText || "").trim().toUpperCase();
      el.dataset.birdDodoBound = "1";
      el.dataset.birdDodo = value;
      el.classList.add("bird-dodo-copyable", "bird-id-clickable");
      el.title = "Click to copy dodo code";
      el.style.setProperty("color", "#e040fb", "important");
      el.style.setProperty("font-weight", "bold", "important");
      el.style.setProperty("cursor", "pointer", "important");
      el.style.setProperty("letter-spacing", "0.04em", "important");
      if (!el._birdDodoClick) {
        el._birdDodoClick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          navigator.clipboard.writeText(value).catch(() => {});
          const orig = el.textContent;
          el.textContent = "COPIED";
          el.style.setProperty("color", "#4caf50", "important");
          setTimeout(() => {
            // Prefer restoring original DOM text if React hasn't replaced us
            if (el.textContent === "COPIED") el.textContent = orig;
            el.style.setProperty("color", "#e040fb", "important");
          }, 1000);
        };
        el.addEventListener("click", el._birdDodoClick, true);
      }
    }
  }

  function highlightHubspotMatches(pausedList) {
    const pausedIds = new Set((pausedList || []).map((p) => p.id).filter(Boolean));
    applyingHighlight = true;
    try {
      hudOrderIds.forEach((id) => {
        const row = hudRows.get(id);
        if (row?.el) row.el.classList.remove("bird-hud-flash", "bird-hud-bounce");
      });

      const roots = collectRoots(document);
      for (const root of roots) {
        const scope = root === document ? document.body : root;
        if (!scope) continue;

        const texts = [];
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (isInsideBirdHud(node)) continue;
          if (isBirdIdSpan(node.parentElement)) continue;
          if (!textLooksInteresting(node.textContent || "")) continue;
          texts.push(node);
        }
        for (const tn of texts) {
          if (!tn.isConnected) continue;
          wrapMatchesInTextNode(tn, pausedIds);
        }
        decorateExactDodoBubbles(scope, pausedIds);
      }

      if (IS_TOP) {
        pausedIds.forEach((id) => {
          const row = hudRows.get(id);
          if (!row?.el) return;
          const hit = findBirdIdSpan(id);
          if (hit) {
            row.el.classList.add("bird-hud-bounce", "bird-hud-flash");
            hit.classList.add("bird-page-bounce", "bird-page-flash");
          }
        });
      }
    } finally {
      applyingHighlight = false;
    }
  }

  function refreshHubspotHud() {
    chrome.storage.local.get({ pausedOrders: [], showHudPaused: false }, (data) => {
      let paused = (data.pausedOrders || []).filter(
        (p) => p && (p.status || "").toLowerCase() === "paused"
      );
      const sortTs = (p) => p.orderDateTs ?? p.pausedAt ?? 0;
      paused = paused.slice().sort((a, b) => sortTs(b) - sortTs(a));

      if (IS_TOP && loreBox && data.showHudPaused) {
        const keep = new Set(paused.map((p) => String(p.id || "").toUpperCase()).filter(Boolean));
        hudOrderIds.slice().forEach((id) => {
          if (!keep.has(id)) {
            const row = hudRows.get(id);
            if (row?.el) row.el.remove();
            hudRows.delete(id);
            const idx = hudOrderIds.indexOf(id);
            if (idx >= 0) hudOrderIds.splice(idx, 1);
          }
        });
        paused.forEach((p) => {
          if (!p?.id) return;
          upsertHudOrder({
            id: p.id,
            staff: p.staff,
            status: p.status,
            note: "PAUSED",
            color: "#00e5ff",
          });
        });
        syncLoreBoxVisible();
      }

      highlightHubspotMatches(paused);
    });
  }

  if (IS_TOP) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "HUD_UPSERT" && message.id) {
        upsertHudOrder({
          id: message.id,
          staff: message.staff,
          status: message.status,
          satFor: message.satFor,
          note: message.note,
          color: message.color,
        });
      }
      if (message.type === "LORE_UPDATE" && message.entry) {
        const e = message.entry;
        const color = e.status === "CLAIMED" ? "#00ff00" : "#ff4444";
        upsertHudOrder({
          id: e.id,
          staff: e.user,
          status: e.status,
          satFor: e.satFor,
          note: null,
          color,
        });
      }
    });
  }

  refreshHubspotHud();
  // storage changes cover most updates; interval is a light safety net (not 1Hz)
  setInterval(refreshHubspotHud, FEATURES.hudRefreshMs || 8000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pausedOrders || changes.showHudPaused) refreshHubspotHud();
  });
}
