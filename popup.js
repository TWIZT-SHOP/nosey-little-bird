import { ALERT_SOUNDS, DEFAULT_ALERT_SOUND, resolveAlertSrc } from "./alert-sounds.js";
import { FEATURES, buildLabel, IS_DEV } from "./build-profile.js";
import {
  DEFAULT_POLL_INTERVAL_SEC,
  POLL_INTERVAL_OPTIONS,
  normalizePollIntervalSec,
} from "./poll-cadence.js";

function fillPollIntervalSelect(selectedSec) {
  const sel = document.getElementById("pollIntervalSelect");
  if (!sel) return;
  const cur = normalizePollIntervalSec(selectedSec);
  sel.innerHTML = POLL_INTERVAL_OPTIONS.map(
    (o) =>
      `<option value="${o.sec}"${o.sec === cur ? " selected" : ""}>${o.label}</option>`
  ).join("");
}

let testAudio = null;
let testGainNode = null;
let testCtx = null;
// After Save we clear the paste box; don't let updateUI refill it until the user types/pastes again
let keepPasteBoxEmpty = false;

const CUSTOM_SOUND_MAX_BYTES = 1.5 * 1024 * 1024;

function alertSoundOptions() {
    return FEATURES.customAlertSound
        ? ALERT_SOUNDS
        : ALERT_SOUNDS.filter((s) => s.id !== "custom");
}

function fillAlertSoundSelect(selectedId) {
    const sel = document.getElementById("alertSoundSelect");
    if (!sel) return;
    const opts = alertSoundOptions();
    let cur = selectedId || DEFAULT_ALERT_SOUND;
    if (!opts.some((s) => s.id === cur)) cur = DEFAULT_ALERT_SOUND;
    sel.innerHTML = opts.map(
        (s) => `<option value="${s.id}"${s.id === cur ? " selected" : ""}>${s.label}</option>`
    ).join("");
    const customRow = document.getElementById("customSoundRow");
    if (customRow) {
        customRow.classList.toggle("hidden", !FEATURES.customAlertSound || cur !== "custom");
    }
}

function syncCustomSoundStatus(hasCustom) {
    const el = document.getElementById("customSoundStatus");
    if (!el) return;
    if (!FEATURES.customAlertSound) {
        el.textContent = "";
        return;
    }
    el.textContent = hasCustom ? "Custom sound saved" : "Pick an audio file for Custom";
    el.style.color = hasCustom ? "#4caf50" : "#666";
}

function applyBuildUi() {
    const hist = document.getElementById("openHistory");
    if (hist) hist.classList.toggle("hidden", !FEATURES.historyPage);
    const badge = document.getElementById("buildBadge");
    if (badge) {
        badge.textContent = buildLabel();
        badge.classList.toggle("hidden", !FEATURES.showBuildBadge);
        badge.title = IS_DEV
            ? "Dev build — Bird Brain history enabled"
            : "Staff build — lean (no growing history)";
    }
    // Staff: no history writes → hide Previous list + settings toggle
    const prevOn = !!FEATURES.historyPage;
    document.getElementById("previousSection")?.classList.toggle("hidden", !prevOn);
    document.getElementById("showPreviousListRow")?.classList.toggle("hidden", !prevOn);
    if (!prevOn) {
        const cb = document.getElementById("showPreviousList");
        if (cb) cb.checked = false;
    }
}



// --- Schedule: parse CSV, find Nookmart rows, who's on shift at current time in schedule TZ ---
function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '').trim();
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') inQuotes = false;
            else cell += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',' || c === '\t') { row.push(cell.trim()); cell = ''; }
            else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; if (row.some(x => x)) rows.push(row); row = []; }
            else cell += c;
        }
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows;
}

// Serialize a grid back to CSV (escape cells that contain comma, newline, or quote)
function gridToCsv(grid) {
    if (!grid || !grid.length) return '';
    const escape = (cell) => {
        const s = String(cell ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    };
    return grid.map(row => (row || []).map(escape).join(',')).join('\n');
}

// Merge two shift-list grids: keep one header, merge data rows by (section, date, user); second grid wins on duplicate
function mergeScheduleGrids(gridA, gridB) {
    if (!gridB || !gridB.length) return gridA && gridA.length ? gridA : gridB;
    if (!gridA || !gridA.length) return gridB;
    const headerRow = rowLooksLikeHeader(gridA[0]) ? gridA[0] : (rowLooksLikeHeader(gridB[0]) ? gridB[0] : gridA[0]);
    const cols = getColumnIndices(headerRow);
    const key = (row) => [cell(row, cols.section, 0), cell(row, cols.date, 1), cell(row, cols.user, 3)].join('|');
    const isDataRow = (row) => {
        const sec = cell(row, cols.section, 0);
        return /nookmart|overflow/i.test(sec) && (cell(row, cols.date, 1) || cell(row, cols.user, 3));
    };
    const map = new Map();
    const addGrid = (grid) => {
        const { dataStart } = getShiftListMeta(grid);
        for (let r = dataStart; r < grid.length; r++) {
            const row = grid[r];
            if (!row || !row.length) continue;
            if (!isDataRow(row)) continue;
            map.set(key(row), row);
        }
    };
    addGrid(gridA);
    addGrid(gridB);
    return [headerRow, ...Array.from(map.values())];
}

// Detect shift-list format: header with Date/Start/End/Users, or data rows with Nookmart/Overflow + date
const DATE_CELL_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})$/;

function isShiftListFormat(grid) {
    if (!grid.length) return false;
    const row0 = grid[0] || [];
    const hasEnoughCols = row0.length >= 4;
    const hasHeaderLike = row0.some(c => /date|start|end|users?|names?/i.test(String(c ?? '')));
    if (hasEnoughCols && hasHeaderLike) return true;
    if (grid.length > 1) {
        const firstCell = String((grid[1] || [])[0] ?? '').trim();
        const secondCell = String((grid[1] || [])[1] ?? '').trim();
        if (/nookmart|overflow/i.test(firstCell) && DATE_CELL_RE.test(secondCell)) return true;
    }
    return false;
}

