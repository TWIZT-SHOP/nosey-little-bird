let currentPage = 1;
let selectedUser = '';
const perPage = 25;

function isUnknownUser(user) {
    return user == null || user === '' || user === '??';
}

document.getElementById('userFilter').addEventListener('change', (e) => {
    selectedUser = e.target.value;
    currentPage = 1;
    load();
});

function parseToSeconds(str) {
    if (!str || str.includes("---") || str.includes("LIVE") || str === "—") return 0;
    const parts = str.match(/\d+/g);
    if (!parts) return 0;
    return parts.length === 2 ? (parseInt(parts[0]) * 60) + parseInt(parts[1]) : parseInt(parts[0]);
}

function updateStats(data) {
    const counts = {};
    data.filter(i => i.user && i.user !== "??").forEach(i => counts[i.user] = (counts[i.user] || 0) + 1);
    const top = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, "---");
    document.getElementById("stat-count").innerText = data.length;
    document.getElementById("stat-top").innerText = top;
}

function howLabel(item) {
    const src = String(item.source || '').toLowerCase();
    if (src === 'lookup') return 'lookup';
    if (src === 'poll' || item.status === 'TAKEN') return 'queue';
    if (item.satFor && parseToSeconds(item.satFor) > 0) return 'queue';
    return item.source || 'seen';
}

