const isHubspot = location.hostname.includes('app.hubspot.com');
const isStrobe = location.hostname.includes('strobe.gg');

// === BIRD BRAIN HUD SETUP (HubSpot only) ===
let hud, loreBox;
if (isHubspot) {
    hud = document.createElement('div');
    hud.style = 'position:fixed; bottom:10px; right:10px; width:320px; background:rgba(10,10,10,0.95); color:#eee; font-family:monospace; font-size:11px; border:1px solid #444; border-radius:6px; z-index:999999; box-shadow:0 0 15px rgba(0,0,0,0.7); display:flex; flex-direction:column;';
    hud.style.cursor = 'move';
    hud.draggable = false;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    hud.addEventListener('mousedown', (e) => {
        if (e.target === hud || hud.contains(e.target)) {
            isDragging = true;
            const rect = hud.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
            hud.style.userSelect = 'none';
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            hud.style.left = (e.clientX - dragOffset.x) + 'px';
            hud.style.top = (e.clientY - dragOffset.y) + 'px';
            hud.style.right = 'auto';
            hud.style.bottom = 'auto';
        }
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            hud.style.userSelect = '';
        }
    });
    document.body.appendChild(hud);

    // Bottom Section: Vanished Lore (Recent 6) - no ticker header on HubSpot
    loreBox = document.createElement('div');
    loreBox.style = 'padding:8px; max-height:180px; overflow-y:auto;';
    hud.appendChild(loreBox);
}

// --- HUD LIVE LIST (max 5 orders) ---
const hudRows = new Map(); // id -> { el, staff, status, satFor, note, color }
const hudOrderIds = []; // most-recent first

function moveToFront(id) {
    const idx = hudOrderIds.indexOf(id);
    if (idx >= 0) hudOrderIds.splice(idx, 1);
    hudOrderIds.unshift(id);
    while (hudOrderIds.length > 5) {
        const evict = hudOrderIds.pop();
        const row = hudRows.get(evict);
        if (row?.el) row.el.remove();
        hudRows.delete(evict);
    }
}

function renderRow(id) {
    const row = hudRows.get(id);
    if (!row) return;
    const staff = row.staff && row.staff !== "??" ? row.staff : "??";
    const right = row.note || "SEEN";
    // Show staff and right only (no status label - avoids duplicate "Paused")

    row.el.style = `padding:5px; border-bottom:1px solid #222; cursor:default; display:flex; justify-content:space-between; color:${row.color || "#888"}`;
    row.el.innerHTML = `
      <div style="min-width:0; flex:1;">
        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><b>${id}</b></div>
        <div style="font-size:10px; opacity:0.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <span style="color:#ff9800; font-weight:bold;">${staff}</span>
        </div>
      </div>
      <div style="margin-left:8px; white-space:nowrap; font-weight:bold; color:#bbb;">${right}</div>
    `;
}

function upsertHudOrder(update) {
    if (!isHubspot) return; // HUD only exists on HubSpot
    const id = update?.id;
    if (!id) return;
    const allowCreate = !!update.allowCreate;
    const existing = hudRows.get(id);
    
    if (!existing && !allowCreate) {
        return;
    }
    if (!existing && allowCreate) {
        const el = document.createElement('div');
        hudRows.set(id, {
            el,
            staff: update.staff,
            status: update.status,
            satFor: update.satFor,
            note: update.note,
            color: update.color
        });
        loreBox.appendChild(el);
    } else {
        if (update.staff != null) existing.staff = update.staff;
        if (update.status != null) existing.status = update.status;
        if (update.satFor != null) existing.satFor = update.satFor;
        if (update.note != null) existing.note = update.note;
        if (update.color != null) existing.color = update.color;
    }

    // On the HubSpot inbox, only keep orders that are explicitly Paused
    const row = hudRows.get(id);
    const status = row?.status || update.status;
    if (!status || status.toLowerCase() !== "paused") {
        // Remove non-paused rows from the HubSpot HUD
        const idx = hudOrderIds.indexOf(id);
        if (idx >= 0) hudOrderIds.splice(idx, 1);
        if (row?.el) row.el.remove();
        hudRows.delete(id);
        return;
    }

    moveToFront(id);
    // ensure DOM order matches recency (most recent at TOP)
    for (let i = 0; i < hudOrderIds.length; i++) {
        const rid = hudOrderIds[i];
        const row = hudRows.get(rid);
        if (row?.el) loreBox.appendChild(row.el);
    }
    // (re)render after order correction - especially important for new rows
    renderRow(id);
}