// Parse time "17:00:00", "17:00", "1:00", " 1:00 " -> minutes since midnight; empty -> null
function parseTimeMins(s) {
    const t = String(s ?? '').trim();
    if (!t) return null;
    const m = t.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/);
    if (!m) return null;
    const hours = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
}

// Parse date "16/02/26", "16/02/2026", "9/3/26", "7/13/26", "2026-03-09" -> { day, month, year }
function parseRowDate(s, tz) {
    const t = String(s ?? '').trim();
    if (!t) return null;
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        return { year: +iso[1], month: +iso[2] - 1, day: +iso[3] };
    }
    const parts = t.split(/[/-]/).map(p => parseInt(p, 10)).filter(n => !isNaN(n));
    if (parts.length < 3) return null;
    let day, month, year;
    if (parts[0] > 31 && parts[0] >= 100) {
        // Y-M-D
        year = parts[0];
        month = (parts[1] || 1) - 1;
        day = parts[2] || 1;
    } else if (parts[1] > 12) {
        // M/D/Y (US) when day > 12
        month = (parts[0] || 1) - 1;
        day = parts[1];
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    } else if (parts[0] > 12) {
        // D/M/Y when first > 12
        day = parts[0];
        month = (parts[1] || 1) - 1;
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    } else if (parts[2] > 31 || parts[2] >= 100) {
        day = parts[0];
        month = (parts[1] || 1) - 1;
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    } else {
        // Ambiguous small numbers: prefer M/D/Y (US / sheet export)
        month = (parts[0] || 1) - 1;
        day = parts[1] || 1;
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    }
    if (day < 1 || day > 31 || month < 0 || month > 11) return null;
    return { day, month, year };
}

function getNowDateAndMinutesInTimezone(tz) {
    try {
        const d = new Date();
        const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false });
        const dateStr = dateFmt.format(d);
        const timeStr = timeFmt.format(d);
        const dateParts = dateStr.split(/[-/]/).map(Number);
        let y, m, day;
        if (dateParts.length >= 3) {
            if (dateParts[0] > 31) {
                y = dateParts[0]; m = dateParts[1] || 1; day = dateParts[2] || 1;
            } else if (dateParts[2] > 31) {
                day = dateParts[0]; m = dateParts[1] || 1; y = dateParts[2];
            } else {
                y = dateParts[0]; m = dateParts[1] || 1; day = dateParts[2] || 1;
            }
        } else {
            y = d.getFullYear(); m = d.getMonth() + 1; day = d.getDate();
        }
        const timeParts = timeStr.split(':').map(Number);
        const hour = timeParts[0] || 0;
        const minute = timeParts[1] || 0;
        return { day, month: m - 1, year: y, minutes: hour * 60 + minute };
    } catch (e) {
        const d = new Date();
        return {
            day: d.getDate(),
            month: d.getMonth(),
            year: d.getFullYear(),
            minutes: d.getHours() * 60 + d.getMinutes()
        };
    }
}

// Coverage sheet source times are Phoenix (no DST). Used only for who's-on matching - not shown in UI.
const SCHEDULE_TZ = 'America/Phoenix';

// Detect if a row looks like a header (has Date and Start/End/Users)
function rowLooksLikeHeader(row) {
    const cells = (row || []).map(c => String(c ?? '').toLowerCase().trim());
    const hasDate = cells.some(c => /^date$/i.test(c) || /date\s|date$/i.test(c));
    const hasTimeOrUser = cells.some(c => /start|end|begin|users?|names?/i.test(c));
    return hasDate && hasTimeOrUser;
}

// Detect if a row looks like shift data (section + date-like in next columns)
function rowLooksLikeShiftData(row) {
    if (!row || row.length < 2) return false;
    const section = String(row[0] ?? '').trim();
    const dateLike = String(row[1] ?? '').trim();
    if (!/nookmart|overflow/i.test(section)) return false;
    return DATE_CELL_RE.test(dateLike);
}

// Find header row and data start for a messy shift-list grid (optional header, extra columns, empty rows)
function getShiftListMeta(grid) {
    if (!grid || !grid.length) return { headerRow: [], dataStart: 0 };
    const headerRow = grid[0] || [];
    const firstLooksLikeHeader = rowLooksLikeHeader(headerRow);
    const firstLooksLikeData = rowLooksLikeShiftData(grid[0]);
    if (firstLooksLikeData && !firstLooksLikeHeader) {
        return { headerRow: [], dataStart: 0 };
    }
    if (firstLooksLikeHeader) {
        return { headerRow, dataStart: 1 };
    }
    for (let i = 1; i < Math.min(grid.length, 5); i++) {
        if (rowLooksLikeHeader(grid[i])) {
            return { headerRow: grid[i] || [], dataStart: i + 1 };
        }
    }
    return { headerRow, dataStart: 1 };
}

// Resolve column indices from header (or fallbacks when header is missing/weird)
function getColumnIndices(header) {
    const h = (header || []).map(c => String(c ?? '').toLowerCase().trim());
    const idx = (re, fallback) => {
        const i = h.findIndex(c => re.test(c));
        return i >= 0 ? i : fallback;
    };
    return {
        section: h.some(c => /section|type|role/i.test(c)) ? idx(/section|type|role/i, 0) : 0,
        date: idx(/date/i, 1),
        user: idx(/users?|names?/i, 3),
        start: idx(/start|begin/i, 4),
        end: idx(/end/i, 5)
    };
}

// Safe cell getter for a row (handles short rows, undefined)
function cell(row, col, fallbackCol) {
    const val = row[col] ?? row[fallbackCol];
    return val != null ? String(val).trim() : '';
}