function seenLabel(item) {
    const t = item.timestamp ? new Date(item.timestamp) : null;
    if (t && !Number.isNaN(t.getTime())) {
        return t.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    const dateStr = item.date || item.bornDate || '';
    const timeStr = item.taken || item.born || '';
    return [dateStr, timeStr].filter(Boolean).join(' ') || '—';
}

function load() {
    chrome.storage.local.get({ history: [], birdBrainLog: [] }, (data) => {
        // One-time heal: HUD used to write birdBrainLog; Bird Brain page reads history
        let history = data.history || [];
        const orphan = data.birdBrainLog || [];
        if (orphan.length && history.length === 0) {
            const now = Date.now();
            history = orphan.map((e, i) => ({
                id: e.id,
                user: e.staff || e.user || "??",
                status: e.status || e.note || "??",
                source: "lookup",
                born: "—",
                bornDate: "",
                taken: "",
                date: "",
                satFor: "—",
                note: e.note || "",
                timestamp: e.at || now - i,
            }));
            chrome.storage.local.set({ history, birdBrainLog: [] });
        }

        const table = document.getElementById("tableBody");
        const byTimestamp = [...history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const byId = new Map();
        byTimestamp.forEach(item => {
            const existing = byId.get(item.id);
            if (!existing) {
                byId.set(item.id, item);
                return;
            }
            const itemSat = parseToSeconds(item.satFor);
            const existingSat = parseToSeconds(existing.satFor);
            if ((item.timestamp || 0) >= (existing.timestamp || 0)) {
                byId.set(item.id, {
                    ...existing,
                    ...item,
                    satFor: itemSat > existingSat ? item.satFor : existing.satFor,
                });
            }
        });
        const deduped = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (deduped.length < history.length) {
            chrome.storage.local.set({ history: deduped });
        }
        const sorted = deduped;

        const users = [...new Set(history.map(i => isUnknownUser(i.user) ? '__unknown__' : i.user))];
        users.sort((a, b) => {
            if (a === '__unknown__') return -1;
            if (b === '__unknown__') return 1;
            return a.localeCompare(b);
        });

        const filterEl = document.getElementById('userFilter');
        const curVal = filterEl.value;
        filterEl.innerHTML = '<option value="">All Users</option>' +
            users.map(u => `<option value="${u}">${u === '__unknown__' ? 'Unknown' : u}</option>`).join('');
        if (users.includes(curVal)) filterEl.value = curVal;

        const filtered = !selectedUser
            ? sorted
            : selectedUser === '__unknown__'
                ? sorted.filter(item => isUnknownUser(item.user))
                : sorted.filter(item => item.user === selectedUser);

        updateStats(filtered);
        const totalPages = Math.ceil(filtered.length / perPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        document.getElementById("pageInfo").innerText = `${currentPage} / ${totalPages}`;

        table.innerHTML = "";
        filtered.slice((currentPage-1)*perPage, currentPage*perPage).forEach(item => {
            const row = table.insertRow();
            const rowKey = entryKey(item);
            row.innerHTML = `
            <td><input type="checkbox" class="row-check" data-id="${item.id}" data-ts="${rowKey}"></td>
            <td class="id-text" data-id="${item.id}">${item.id}</td>
            <td style="color:#ff9800;">${item.user || '??'}</td>
            <td style="font-size:10px; font-weight:bold; opacity:0.8;">${item.status || '??'}</td>
            <td style="color:#888;">${seenLabel(item)}</td>
            <td style="color:#666;font-size:11px;">${howLabel(item)}</td>
            <td><button class="del-btn" data-id="${item.id}" data-ts="${rowKey}">X</button></td>
            `;
        });
    });
}

function entryKey(item) {
    return item.timestamp != null ? String(item.timestamp) : `${item.id}-${item.taken}`;
}

document.getElementById("downloadCsv").onclick = () => {
    chrome.storage.local.get({history: []}, (data) => {
        let csv = "Order ID,Staff,Status,Seen,How,Placed,Sat For\n";
        data.history.forEach(i => {
            const d = i.date || i.bornDate || '';
            csv += `${i.id},${i.user},${i.status},${seenLabel(i)},${howLabel(i)},${d} ${i.born || ''},${i.satFor || ''}\n`;
        });
        const blob = new Blob([csv], {type: 'text/csv'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bird_lore_${new Date().toLocaleDateString()}.csv`;
        a.click();
    });
};

document.getElementById("mergeBtn").onclick = () => document.getElementById("importCsv").click();
document.getElementById("importCsv").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const text = event.target.result;
        const rows = text.split('\n').slice(1);
        chrome.storage.local.get({history: []}, (data) => {
            const existingKeys = new Set(data.history.map(i => `${i.id}-${i.status}-${i.date || i.bornDate || ''}`));
            let newEntries = [];
            rows.forEach((line, i) => {
                const cols = line.split(',');
                if (cols.length < 6) return;
                const hasDate = cols.length >= 7;
                const [id, user, status, dateCol, born, taken, satFor] = hasDate ? [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6]] : [cols[0], cols[1], cols[2], '', cols[3], cols[4], cols[5]];
                const date = (dateCol && dateCol.trim()) || new Date().toLocaleDateString();
                const key = `${id}-${status}-${date}`;
                if (!existingKeys.has(key)) {
                    existingKeys.add(key);
                    newEntries.push({ id, user, status, born, taken, satFor, date, bornDate: date, source: 'import', timestamp: Date.now() - i });
                }
            });
            if (newEntries.length) {
                const merged = [...newEntries, ...data.history];
                const byId = new Map();
                merged.forEach(item => {
                    const existing = byId.get(item.id);
                    if (!existing || (item.timestamp || 0) >= (existing.timestamp || 0)) byId.set(item.id, item);
                });
                const deduped = [...byId.values()];
                chrome.storage.local.set({history: deduped}, () => {
                    alert(`Absorbed ${newEntries.length} memories!`);
                    load();
                });
            }
        });
    };
    reader.readAsText(file);
};

document.getElementById("selectAll").onclick = (e) => {
    document.querySelectorAll(".row-check").forEach(cb => cb.checked = e.target.checked);
};

document.getElementById("bulkDelete").onclick = () => {
    const timestamps = Array.from(document.querySelectorAll(".row-check:checked")).map(cb => cb.dataset.ts);
    if (!timestamps.length) return;
    if (confirm(`Forget ${timestamps.length} memories?`)) {
        chrome.storage.local.get({history: []}, (d) => {
            const keep = (i) => !timestamps.includes(entryKey(i));
            chrome.storage.local.set({history: d.history.filter(keep)}, load);
        });
    }
};

document.getElementById("clear").onclick = () => { if(confirm("Wipe Bird Brain?")) chrome.storage.local.set({history: []}, load); };
document.getElementById("prev").onclick = () => { if(currentPage > 1) { currentPage--; load(); }};
document.getElementById("next").onclick = () => { currentPage++; load(); };

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('del-btn')) {
        const ts = e.target.dataset.ts;
        chrome.storage.local.get({history: []}, (d) => {
            const keep = (i) => entryKey(i) !== ts;
            chrome.storage.local.set({history: d.history.filter(keep)}, load);
        });
    }
    const idEl = e.target.closest('.id-text');
    if (idEl) {
        navigator.clipboard.writeText(idEl.dataset.id);
        const original = idEl.style.color;
        idEl.style.color = "#fff";
        setTimeout(() => idEl.style.color = original, 500);
    }
});

document.addEventListener('DOMContentLoaded', load);
