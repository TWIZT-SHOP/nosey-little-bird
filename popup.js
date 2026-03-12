let testAudio = null;
let testGainNode = null;
let testCtx = null;
// After Save we clear the paste box; don't let updateUI refill it until the user types/pastes again
let keepPasteBoxEmpty = false;

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
function isShiftListFormat(grid) {
    if (!grid.length) return false;
    const row0 = grid[0] || [];
    const hasEnoughCols = row0.length >= 4;
    const hasHeaderLike = row0.some(c => /date|start|end|users?|names?/i.test(String(c ?? '')));
    if (hasEnoughCols && hasHeaderLike) return true;
    if (grid.length > 1) {
        const firstCell = String((grid[1] || [])[0] ?? '').trim();
        const secondCell = String((grid[1] || [])[1] ?? '').trim();
        if (/nookmart|overflow/i.test(firstCell) && /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(secondCell)) return true;
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

// Parse date "16/02/26", "16/02/2026", "9/3/26", "2026-03-09" -> { day, month, year }; null if invalid
function parseRowDate(s, tz) {
    const t = String(s ?? '').trim();
    if (!t) return null;
    const parts = t.split(/[/-]/).map(p => parseInt(p, 10)).filter(n => !isNaN(n));
    if (parts.length < 3) return null;
    let day, month, year;
    if (parts[0] > 31 && parts[0] >= 100) {
        year = parts[0];
        month = (parts[1] || 1) - 1;
        day = parts[2] || 1;
    } else if (parts[2] > 31 || (parts[2] >= 100)) {
        day = parts[0];
        month = (parts[1] || 1) - 1;
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    } else {
        day = parts[0];
        month = (parts[1] || 1) - 1;
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

// Schedule is always Mountain
const SCHEDULE_TZ = 'America/Denver';

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
    return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(dateLike);
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

function setOnShiftDisplayFromCsv(csvText, tz) {
    const el = document.getElementById('onShiftNow');
    if (!el) return;
    tz = tz || SCHEDULE_TZ;
    if (!csvText || !String(csvText).trim()) {
        el.innerHTML = '';
        el.textContent = '— Set schedule below —';
        el.style.color = '#666';
        el.title = '';
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
    } else {
        el.textContent = 'No one scheduled';
        el.style.color = '#888';
        let title = overflowNames.length ? `Backup: ${overflowNames.join(', ')}` : '';
        if (isShiftListFormat(grid)) {
            const range = getScheduleDateRange(grid, tz);
            if (range) {
                const now = getNowDateAndMinutesInTimezone(tz);
                if (dateOutsideRange(now, range.minDate, range.maxDate)) {
                    const fmt = (d) => new Date(d.year, d.month, d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const rangeStr = `${fmt(range.minDate)} – ${fmt(range.maxDate)}`;
                    title = (title ? title + '\n\n' : '') + `Schedule is for ${rangeStr}. Today (Mountain) is outside that range.`;
                }
            }
        }
        el.title = title;
        el.style.cursor = title ? 'help' : 'default';
    }
}

function refreshOnShiftDisplay() {
    chrome.storage.local.get({ scheduleCsv: '' }, (data) => {
        setOnShiftDisplayFromCsv(data.scheduleCsv, SCHEDULE_TZ);
    });
}

function updateMountainTime() {
    const el = document.getElementById('mountainTime');
    if (!el) return;
    try {
        const d = new Date();
        const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
        const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(d);
        const tzShort = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TZ, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || 'MT';
        el.textContent = `${dateStr} ${timeStr} ${tzShort}`;
    } catch (e) {
        el.textContent = '—';
    }
}

function updateUI() {
    updateMountainTime();
    chrome.storage.local.get({ currentOrders: [], history: [], mute: false, volume: 0.5, threatLevel: 'high', scheduleCsv: '' }, (data) => {
        const btn = document.getElementById('threatToggle');

        // Maintain your Alert Status logic
        if (data.mute) {
            btn.innerText = "BIRD ALERT: OFF";
            btn.className = "status-btn off";
        } else {
            const levelText = data.threatLevel === 'high' ? 'HIGH (4m)' : data.threatLevel === 'medium' ? 'MED (6m)' : 'LOW (8m)';
            btn.innerText = `BIRD ALERT: ${levelText}`;
            btn.className = `status-btn ${data.threatLevel}`;
        }

        document.getElementById('volumeSlider').value = data.volume;

        // Display Live Orders from the "Eye"
        document.getElementById('orderList').innerHTML = data.currentOrders.map(order => `
        <div class="item" data-id="${order.id}">
        <span class="id-text">${order.id}</span>
        <span class="user-text">${order.user || "??"}</span>
        <span class="status-tag ${order.status.toLowerCase()}">${order.status}</span>
        </div>
        `).join('') || '<div style="padding:10px; color:#444;">No live orders</div>';

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
        <div style="font-size:10px; color:#444;">—</div>
        </div>
        </div>
        `).join('') || '<div style="padding:10px; color:#444;">No history</div>';

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
                setOnShiftDisplayFromCsv(data.scheduleCsv, SCHEDULE_TZ);
            } else if (currentCsv && currentCsv !== storedCsv) {
                setOnShiftDisplayFromCsv(pasteEl.value, SCHEDULE_TZ);
            } else {
                pasteEl.value = data.scheduleCsv || '';
                setOnShiftDisplayFromCsv(data.scheduleCsv, SCHEDULE_TZ);
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
        else nextM = true;
        chrome.storage.local.set({ threatLevel: nextT, mute: nextM }, updateUI);
    });
};

document.getElementById('volumeSlider').oninput = (e) => {
    const v = parseFloat(e.target.value);
    chrome.storage.local.set({ volume: v });
    if (testGainNode) testGainNode.gain.setTargetAtTime(Math.min(2, Math.max(0, v)), testCtx.currentTime, 0.01);
};

document.getElementById('testAlarm').onclick = () => {
    chrome.storage.local.get({ volume: 0.5 }, (data) => {
        const vol = Math.min(2, Math.max(0, parseFloat(data.volume) || 0.5));
        if (testAudio) testAudio.pause();
        testAudio = new Audio(chrome.runtime.getURL("whistle.mp3"));
        if (!testCtx) {
            testCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const src = testCtx.createMediaElementSource(testAudio);
        testGainNode = testCtx.createGain();
        testGainNode.gain.value = vol;
        src.connect(testGainNode);
        testGainNode.connect(testCtx.destination);
        testAudio.play();
    });
};

document.getElementById('openHistory').onclick = () => chrome.tabs.create({url: 'history.html'});

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
        chrome.storage.local.set({ scheduleCsv: mergedCsv }, () => {
            const pasteEl = document.getElementById('schedulePaste');
            if (pasteEl) pasteEl.value = '';
            keepPasteBoxEmpty = true;
            setOnShiftDisplayFromCsv(mergedCsv, SCHEDULE_TZ);
        });
    });
};

(function () {
    const pasteEl = document.getElementById('schedulePaste');
    let debounceTimer = null;
    function updateFromTextarea() {
        if (pasteEl) setOnShiftDisplayFromCsv(pasteEl.value, SCHEDULE_TZ);
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
    if (keys.some(k => ["currentOrders", "history", "mute", "volume", "threatLevel", "scheduleCsv"].includes(k))) {
        updateUI();
        if (keys.some(k => k === "scheduleCsv")) refreshOnShiftDisplay();
    }
});
// Keep a slow poll as a safety net
setInterval(updateUI, 5000);
// Update Mountain time every second while popup is open
setInterval(updateMountainTime, 1000);