// === STYLES FOR HIGHLIGHTING ===
const style = document.createElement('style');
style.textContent = `
.bird-id-hit { color: #00e5ff !important; font-weight: bold; text-decoration: underline; }
.bird-id-copyable { color: #ff9800 !important; font-weight: bold; }
.bird-id-clickable { cursor: pointer !important; }
.bird-id-clickable:hover { opacity: 0.8; }
.bird-staff-hit { color: #ff9800 !important; font-weight: bold; text-decoration: underline; }
.bird-status-hit { color: #4caf50 !important; font-weight: bold; text-decoration: underline; }
h1.bird-view-hit { text-shadow: 0 0 10px rgba(255, 152, 0, 0.65); }
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
document.head.appendChild(style);

// Order timers (Strobe only). 4-min marker = when anyone can take; Bird Alert = when to whistle.
const FOUR_MIN_SECONDS = 240; // Orders can be taken by anyone after 4 min; only on-shift before that.
const THREAT_SECONDS = { high: 240, medium: 360, low: 480 }; // Bird Alert: 4m, 6m, 8m (whistle only)
const WHISTLE_COOLDOWN_MS = 4 * 60 * 1000; // 4 minutes cooldown between whistles
const orderTimers = new Map(); // id -> { startTs, element, countdownEl, lastTimeText }
const whistledOrderIds = new Set();
let lastWhistleTime = 0;

function getCountdownSecondsForThreatLevel(threatLevel) {
    return THREAT_SECONDS[threatLevel] ?? THREAT_SECONDS.high;
}

function wrapNthIfMissing(html, regex, className, preferIndex) {
    if (!html || html.includes(`class="${className}"`)) return html;
    const matches = [...html.matchAll(regex)];
    if (!matches.length) return html;
    const chosen = matches[preferIndex] || matches[0];
    const i = chosen.index;
    if (i == null) return html;
    const needle = chosen[0];
    return html.slice(0, i) + `<span class="${className}">${needle}</span>` + html.slice(i + needle.length);
}

// Wrap first text node matching regex in a span (does not replace card innerHTML, so page time can update)
function wrapFirstTextMatch(card, regex, className) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        const m = text.match(regex);
        if (!m) continue;
        const match = m[0];
        const idx = text.indexOf(match);
        if (idx === -1) continue;
        const parent = node.parentNode;
        if (parent.classList && (parent.classList.contains(className) || parent.classList.contains('bird-id-clickable'))) continue;
        const before = text.slice(0, idx);
        const after = text.slice(idx + match.length);
        const span = document.createElement('span');
        span.className = className;
        span.textContent = match;
        if (before) {
            const beforeNode = document.createTextNode(before);
            parent.insertBefore(beforeNode, node);
        }
        parent.insertBefore(span, node);
        if (after) {
            const afterNode = document.createTextNode(after);
            parent.insertBefore(afterNode, node);
        }
        parent.removeChild(node);
        return;
    }
}

// Replace only one text node containing exactly `id` with a clickable span (preserves rest of card so page time can update)
function wrapIdOnly(card, id) {
    if (card.querySelector('.bird-id-clickable')) return;
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = (node.textContent || "").trim();
        if (text === id) {
            const span = document.createElement('span');
            span.className = 'bird-id-hit bird-id-clickable';
            span.textContent = id;
            span.title = 'Click to copy';
            span.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                navigator.clipboard.writeText(id);
                const orig = span.textContent;
                span.textContent = 'COPIED';
                span.style.color = '#4caf50';
                setTimeout(() => { span.textContent = orig; span.style.color = ''; }, 1000);
            };
            node.parentNode.replaceChild(span, node);
            return;
        }
    }
}

// Wrap order ID in HubSpot page with HUD-match (cyan) or copyable-only (orange) styling.
function wrapOrderIdInElementForHubspot(root, orderId, isHudMatch) {
    const spans = root.querySelectorAll ? root.querySelectorAll('.bird-id-hit, .bird-id-copyable') : [];
    if ([...spans].some(s => s.textContent.trim() === orderId)) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        const idx = text.indexOf(orderId);
        if (idx === -1) continue;
        const parent = node.parentNode;
        if (parent.classList && (parent.classList.contains('bird-id-hit') || parent.classList.contains('bird-id-copyable') || parent.classList.contains('bird-id-clickable'))) continue;
        const before = text.slice(0, idx);
        const after = text.slice(idx + orderId.length);
        const span = document.createElement('span');
        span.className = isHudMatch ? 'bird-id-hit bird-id-clickable' : 'bird-id-copyable bird-id-clickable';
        span.textContent = orderId;
        span.title = 'Click to copy';
        span.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            navigator.clipboard.writeText(orderId);
            const orig = span.textContent;
            span.textContent = 'COPIED';
            span.style.color = '#4caf50';
            setTimeout(() => { span.textContent = orig; span.style.color = ''; }, 1000);
        };
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);
        return true;
    }
    return false;
}

// Wrap only the order ID text inside root (not the whole node). Returns true if wrapped.
function wrapOrderIdInElement(root, orderId) {
    if (root.querySelector && root.querySelector('.bird-id-hit')) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        const idx = text.indexOf(orderId);
        if (idx === -1) continue;
        const parent = node.parentNode;
        if (parent.classList && (parent.classList.contains('bird-id-hit') || parent.classList.contains('bird-id-clickable'))) continue;
        const before = text.slice(0, idx);
        const after = text.slice(idx + orderId.length);
        const span = document.createElement('span');
        span.className = 'bird-id-hit bird-id-clickable';
        span.textContent = orderId;
        span.title = 'Click to copy';
        span.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            navigator.clipboard.writeText(orderId);
            const orig = span.textContent;
            span.textContent = 'COPIED';
            span.style.color = '#4caf50';
            setTimeout(() => { span.textContent = orig; span.style.color = ''; }, 1000);
        };
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);
        return true;
    }
    return false;
}

function highlightHubspotMatches(pausedList) {
    if (!isHubspot) return;
    const pausedIds = new Set((pausedList || []).map(p => p.id));

    // Clear previous HUD and page animation state
    hudOrderIds.forEach(id => {
        const row = hudRows.get(id);
        if (row?.el) row.el.classList.remove('bird-hud-flash', 'bird-hud-bounce');
    });
    document.querySelectorAll('.bird-page-flash').forEach(el => {
        if (!hud.contains(el)) el.classList.remove('bird-page-flash', 'bird-page-bounce');
    });

    // For each paused ID in the HUD, if it's on the page: highlight ID, bounce+flash HUD row and the element on the page
    hudOrderIds.forEach(id => {
        if (!pausedIds.has(id)) return;
        const row = hudRows.get(id);
        if (!row?.el) return;

        let foundOnPage = false;
        let pageNode = null;
        const nodes = document.querySelectorAll('span, div, a');
        for (const node of nodes) {
            if (hud.contains(node)) continue;
            const text = (node.textContent || "").trim();
            if (!text.includes(id)) continue;
            foundOnPage = true;
            pageNode = node;
            wrapOrderIdInElementForHubspot(node, id, true);
            break;
        }

        if (foundOnPage) {
            row.el.classList.add('bird-hud-bounce', 'bird-hud-flash');
            // Flash only the order ID span on the page, not the whole container
            const idSpan = pageNode && (pageNode.querySelector('.bird-id-hit') || pageNode.querySelector('.bird-id-copyable'));
            if (idSpan && idSpan.textContent.trim() === id) idSpan.classList.add('bird-page-bounce', 'bird-page-flash');
        }
    });

    // Wrap all other order IDs on the page (not in HUD) with click-to-copy, orange styling
    const allIds = new Set();
    document.querySelectorAll('span, div, a, p, td, li').forEach(node => {
        if (hud.contains(node)) return;
        const text = node.innerText || '';
        const matches = text.match(/\b[A-Z0-9]{14}\b/g);
        if (!matches) return;
        matches.forEach(id => {
            if (pausedIds.has(id)) return;
            allIds.add(id);
        });
    });
    allIds.forEach(id => {
        const nodes = document.querySelectorAll('span, div, a, p, td, li');
        for (const node of nodes) {
            if (hud.contains(node)) continue;
            if (!(node.innerText || '').includes(id)) continue;
            if (wrapOrderIdInElementForHubspot(node, id, false)) break;
        }
    });
}

function parseTimeFromText(text) {
    // Look for patterns like "3m 45s", "3:45", "3m", etc. (elapsed time in seconds)
    const timeMatch = text.match(/(\d+)\s*m\s*(\d+)\s*s/i) || text.match(/(\d+):(\d+)/) || text.match(/(\d+)\s*m/i);
    if (!timeMatch) return null;
    const minutes = parseInt(timeMatch[1], 10) || 0;
    const seconds = parseInt(timeMatch[2], 10) || 0;
    return minutes * 60 + seconds;
}

// Elapsed seconds from "X minutes ago" / "4 min ago" / "X hours ago" in card. Use only when creating timer.
function getElapsedSecondsFromCard(card) {
    const text = (card.innerText || '').trim();
    const relMins = text.match(/(\d+)\s*min(?:ute)?s?\s+ago/i);
    if (relMins) return parseInt(relMins[1], 10) * 60;
    const relHours = text.match(/(\d+)\s*hour(s)?\s+ago/i);
    if (relHours) return parseInt(relHours[1], 10) * 60 * 60;
    const relDays = text.match(/(\d+)\s*day(s)?\s+ago/i);
    if (relDays) return parseInt(relDays[1], 10) * 24 * 60 * 60;
    return null;
}

// Get a timestamp for ordering (newest first). Uses <time datetime=""> or parses date/relative time from card text.
function getOrderDateFromCard(card) {
    const timeEl = card.querySelector('time[datetime]');
    if (timeEl && timeEl.getAttribute('datetime')) {
        const d = new Date(timeEl.getAttribute('datetime'));
        if (!isNaN(d.getTime())) return d.getTime();
    }
    const text = (card.innerText || '').trim();
    const now = Date.now();
    // Relative time: "3 hours ago", "2 hours ago", "45 minutes ago", "1 day ago"
    const relHours = text.match(/(\d+)\s*hour(s)?\s+ago/i);
    if (relHours) return now - parseInt(relHours[1], 10) * 60 * 60 * 1000;
    const relMins = text.match(/(\d+)\s*minute(s)?\s+ago/i);
    if (relMins) return now - parseInt(relMins[1], 10) * 60 * 1000;
    const relDays = text.match(/(\d+)\s*day(s)?\s+ago/i);
    if (relDays) return now - parseInt(relDays[1], 10) * 24 * 60 * 60 * 1000;
    const iso = text.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/);
    if (iso) {
        const d = new Date(iso[0]);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    const d1 = text.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
    if (d1) {
        const d = new Date(d1[0]);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    const d2 = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (d2) {
        const d = new Date(d2[0]);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
}

// Start time from page's <time> element. Expects elapsed time like "3M 47S" or "45" (sec).
function startTsFromTimeEl(timeEl) {
    if (!timeEl || !timeEl.innerText) return null;
    const raw = timeEl.innerText.trim();
    const mSeconds = raw.match(/(\d+)\s*m\s*(\d+)\s*s/i);
    if (mSeconds) {
        const minutes = parseInt(mSeconds[1], 10) || 0;
        const seconds = parseInt(mSeconds[2], 10) || 0;
        return Date.now() - (minutes * 60 + seconds) * 1000;
    }
    const val = parseInt(raw, 10) || 0;
    const isSeconds = raw.toLowerCase().includes('sec');
    const offsetMs = (isSeconds ? val : val * 60) * 1000;
    return Date.now() - offsetMs;
}

function formatCountdownTime(seconds) {
    const abs = Math.abs(seconds);
    return `${Math.floor(abs / 60)}M ${abs % 60}S`;
}

// True if any tracked order is at or past the threat-level marker (countdown <= 0).
function isAnyOrderPastMarker(countdownSeconds) {
    const now = Date.now();
    const threshold = countdownSeconds ?? THREAT_SECONDS.high;
    for (const [, timer] of orderTimers) {
        const elapsed = Math.floor((now - timer.startTs) / 1000);
        if (threshold - elapsed <= 0) return true;
    }
    return false;
}

let whistleCtx = null;
function playWhistleIfAllowed() {
    const now = Date.now();
    if (now - lastWhistleTime < WHISTLE_COOLDOWN_MS) return;
    chrome.storage.local.get({ mute: false, volume: 0.5 }, (s) => {
        if (s.mute) return;
        const vol = Math.min(2, Math.max(0, parseFloat(s.volume) || 0.5));
        if (!whistleCtx) whistleCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (whistleCtx.state === 'suspended') whistleCtx.resume();
        const audio = new Audio(chrome.runtime.getURL('whistle.mp3'));
        const src = whistleCtx.createMediaElementSource(audio);
        const gain = whistleCtx.createGain();
        gain.gain.value = vol;
        src.connect(gain);
        gain.connect(whistleCtx.destination);
        audio.play().catch(() => {});
        lastWhistleTime = Date.now();
    });
}

// whistleThresholdSeconds = when to play Bird Alert (from popup). Display always uses 4-min marker.
function updateCountdown(id, card, whistleThresholdSeconds) {
    if (!isStrobe) return;
    let timer = orderTimers.get(id);
    if (!timer) return;

    // Only re-sync when the page's <time> text changes (e.g. "3M 47S" -> "3M 48S") so our countdown keeps rolling
    const timeEl = card.querySelector('time');
    if (timeEl) {
        const timeText = timeEl.innerText.trim().toLowerCase();
        if (!timer.lastTimeText || timeText !== timer.lastTimeText) {
            const start = startTsFromTimeEl(timeEl);
            if (start != null) {
                timer.startTs = start;
                timer.lastTimeText = timeText;
            }
        }
    }

    const elapsed = Math.floor((Date.now() - timer.startTs) / 1000);
    const countdownTo4Min = FOUR_MIN_SECONDS - elapsed; // Always show time until 4 min (anyone can take)

    // Bird Alert (whistle) only when order has sat for the user's chosen threshold (4m/6m/8m)
    const whistleThreshold = whistleThresholdSeconds ?? FOUR_MIN_SECONDS;
    if (elapsed >= whistleThreshold && !whistledOrderIds.has(id)) {
        if (Date.now() - lastWhistleTime >= WHISTLE_COOLDOWN_MS) {
            whistledOrderIds.add(id);
            playWhistleIfAllowed();
        }
    }

    if (!timer.countdownEl) {
        timer.countdownEl = document.createElement('span');
        timer.countdownEl.className = 'bird-timer';
        timer.countdownEl.style.cssText = 'display:block; white-space:nowrap; margin-top:2px; margin-left:0; font-weight:bold; font-size:12px;';
        const idEl = card.querySelector('.bird-id-hit') || card.querySelector('dd.dark\\:text-gray-300');
        const parent = idEl && idEl.parentNode ? idEl.parentNode : card;
        parent.insertBefore(timer.countdownEl, idEl.nextSibling);
    }

    timer.countdownEl.textContent = countdownTo4Min > 0 ? formatCountdownTime(countdownTo4Min) : `READY: ${formatCountdownTime(countdownTo4Min)}`;
    timer.countdownEl.style.color = countdownTo4Min > 30 ? '#4caf50' : (countdownTo4Min > 0 ? '#ff9800' : '#ff4444');
}

// === DOM SCAN + REPORT TO BACKGROUND ===
function scanOrders() {
    const header = document.querySelector('h1');
    const currentView = header ? header.innerText.trim().toUpperCase() : "UNKNOWN";
    if (header && isStrobe) header.classList.add('bird-view-hit');
    const cardList = Array.from(document.querySelectorAll('div.relative.rounded-lg, div.border.rounded-md, li.py-4'));
    // Strobe: sort by visual position (top to bottom) so order matches what the user sees
    if (isStrobe) {
        cardList.sort((a, b) => {
            const topA = a.getBoundingClientRect().top;
            const topB = b.getBoundingClientRect().top;
            return topA - topB;
        });
    }
    const ordersById = new Map();

    cardList.forEach(card => {
        const allIds = (card.innerText.match(/\b[A-Z0-9]{14}\b/g) || []);
        if (!allIds.length) return;
        const staffMatch = card.innerText.match(/@\S+/);
        const staff = staffMatch ? staffMatch[0] : "??";
        const statusMatches = [...card.innerText.matchAll(/\b(Pending|Paused|Completed)\b/gi)];
        const rawStatus = (statusMatches[1] || statusMatches[0])?.[0] || "";
        const statusText = rawStatus ? (rawStatus[0].toUpperCase() + rawStatus.slice(1).toLowerCase()) : "";
        const orderDateTs = isStrobe ? getOrderDateFromCard(card) : null;
        allIds.forEach(id => {
            ordersById.set(id, { id, staff, statusText, orderDateTs: orderDateTs || undefined });
        });
        const firstId = allIds[0];
        if (isStrobe) {
            wrapIdOnly(card, firstId);
            if (!card.querySelector('.bird-staff-hit')) {
                wrapFirstTextMatch(card, /@[^\s<]+/, 'bird-staff-hit');
            }
            if (!card.querySelector('.bird-status-hit')) {
                wrapFirstTextMatch(card, /\b(Pending|Paused|Completed)\b/i, 'bird-status-hit');
            }
            if (currentView === "UNFILLED ORDERS") {
                allIds.forEach(id => {
                    if (!orderTimers.has(id)) {
                        const elapsedSec = getElapsedSecondsFromCard(card);
                        let startTs = elapsedSec != null ? Date.now() - (elapsedSec * 1000) : null;
                        const timeEl = card.querySelector('time');
                        if (startTs == null) startTs = timeEl ? startTsFromTimeEl(timeEl) : null;
                        if (startTs == null) {
                            const parsedSeconds = parseTimeFromText(card.innerText);
                            startTs = parsedSeconds != null ? Date.now() - (parsedSeconds * 1000) : Date.now();
                        }
                        orderTimers.set(id, {
                            startTs,
                            element: card,
                            countdownEl: null,
                            lastTimeText: timeEl ? timeEl.innerText.trim().toLowerCase() : null
                        });
                    }
                    chrome.storage.local.get({ threatLevel: 'high' }, (data) => {
                        updateCountdown(id, card, getCountdownSecondsForThreatLevel(data.threatLevel));
                    });
                });
            } else {
                allIds.forEach(id => {
                    const timer = orderTimers.get(id);
                    if (timer && timer.countdownEl) timer.countdownEl.remove();
                    orderTimers.delete(id);
                    whistledOrderIds.delete(id);
                });
            }
        }
    });

    const orders = Array.from(ordersById.values());
    chrome.runtime.sendMessage({ type: "SIGHTING", view: currentView, orders });

    // On HubSpot inbox pages, hydrate the HUD from the stored Paused orders in exact Strobe order
    if (isHubspot) {
        chrome.storage.local.get({ pausedOrders: [] }, (data) => {
            let paused = (data.pausedOrders || []).filter(p => p && (p.status || '').toLowerCase() === 'paused');
            // Sort newest first (larger timestamp = newer = show first)
            const sortTs = (p) => p.orderDateTs ?? p.pausedAt ?? 0;
            paused = paused.slice().sort((a, b) => (sortTs(b) - sortTs(a)));
            const seenIds = new Set(paused.map(p => p.id));

            // Remove rows that are no longer in the paused list
            hudOrderIds.slice().forEach(id => {
                if (!seenIds.has(id)) {
                    const row = hudRows.get(id);
                    const idx = hudOrderIds.indexOf(id);
                    if (idx >= 0) hudOrderIds.splice(idx, 1);
                    if (row?.el) row.el.remove();
                    hudRows.delete(id);
                }
            });

            // Use exact Strobe order: first in paused = first in HUD
            hudOrderIds.length = 0;
            paused.forEach(p => {
                hudOrderIds.push(p.id);
                let row = hudRows.get(p.id);
                if (!row) {
                    const el = document.createElement('div');
                    row = { el, staff: p.staff, status: p.status, satFor: null, note: 'PAUSED', color: '#00e5ff' };
                    hudRows.set(p.id, row);
                    // Don't append yet – we'll add in order below
                } else {
                    row.staff = p.staff;
                    row.status = p.status;
                    row.note = 'PAUSED';
                    row.color = '#00e5ff';
                }
            });

            // Clear list and re-append in hudOrderIds order so DOM order is guaranteed
            while (loreBox.firstChild) loreBox.removeChild(loreBox.firstChild);
            hudOrderIds.forEach(id => {
                const row = hudRows.get(id);
                if (row?.el) loreBox.appendChild(row.el);
            });
            hudOrderIds.forEach(id => renderRow(id));

            highlightHubspotMatches(paused);
        });
    }
}

// Listen for updates from the background tracker
chrome.runtime.onMessage.addListener((message) => {
    if (isHubspot) {
        if (message.type === "HUD_UPSERT" && message.id) {
            upsertHudOrder({
                id: message.id,
                staff: message.staff,
                status: message.status,
                satFor: message.satFor,
                note: message.note,
                color: message.color
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
                color
            });
        }
    }
});

setInterval(scanOrders, 1000);

// Update countdown timers every second (Strobe only); threshold from popup threat level
if (isStrobe) {
    setInterval(() => {
        chrome.storage.local.get({ threatLevel: 'high' }, (data) => {
            const countdownSecs = getCountdownSecondsForThreatLevel(data.threatLevel);
            orderTimers.forEach((timer, id) => {
                const card = timer.element;
                if (card && document.contains(card)) {
                    updateCountdown(id, card, countdownSecs);
                } else {
                    if (timer.countdownEl) timer.countdownEl.remove();
                    orderTimers.delete(id);
                    whistledOrderIds.delete(id);
                }
            });
            if (!isAnyOrderPastMarker(countdownSecs)) whistledOrderIds.clear();
        });
    }, 1000);
}