function getOnShiftFromList(grid, tz, sectionRegex) {
    const now = getNowDateAndMinutesInTimezone(tz);
    const names = [];
    const { headerRow, dataStart } = getShiftListMeta(grid);
    const cols = getColumnIndices(headerRow);
    for (let r = dataStart; r < grid.length; r++) {
        const row = grid[r];
        if (!row || !row.length) continue;
        const section = cell(row, cols.section, 0);
        if (!section || !sectionRegex.test(section)) continue;
        const user = cell(row, cols.user, 3);
        if (!user) continue;
        const dateStr = cell(row, cols.date, 1);
        const startMins = parseTimeMins(cell(row, cols.start, 4));
        const endMins = parseTimeMins(cell(row, cols.end, 5));
        const rowDate = parseRowDate(dateStr, tz);
        if (!rowDate) continue;
        const sameDate = rowDate.day === now.day && rowDate.month === now.month && rowDate.year === now.year;
        if (!sameDate) {
            if (endMins != null && startMins != null && endMins < startMins) {
                const prevDay = new Date(now.year, now.month, now.day);
                prevDay.setDate(prevDay.getDate() - 1);
                if (prevDay.getDate() === rowDate.day && prevDay.getMonth() === rowDate.month && prevDay.getFullYear() === rowDate.year && now.minutes < endMins) {
                    names.push(user);
                }
            }
            continue;
        }
        if (startMins == null && endMins == null) continue;
        if (startMins != null && endMins != null) {
            if (endMins > startMins) {
                if (now.minutes >= startMins && now.minutes < endMins) names.push(user);
            } else {
                if (now.minutes >= startMins || now.minutes < endMins) names.push(user);
            }
        } else if (startMins != null && now.minutes >= startMins) names.push(user);
        else if (endMins != null && now.minutes < endMins) names.push(user);
    }
    return [...new Set(names)];
}

function getNookmartOnShiftFromList(grid, tz) {
    return getOnShiftFromList(grid, tz, /nookmart/i);
}

function getOverflowOnShiftFromList(grid, tz) {
    return getOnShiftFromList(grid, tz, /overflow/i);
}

// Legacy grid format: header row with day/time, Nookmart rows with names per column
const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, tues: 2, thur: 4 };
function parseHeaderCell(cell) {
    const s = (cell || '').trim().toLowerCase();
    let day = null, hour = null;
    const dayMatch = s.match(/(sun|mon|tue|tues|wed|thu|thur|fri|sat)/);
    if (dayMatch) day = DAY_MAP[dayMatch[1]];
    const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
        const ampm = (timeMatch[3] || '').toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
    }
    return { day, hour };
}

function getNowInTimezone(tz) {
    try {
        const d = new Date();
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: false });
        const parts = fmt.formatToParts(d);
        let day = 0, hour = 0, minute = 0;
        parts.forEach(p => {
            if (p.type === 'weekday') day = DAY_MAP[p.value.toLowerCase().slice(0, 3)] ?? 0;
            if (p.type === 'hour') hour = parseInt(p.value, 10) || 0;
            if (p.type === 'minute') minute = parseInt(p.value, 10) || 0;
        });
        return { day, hour, minute };
    } catch (e) {
        const d = new Date();
        return { day: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
    }
}

function findColumnForNow(grid, tz) {
    if (!grid.length) return -1;
    const now = getNowInTimezone(tz);
    const nowMins = now.hour * 60 + now.minute;
    const header = grid[0];
    let best = -1, bestScore = -1;
    for (let c = 0; c < header.length; c++) {
        const h = parseHeaderCell(header[c]);
        let score = 0;
        if (h.day != null && h.day === now.day) score += 10;
        else if (h.day == null) score += 5;
        if (h.hour != null) {
            const diff = Math.abs(h.hour * 60 - nowMins);
            if (diff < 60) score += 20 - Math.min(20, diff / 3);
        }
        if (score > bestScore) { bestScore = score; best = c; }
    }
    return best >= 0 ? best : 0;
}

function getNookmartNamesForColumn(grid, col) {
    const names = [];
    for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row.some(cell => /nookmart/i.test(String(cell)))) continue;
        const val = (row[col] ?? '').trim();
        if (!val) continue;
        val.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(n => names.push(n));
    }
    return [...new Set(names)];
}

// Get schedule date range from shift-list grid (min/max calendar dates) for hint when no one is on shift
function getScheduleDateRange(grid, tz) {
    const { headerRow, dataStart } = getShiftListMeta(grid);
    const cols = getColumnIndices(headerRow);
    let minDate = null, maxDate = null;
    for (let r = dataStart; r < grid.length; r++) {
        const row = grid[r];
        const dateStr = cell(row, cols.date, 1);
        const rd = parseRowDate(dateStr, tz);
        if (!rd) continue;
        const d = { year: rd.year, month: rd.month, day: rd.day };
        if (!minDate || rd.year < minDate.year || (rd.year === minDate.year && rd.month < minDate.month) || (rd.year === minDate.year && rd.month === minDate.month && rd.day < minDate.day)) minDate = d;
        if (!maxDate || rd.year > maxDate.year || (rd.year === maxDate.year && rd.month > maxDate.month) || (rd.year === maxDate.year && rd.month === maxDate.month && rd.day > maxDate.day)) maxDate = d;
    }
    if (!minDate || !maxDate) return null;
    return { minDate, maxDate };
}

function dateOutsideRange(now, minDate, maxDate) {
    if (now.year < minDate.year || now.year > maxDate.year) return true;
    if (now.year === minDate.year && (now.month < minDate.month || (now.month === minDate.month && now.day < minDate.day))) return true;
    if (now.year === maxDate.year && (now.month > maxDate.month || (now.month === maxDate.month && now.day > maxDate.day))) return true;
    return false;
}

function normalizeScheduleName(n) {
    const t = String(n).trim();
    if (/^chaos$/i.test(t)) return 'chAos';
    return t;
}

/** Prefer schedule.json startIso/endIso (same as strobe.twizt.shop). */
function namesOnDutyAt(data, nowMs) {
    const names = [];
    for (const week of data?.weeks || []) {
        for (const col of week.columns || []) {
            for (const s of col || []) {
                if (!s?.name || /^OPEN$/i.test(s.name)) continue;
                const a = Date.parse(s.startIso);
                const b = Date.parse(s.endIso);
                if (Number.isNaN(a) || Number.isNaN(b)) continue;
                if (nowMs >= a && nowMs < b) names.push(normalizeScheduleName(s.name));
            }
        }
    }
    return [...new Set(names)];
}

function paintOnShift(el, nookmartNames, overflowNames, titleExtra) {
    const backupTip = overflowNames.length ? `Backup: ${overflowNames.join(', ')}` : 'No backup on shift';
    const safeTip = backupTip.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    if (nookmartNames.length) {
        el.style.color = '#4caf50';
        el.title = '';
        el.style.cursor = '';
        el.innerHTML = nookmartNames.map(name => {
            const safe = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            return `<span class="on-shift-name" title="${safeTip}">${safe}</span>`;
        }).join(', ');
        return;
    }
    el.textContent = 'No one scheduled';
    el.style.color = '#888';
    let title = overflowNames.length ? `Backup: ${overflowNames.join(', ')}` : '';
    if (titleExtra) title = (title ? title + '\n\n' : '') + titleExtra;
    el.title = title;
    el.style.cursor = title ? 'help' : 'default';
}

function setOnShiftDisplayFromCsv(csvText, tz, scheduleCachedAt) {
    const el = document.getElementById('onShiftNow');
    if (!el) return;
    tz = tz || SCHEDULE_TZ;
    if (!csvText || !String(csvText).trim()) {
        el.innerHTML = '<span class="muted">-</span>';
        el.style.color = '#666';
        el.title = scheduleCachedAt
            ? 'Open settings to paste a schedule, or visit strobe.twizt.shop after login.'
            : 'Open settings -> visit strobe.twizt.shop after login to load schedule.';
        return;
    }
    const grid = parseCSV(String(csvText));
    let nookmartNames = [];
    let overflowNames = [];
    if (isShiftListFormat(grid)) {
        nookmartNames = getNookmartOnShiftFromList(grid, tz);
        overflowNames = getOverflowOnShiftFromList(grid, tz);
    } else {
        const col = findColumnForNow(grid, tz);
        nookmartNames = getNookmartNamesForColumn(grid, col);
    }
    let titleExtra = '';
    if (!nookmartNames.length && isShiftListFormat(grid)) {
        const range = getScheduleDateRange(grid, tz);
        if (range) {
            const now = getNowDateAndMinutesInTimezone(tz);
            if (dateOutsideRange(now, range.minDate, range.maxDate)) {
                const fmt = (d) => new Date(d.year, d.month, d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                titleExtra = `Schedule covers ${fmt(range.minDate)} - ${fmt(range.maxDate)}. Today is outside that range.`;
            }
        }
    }
    paintOnShift(el, nookmartNames, overflowNames, titleExtra);
}

/** Prefer cached schedule.json; CSV only for paste preview / legacy. */
function setOnShiftDisplay(data, opts) {
    const el = document.getElementById('onShiftNow');
    if (!el) return;
    const forceCsv = !!(opts && opts.forceCsv);
    if (!forceCsv && data.scheduleJson && data.scheduleJson.weeks) {
        paintOnShift(el, namesOnDutyAt(data.scheduleJson, Date.now()), [], '');
        return;
    }
    setOnShiftDisplayFromCsv(data.scheduleCsv, SCHEDULE_TZ, data.scheduleCachedAt);
}

function refreshOnShiftDisplay() {
    chrome.storage.local.get({ scheduleCsv: '', scheduleJson: null, scheduleCachedAt: 0 }, (data) => {
        setOnShiftDisplay(data);
    });
}

function formatAgeSec(sec) {
    if (sec == null || sec < 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
}

const QUEUE_STALE_SEC = 900; // 15 minutes — matches toolbar red flash

function formatQueueAgeMins(ageSec) {
    const mins = Math.max(0, Math.floor((ageSec || 0) / 60));
    return mins === 1 ? '1 minute' : `${mins} minutes`;
}

function updateQueueCount(orders) {
    const el = document.getElementById('queueCount');
    if (!el) return;
    const list = Array.isArray(orders) ? orders : [];
    const count = list.length;
    let maxAge = 0;
    for (const o of list) {
        const a = o.ageSec ?? 0;
        if (a > maxAge) maxAge = a;
    }
    const stale = list.some((o) => (o.ageSec ?? 0) >= QUEUE_STALE_SEC);
    el.classList.toggle('stale', stale);
    if (count === 0) {
        el.innerHTML = '0';
        el.title = 'Unfilled orders in the Hub queue';
        return;
    }
    el.innerHTML = `${count}<span class="queue-age">at ${formatQueueAgeMins(maxAge)}</span>`;
    el.title = stale
        ? `Oldest order has sat ${formatQueueAgeMins(maxAge)} (15+ min — red flash)`
        : `Oldest order in queue: ${formatQueueAgeMins(maxAge)}`;
}

function updateLocalTime() {
    const el = document.getElementById('localTime');
    if (!el) return;
    try {
        const d = new Date();
        const timeStr = new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }).format(d);
        const tzShort = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(d)
            .find(p => p.type === 'timeZoneName')?.value || '';
        el.textContent = tzShort ? `${timeStr} (${tzShort})` : timeStr;
    } catch (e) {
        el.textContent = '-';
    }
}

function showMainView() {
    document.getElementById('mainView')?.classList.remove('hidden');
    document.getElementById('settingsView')?.classList.add('hidden');
    document.getElementById('openSettings')?.classList.remove('active');
}

function showSettingsView() {
    document.getElementById('mainView')?.classList.add('hidden');
    document.getElementById('settingsView')?.classList.remove('hidden');
    document.getElementById('openSettings')?.classList.add('active');
}

function updateUI() {
    updateLocalTime();
    applyBuildUi();
    chrome.storage.local.get({
        currentOrders: [], history: [], pausedOrders: [], mute: false, volume: 0.5, threatLevel: 'high',
        scheduleCsv: '', scheduleJson: null, scheduleCachedAt: 0, scheduleCacheError: '', strobeApiKey: '', lastPollOkAt: 0, lastPollError: '',
        lastBirdAlertAt: 0, lastBirdAlertIds: [], lastBirdAlertMode: '', lastBirdAlertSoundOk: null, lastBirdAlertSoundError: '',
        monitoringPaused: false, hubspotDarkMode: true,
        pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
        showPendingList: false, showPausedList: false, showPreviousList: false,
        showHudPaused: false, showPopupSearch: false, showHudSearch: true,
        alertSoundId: DEFAULT_ALERT_SOUND, alertSoundCustom: ''
    }, (data) => {
        fillPollIntervalSelect(data.pollIntervalSec);
        const btn = document.getElementById('threatToggle');

        // Maintain your Alert Status logic
        if (data.mute) {
            btn.innerText = "BIRD ALERT: OFF";
            btn.className = "status-btn off";
        } else {
            const levelText =
                data.threatLevel === 'high' ? 'HIGH (4m)'
                : data.threatLevel === 'medium' ? 'MED (6m)'
                : data.threatLevel === 'low' ? 'LOW (8m)'
                : data.threatLevel === 'one' ? '1 ORDER'
                : 'HIGH (4m)';
            const levelClass = ['high', 'medium', 'low', 'one'].includes(data.threatLevel)
                ? data.threatLevel
                : 'high';
            btn.innerText = `BIRD ALERT: ${levelText}`;
            btn.className = `status-btn ${levelClass}`;
            btn.title = data.threatLevel === 'one'
                ? 'Alert as soon as any unfilled order appears (slow / night shifts)'
                : 'Alert when an order sits past this wait time';
        }

        document.getElementById('volumeSlider').value = data.volume;
        fillAlertSoundSelect(data.alertSoundId || DEFAULT_ALERT_SOUND);
        syncCustomSoundStatus(!!data.alertSoundCustom);

        const schedStatus = document.getElementById('scheduleStatus');
        if (schedStatus) {
            if (data.scheduleCachedAt) {
                const ago = Math.floor((Date.now() - data.scheduleCachedAt) / 1000);
                const when = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;
                schedStatus.style.color = '#4caf50';
                schedStatus.textContent = `Schedule loaded (${when})`;
            } else if (data.scheduleCacheError) {
                schedStatus.style.color = '#f44';
                schedStatus.textContent = `Schedule not loaded — ${data.scheduleCacheError}`;
            } else {
                schedStatus.style.color = '#888';
                schedStatus.textContent = 'Schedule not loaded yet — open strobe.twizt.shop';
            }
        }

        const lastAlertEl = document.getElementById('lastAlertStatus');
        if (lastAlertEl) {
            if (data.lastBirdAlertAt) {
                const ago = Math.floor((Date.now() - data.lastBirdAlertAt) / 1000);
                const when = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;
                const mode = data.lastBirdAlertMode || '?';
                const ids = (data.lastBirdAlertIds || []).slice(0, 3).join(', ') || '(no id)';
                const soundBit = data.lastBirdAlertSoundOk === false
                    ? ` · sound failed${data.lastBirdAlertSoundError ? `: ${data.lastBirdAlertSoundError}` : ''}`
                    : data.lastBirdAlertSoundOk ? ' · sound ok' : '';
                lastAlertEl.style.color = data.lastBirdAlertSoundOk === false ? '#f44' : '#888';
                lastAlertEl.textContent = `Last alert ${when} (${mode}): ${ids}${soundBit}`;
            } else {
                lastAlertEl.style.color = '#666';
                lastAlertEl.textContent = 'No Bird Alert fired yet this session';
            }
        }

        const pollEl = document.getElementById('pollStatus');
        const pauseEl = document.getElementById('pauseMonitoring');
        if (pauseEl) pauseEl.checked = !!data.monitoringPaused;
        const darkEl = document.getElementById('hubspotDarkMode');
        if (darkEl) darkEl.checked = data.hubspotDarkMode !== false;
        const showPending = !!data.showPendingList;
        const showPaused = !!data.showPausedList;
        const showPrevious = !!FEATURES.historyPage && !!data.showPreviousList;
        const pendingCb = document.getElementById('showPendingList');
        const pausedCb = document.getElementById('showPausedList');
        const previousCb = document.getElementById('showPreviousList');
        if (pendingCb) pendingCb.checked = showPending;
        if (pausedCb) pausedCb.checked = showPaused;
        if (previousCb) previousCb.checked = showPrevious;
        const hudPausedCb = document.getElementById('showHudPaused');
        if (hudPausedCb) hudPausedCb.checked = !!data.showHudPaused;
        const popupSearchCb = document.getElementById('showPopupSearch');
        const hudSearchCb = document.getElementById('showHudSearch');
        if (popupSearchCb) popupSearchCb.checked = !!data.showPopupSearch;
        if (hudSearchCb) hudSearchCb.checked = data.showHudSearch !== false;
        document.getElementById('popupSearchSection')?.classList.toggle('hidden', !data.showPopupSearch);
        document.getElementById('pendingSection')?.classList.toggle('hidden', !showPending);
        document.getElementById('pausedSection')?.classList.toggle('hidden', !showPaused);
        document.getElementById('previousSection')?.classList.toggle('hidden', !showPrevious);
        if (pollEl) {
            const every = normalizePollIntervalSec(data.pollIntervalSec);
            if (data.monitoringPaused) {
                pollEl.textContent = data.strobeApiKey
                    ? `Paused - API key saved (would check every ${every}s)`
                    : 'Paused - no API key';
            } else if (data.strobeApiKey) {
                let status = `Polling every ${every}s`;
                if (data.lastPollOkAt) {
                    const ago = Math.floor((Date.now() - data.lastPollOkAt) / 1000);
                    status += ` · last ${ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`} ago`;
                }
                if (data.lastPollError) status += ` - ${data.lastPollError}`;
                pollEl.textContent = status;
            } else {
                pollEl.textContent = data.lastPollError ? `No API key - ${data.lastPollError}` : 'No API key';
            }
        }

        // Display Live Orders from the "Eye"
        updateQueueCount(data.currentOrders);
        document.getElementById('orderList').innerHTML = data.currentOrders.map(order => `
        <div class="item" data-id="${order.id}">
        <span class="id-text">${order.id}</span>
        <span class="user-text">${order.user || "??"}</span>
        <span class="age-text">${formatAgeSec(order.ageSec)}</span>
        <span class="status-tag ${order.status.toLowerCase()}">${order.status}</span>
        </div>
        `).join('') || '<div style="padding:10px; color:#444;">None</div>';

        document.getElementById('pausedList').innerHTML = (data.pausedOrders || []).map(order => `
        <div class="item" data-id="${order.id}">
        <span class="id-text">${order.id}</span>
        <span class="user-text">${order.user || order.staff || "??"}</span>
        <span class="status-tag ${(order.status || 'paused').toLowerCase()}">${order.status || 'Paused'}</span>
        </div>
        `).join('') || '<div style="padding:10px; color:#444;">None</div>';

        // FIX: Recent History now looks for the new data structure
        const sortedHistory = [...data.history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        document.getElementById('recentList').innerHTML = sortedHistory.slice(0, 10).map(item => `
        <div class="item" data-id="${item.id}">
        <div style="flex-grow:1">
        <span class="id-text">${item.id}</span>
        <span class="user-text">${item.user || "??"}</span>
        </div>
        <div style="text-align:right">
        <div style="font-size:9px; color:#555;">${item.taken || ""}</div>
        <div style="font-size:10px; color:#444;">-</div>
        </div>
        </div>
        `).join('') || '<div style="padding:10px; color:#444;">None</div>';

        // Re-attach the click-to-copy listeners
        document.querySelectorAll('.item').forEach(el => {
            el.onclick = () => {
                const orderId = el.getAttribute('data-id');
                navigator.clipboard.writeText(orderId);
                const original = el.innerHTML;
                el.innerHTML = `<span style="color:#4caf50; font-weight:bold; width:100%; text-align:center;">COPIED!</span>`;
                setTimeout(() => { el.innerHTML = original; }, 800);
            };
        });

        // Schedule form: don't overwrite textarea if user has unsaved pasted content or just saved (box should stay empty)
        const pasteEl = document.getElementById('schedulePaste');
        const storedCsv = (data.scheduleCsv || '').trim();
        const currentCsv = pasteEl ? pasteEl.value.trim() : '';
        if (pasteEl) {
            if (keepPasteBoxEmpty) {
                setOnShiftDisplay(data);
            } else if (currentCsv && currentCsv !== storedCsv) {
                setOnShiftDisplayFromCsv(pasteEl.value, SCHEDULE_TZ, data.scheduleCachedAt);
            } else {
                pasteEl.value = data.scheduleCsv || '';
                setOnShiftDisplay(data);
            }
        } else {
            refreshOnShiftDisplay();
        }
    });
}

// Keep your existing Toggle, Volume, and Alarm listeners exactly as they are...
document.getElementById('threatToggle').onclick = () => {
    chrome.storage.local.get({ threatLevel: 'high', mute: false }, (d) => {
        let nextT = d.threatLevel, nextM = false;
        if (d.mute) { nextT = 'high'; nextM = false; }
        else if (d.threatLevel === 'high') nextT = 'medium';
        else if (d.threatLevel === 'medium') nextT = 'low';
        else if (d.threatLevel === 'low') nextT = 'one';
        else nextM = true; // one (or unknown) → OFF
        chrome.storage.local.set({ threatLevel: nextT, mute: nextM }, updateUI);
    });
};

document.getElementById('volumeSlider').oninput = (e) => {
    const v = parseFloat(e.target.value);
    chrome.storage.local.set({ volume: v });
    if (testGainNode) testGainNode.gain.setTargetAtTime(Math.min(2, Math.max(0, v)), testCtx.currentTime, 0.01);
};

document.getElementById('alertSoundSelect')?.addEventListener('change', (e) => {
    const id = e.target.value || DEFAULT_ALERT_SOUND;
    chrome.storage.local.set({ alertSoundId: id });
    const customRow = document.getElementById('customSoundRow');
    if (customRow) customRow.classList.toggle('hidden', id !== 'custom');
});

document.getElementById('customSoundFile')?.addEventListener('change', async (e) => {
    if (!FEATURES.customAlertSound) return;
    const file = e.target.files?.[0];
    const status = document.getElementById('customSoundStatus');
    if (!file) return;
    if (file.size > CUSTOM_SOUND_MAX_BYTES) {
        if (status) {
            status.style.color = '#f44';
            status.textContent = 'File too large (max ~1.5 MB)';
        }
        return;
    }
    try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const mime = file.type || 'audio/mpeg';
        const dataUrl = `data:${mime};base64,${btoa(binary)}`;
        chrome.storage.local.set({ alertSoundId: 'custom', alertSoundCustom: dataUrl }, () => {
            fillAlertSoundSelect('custom');
            syncCustomSoundStatus(true);
        });
    } catch (err) {
        if (status) {
            status.style.color = '#f44';
            status.textContent = String(err?.message || err);
        }
    }
});

document.getElementById('testAlarm').onclick = () => {
    chrome.storage.local.get({
        volume: 0.5,
        alertSoundId: DEFAULT_ALERT_SOUND,
        alertSoundCustom: '',
    }, (data) => {
        const vol = Math.min(2, Math.max(0, parseFloat(data.volume) || 0.5));
        if (testAudio) testAudio.pause();
        const src = resolveAlertSrc(data.alertSoundId, data.alertSoundCustom);
        testAudio = new Audio(src);
        if (!testCtx) {
            testCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const node = testCtx.createMediaElementSource(testAudio);
        testGainNode = testCtx.createGain();
        testGainNode.gain.value = vol;
        node.connect(testGainNode);
        testGainNode.connect(testCtx.destination);
        testAudio.play().catch((err) => {
            const status = document.getElementById('customSoundStatus');
            if (status) {
                status.style.color = '#f44';
                status.textContent = String(err?.message || err);
            }
        });
    });
};

document.getElementById('openHistory')?.addEventListener('click', () => {
    if (!FEATURES.historyPage) return;
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

document.getElementById('openSettings')?.addEventListener('click', showSettingsView);
document.getElementById('closeSettings')?.addEventListener('click', showMainView);

document.getElementById('apiKeySave').onclick = async () => {
    const raw = document.getElementById('apiKeyInput').value.trim();
    const pollEl = document.getElementById('pollStatus');
    // Empty Save used to wipe the key - keep existing unless Clear
    if (!raw) {
        if (pollEl) pollEl.textContent = 'Paste a key first (empty Save does not clear)';
        return;
    }
    let key = raw;
    if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
    // Hub keys are strb_<40 hex> - bare hex alone is rejected
    if (/^[a-f0-9]{40}$/i.test(key)) key = `strb_${key}`;
    if (pollEl) {
        pollEl.style.color = '#888';
        pollEl.textContent = 'Checking API key…';
    }
    chrome.storage.local.set({ strobeApiKey: key }, async () => {
        document.getElementById('apiKeyInput').value = '';
        try {
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: 'SEARCH_ORDER', query: 'ZZZZBIRDKEYTEST' },
                    (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message })
                );
            });
            if (resp?.ok === false && /rejected|auth|API key/i.test(String(resp.error || ''))) {
                if (pollEl) {
                    pollEl.style.color = '#f44';
                    pollEl.textContent = resp.error || 'Key rejected by Hub';
                }
                return;
            }
            // ok:true (even with no order) means Hub accepted the key
            if (pollEl) {
                pollEl.style.color = '#4caf50';
                pollEl.textContent = 'API key OK - Hub accepted it';
            }
            chrome.runtime.sendMessage({ type: 'FORCE_POLL' }, updateUI);
        } catch (e) {
            if (pollEl) {
                pollEl.style.color = '#f44';
                pollEl.textContent = String(e?.message || e);
            }
        }
    });
};
document.getElementById('apiKeyClear').onclick = () => {
    chrome.storage.local.set({ strobeApiKey: '' }, updateUI);
};
document.getElementById('forcePoll').onclick = () => {
    chrome.runtime.sendMessage({ type: 'FORCE_POLL' }, updateUI);
};

document.getElementById('pauseMonitoring').onchange = (e) => {
    chrome.storage.local.set({ monitoringPaused: e.target.checked }, updateUI);
};

document.getElementById('pollIntervalSelect')?.addEventListener('change', (e) => {
    const sec = normalizePollIntervalSec(e.target.value);
    chrome.storage.local.set({ pollIntervalSec: sec }, () => {
        chrome.runtime.sendMessage({ type: 'SYNC_POLL_CADENCE' }).catch(() => {});
        updateUI();
    });
});

document.getElementById('hubspotDarkMode')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ hubspotDarkMode: e.target.checked });
});

function wireListToggle(id, key) {
    document.getElementById(id)?.addEventListener('change', (e) => {
        chrome.storage.local.set({ [key]: e.target.checked }, updateUI);
    });
}
wireListToggle('showPendingList', 'showPendingList');
wireListToggle('showPausedList', 'showPausedList');
if (FEATURES.historyPage) wireListToggle('showPreviousList', 'showPreviousList');
wireListToggle('showHudPaused', 'showHudPaused');
wireListToggle('showPopupSearch', 'showPopupSearch');
wireListToggle('showHudSearch', 'showHudSearch');

function zeroOhVariants(id) {
    const raw = String(id || '').trim().toUpperCase();
    if (!raw) return [];
    const out = new Set([raw]);
    const idxs = [];
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === 'O' || raw[i] === '0') idxs.push(i);
    }
    const limit = Math.min(idxs.length, 6);
    const n = 1 << limit;
    for (let mask = 1; mask < n; mask++) {
        const chars = raw.split('');
        for (let b = 0; b < limit; b++) {
            if (mask & (1 << b)) {
                const i = idxs[b];
                chars[i] = chars[i] === 'O' ? '0' : 'O';
            }
        }
        out.add(chars.join(''));
    }
    return [...out];
}

function staffFromHit(o) {
    const raw = o?.staffHandle || o?.staff || o?.worker?.ign || o?.worker?.handle || '??';
    const t = String(raw).trim();
    if (/^chaos$/i.test(t)) return 'chAos';
    return t || '??';
}

/** Popup is an extension page - can fetch Hub directly (no SW needed). */
async function birdLookupOrder(query) {
    const q = String(query || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!q) return { ok: false, error: 'Paste full order ID' };
    const cfg = await new Promise((resolve) => {
        chrome.storage.local.get({ strobeApiKey: '', strobeApiBase: 'https://strobe.gg' }, resolve);
    });
    let apiKey = String(cfg.strobeApiKey || '').trim();
    if (/^bearer\s+/i.test(apiKey)) apiKey = apiKey.replace(/^bearer\s+/i, '').trim();
    if (/^[a-f0-9]{40}$/i.test(apiKey)) apiKey = `strb_${apiKey}`;
    if (apiKey !== String(cfg.strobeApiKey || '').trim()) {
        chrome.storage.local.set({ strobeApiKey: apiKey });
    }
    const base = String(cfg.strobeApiBase || 'https://strobe.gg').trim().replace(/\/$/, '') || 'https://strobe.gg';
    if (!apiKey) return { ok: false, error: 'No API key - save one in settings' };
    let lastErr = null;
    for (const v of zeroOhVariants(q)) {
        try {
            const res = await fetch(`${base}/api/order/search`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: v, page: 1 }),
            });
            if (res.status === 429) return { ok: false, error: 'Rate limited - try again' };
            if (!res.ok) {
                lastErr = new Error(`HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            if (data?.status === 500 || data?.status === 401 || data?.status === 403) {
                return {
                    ok: false,
                    error: 'Hub rejected API key (check key; do not include the word Bearer)',
                };
            }
            if (data && data.success === false) {
                lastErr = new Error(data.message || data.error || 'API_ERROR');
                continue;
            }
            const orders = data?.results?.orders || [];
            const hit =
                orders.find((o) => String(o.publicId || o.id || '').toUpperCase() === v) ||
                orders[0] ||
                null;
            if (hit) {
                return {
                    ok: true,
                    order: {
                        id: hit.publicId || hit.id || '',
                        staff: staffFromHit(hit),
                        status: hit.status || '??',
                        createdAtMs: hit.dateCreated ? Date.parse(hit.dateCreated) : null,
                        note: hit.workerNote || '',
                    },
                    queryUsed: v,
                    corrected: v !== q,
                };
            }
        } catch (e) {
            lastErr = e;
            return { ok: false, error: String(e?.message || e) };
        }
    }
    if (lastErr) return { ok: false, error: String(lastErr?.message || lastErr) };
    return { ok: true, order: null };
}

function renderOrderSearchResult(targetEl, resp) {
    if (!targetEl) return;
    if (!resp?.ok) {
        targetEl.innerHTML = `<span class="err">${(resp?.error || 'Search failed').replace(/</g, '&lt;')}</span>`;
        return;
    }
    if (!resp.order) {
        targetEl.textContent = 'No order found - check ID (O vs 0)';
        return;
    }
    if (resp.corrected && resp.queryUsed) {
        const input = document.getElementById('orderSearch');
        if (input) input.value = resp.queryUsed;
    }
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const id = esc(resp.order.id);
    const who = esc(resp.order.staff || '??');
    const st = esc(resp.order.status || '??');
    const note = String(resp.order.note || '').trim();
    const fix = resp.corrected ? '<br><span style="color:#888;font-size:10px">O/0 auto-corrected</span>' : '';
    const noteHtml = note
        ? `<div class="note" style="margin-top:6px;color:#ffcc80;font-size:11px;line-height:1.35"><span style="color:#888;font-size:9px;text-transform:uppercase">Staff note</span><br>${esc(note)}</div>`
        : '<div style="margin-top:4px;color:#555;font-size:10px">No staff note</div>';
    targetEl.innerHTML = `<span class="id-text">${id}</span><br><span class="who">${who}</span> · <span class="stat">${st}</span>${fix}${noteHtml}`;
}

async function runOrderSearch() {
    const input = document.getElementById('orderSearch');
    const out = document.getElementById('orderSearchResult');
    const q = (input?.value || '').trim();
    if (!out) return;
    if (!q) {
        out.textContent = 'Paste a full order ID';
        return;
    }
    out.textContent = 'Searching…';
    const resp = await birdLookupOrder(q);
    renderOrderSearchResult(out, resp);
    if (FEATURES.birdBrain && resp?.ok && resp.order?.id) {
        const id = String(resp.order.id).trim().toUpperCase();
        const now = Date.now();
        const max = FEATURES.historyMaxEntries || 2000;
        chrome.storage.local.get({ history: [] }, (data) => {
            const history = (data.history || []).filter(
                (i) => String(i.id || '').toUpperCase() !== id
            );
            const placedMs = resp.order.createdAtMs && Number.isFinite(resp.order.createdAtMs)
                ? resp.order.createdAtMs
                : null;
            const entry = {
                id,
                user: resp.order.staff || '??',
                status: resp.order.status || '??',
                source: 'lookup',
                born: placedMs
                    ? new Date(placedMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '—',
                bornDate: placedMs ? new Date(placedMs).toLocaleDateString() : '',
                taken: new Date(now).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                }),
                date: new Date(now).toLocaleDateString(),
                satFor: '—',
                note: resp.order.note || '',
                timestamp: now,
            };
            chrome.storage.local.set({ history: [entry, ...history].slice(0, max) });
        });
    }
}

document.getElementById('orderSearchBtn')?.addEventListener('click', runOrderSearch);
document.getElementById('orderSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runOrderSearch();
});

document.getElementById('scheduleSave').onclick = () => {
    const newPaste = document.getElementById('schedulePaste').value.trim();
    chrome.storage.local.get({ scheduleCsv: '' }, (data) => {
        const existing = (data.scheduleCsv || '').trim();
        let mergedCsv = newPaste;
        if (existing) {
            const gridA = parseCSV(existing);
            const gridB = parseCSV(newPaste);
            if (isShiftListFormat(gridA) || isShiftListFormat(gridB)) {
                const merged = mergeScheduleGrids(gridA, gridB);
                mergedCsv = gridToCsv(merged);
            }
        }
        chrome.storage.local.set({ scheduleCsv: mergedCsv, scheduleJson: null }, () => {
            const pasteEl = document.getElementById('schedulePaste');
            if (pasteEl) pasteEl.value = '';
            keepPasteBoxEmpty = true;
            setOnShiftDisplayFromCsv(mergedCsv, SCHEDULE_TZ, 0);
        });
    });
};

(function () {
    const pasteEl = document.getElementById('schedulePaste');
    let debounceTimer = null;
    function updateFromTextarea() {
        if (pasteEl) setOnShiftDisplayFromCsv(pasteEl.value, SCHEDULE_TZ, 0);
    }
    if (pasteEl) {
        pasteEl.addEventListener('input', () => {
            keepPasteBoxEmpty = false;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(updateFromTextarea, 200);
        });
        pasteEl.addEventListener('paste', () => {
            keepPasteBoxEmpty = false;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(updateFromTextarea, 100);
        });
    }
})();

updateUI();
// Update instantly when storage changes (e.g., new UNFILLED order arrives)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const keys = Object.keys(changes || {});
    if (keys.some(k => [
        "currentOrders", "pausedOrders", "history", "mute", "volume", "threatLevel",
        "scheduleCsv", "scheduleCachedAt", "scheduleJson", "scheduleCacheError", "strobeApiKey", "lastPollOkAt", "lastPollError",
        "lastBirdAlertAt", "lastBirdAlertIds", "lastBirdAlertMode", "lastBirdAlertSoundOk",
        "monitoringPaused", "showPopupSearch"
    ].includes(k))) {
        updateUI();
        if (keys.some(k => k === "scheduleCsv" || k === "scheduleCachedAt")) refreshOnShiftDisplay();
    }
});
// Keep a slow poll as a safety net
setInterval(updateUI, 5000);
// Tick local clock while popup is open
setInterval(updateLocalTime, 1000);
