let activeTimers = {};
let lastUnfilledUpdateTs = 0;

chrome.runtime.onMessage.addListener((message, sender) => {
    // --- LIVE TRACKING LOGIC ---
    if (message.type === "SIGHTING") {
        const { view, orders } = message;
        const seenIds = orders.map(o => o.id);
        const tabId = sender?.tab?.id;

        if (view === "UNFILLED ORDERS") {
            lastUnfilledUpdateTs = Date.now();
            // Feed popup live list immediately
            chrome.storage.local.set({
                currentOrders: orders.map(o => ({
                    id: o.id,
                    user: o.staff || "??",
                    status: o.statusText || "UNFILLED"
                }))
            });

            orders.forEach(order => {
                if (!activeTimers[order.id]) {
                    const now = new Date();
                    activeTimers[order.id] = {
                        born: now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}),
                        bornDate: now.toLocaleDateString(),
                        startTs: Date.now(),
                        staff: order.staff
                    };
                    // HUD_UPSERT only processed on HubSpot pages (content script checks isHubspot)
                    if (tabId != null) {
                        chrome.tabs.sendMessage(tabId, {
                            type: "HUD_UPSERT",
                            id: order.id,
                            staff: order.staff,
                            status: order.statusText || "",
                            satFor: null,
                            note: "SEEN",
                            allowCreate: true,
                            color: "#00e5ff"
                        });
                    }
                } else if (activeTimers[order.id].staff !== order.staff && order.staff !== "@UNASSIGNED") {
                    activeTimers[order.id].staff = order.staff;
                    if (tabId != null) {
                        chrome.tabs.sendMessage(tabId, { type: "TICKER_LOG", msg: `STAFF UPDATE: ${order.id} -> ${order.staff}` });
                        chrome.tabs.sendMessage(tabId, {
                            type: "HUD_UPSERT",
                            id: order.id,
                            staff: order.staff,
                            note: `STAFF -> ${order.staff}`,
                            color: "#ff9800"
                        });
                    }
                }
            });
            for (const id in activeTimers) {
                if (!seenIds.includes(id) && tabId != null) finalize(id, "TAKEN", null, tabId);
            }
        }
        // If we haven't seen UNFILLED in a bit, clear popup live list
        else if (Date.now() - lastUnfilledUpdateTs > 7000) {
            chrome.storage.local.set({ currentOrders: [] });
        }

        // --- THE RETROACTIVE FIX (For Search/Completed pages) ---
        // If the eye sees orders anywhere else, check if we need to fix old history entries
        chrome.storage.local.get({ history: [] }, (data) => {
            let changed = false;
            const changedEntries = [];
            const updatedHistory = data.history.map(item => {
                const match = orders.find(o => o.id === item.id);
                if (!match) return item;

                let next = item;

                // If we found the order and the stored user was unknown ("??") but now we see a name
                if (next.user === "??" && match.staff && match.staff !== "@UNASSIGNED") {
                    changed = true;
                    chrome.tabs.sendMessage(sender.tab.id, { type: "TICKER_LOG", msg: `HISTORY FIXED: ${item.id.slice(-4)} is ${match.staff}` });
                    next = { ...next, user: match.staff };
                }

                // If we see a more specific status text (Pending/Paused/Completed) than what's stored, update it
                if (match.statusText && match.statusText !== next.status) {
                    changed = true;
                    chrome.tabs.sendMessage(sender.tab.id, { type: "TICKER_LOG", msg: `STATUS FIXED: ${item.id.slice(-4)} -> ${match.statusText}` });
                    next = { ...next, status: match.statusText };
                }

                if (next !== item) {
                    changedEntries.push(next);
                }

                return next;
            });

            if (changed) {
                chrome.storage.local.set({ history: updatedHistory });
                if (tabId != null) {
                    changedEntries.forEach(entry => {
                        chrome.tabs.sendMessage(tabId, {
                            type: "HUD_UPSERT",
                            id: entry.id,
                            staff: entry.user,
                            status: entry.status,
                            satFor: entry.satFor,
                            note: null
                        });
                    });
                }
            }
        });

        if (view === "PENDING ORDERS") {
            orders.forEach(order => {
                if (activeTimers[order.id] && tabId != null) finalize(order.id, "CLAIMED", order.staff, tabId);
            });
        }

        // Stop "time sat" when we see an order in Pending on any view (Unfilled, Search, etc.)
        const pendingStatus = (s) => (s || "").toLowerCase() === "pending" || (s || "").toLowerCase() === "in progress";
        orders.forEach(order => {
            if (pendingStatus(order.statusText) && activeTimers[order.id] && tabId != null) {
                finalize(order.id, "CLAIMED", order.staff, tabId);
            }
        });

        // Record the current Paused orders when viewing PAUSED ORDERS in Strobe core/hub
        // Store orderDateTs (from page) and pausedAt (when first seen as paused) for newest-first sort
        if (view === "PAUSED ORDERS") {
            const now = Date.now();
            chrome.storage.local.get({ pausedOrders: [] }, (data) => {
                const prev = (data.pausedOrders || []).filter(Boolean);
                const prevById = new Map(prev.map(p => [p.id, p]));
                const filtered = orders.filter(o => o.statusText && o.statusText.toLowerCase() === "paused");
                const paused = filtered.map((o, i) => {
                    const existing = prevById.get(o.id);
                    // New orders: last in list = newest, so give higher pausedAt to later index (newest first when sorted desc)
                    const defaultPausedAt = now - (filtered.length - 1 - i) * 1000;
                    return {
                        id: o.id,
                        staff: o.staff,
                        status: o.statusText,
                        orderDateTs: o.orderDateTs ?? existing?.orderDateTs ?? null,
                        pausedAt: existing?.pausedAt ?? defaultPausedAt
                    };
                });
                chrome.storage.local.set({ pausedOrders: paused });
            });
        }
    }
});

function finalize(id, status, staffOverride, tabId) {
    const timer = activeTimers[id];
    if (!timer) return;
    const now = new Date();
    const takenTime = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const date = now.toLocaleDateString();
    const entry = {
        id: id,
        user: staffOverride || timer.staff,
        status: status,
        born: timer.born,
        bornDate: timer.bornDate || date,
        taken: takenTime,
        date: date,
        satFor: `${Math.floor((Date.now() - timer.startTs) / 60000)}m ${Math.floor(((Date.now() - timer.startTs) % 60000) / 1000)}s`,
        timestamp: Date.now()
    };
    chrome.storage.local.get({ history: [] }, (data) => {
        const withoutThisId = data.history.filter(i => i.id !== id);
        const existing = data.history.find(i => i.id === id);
        if (existing) {
            const parseSecs = (s) => { if (!s || typeof s !== 'string') return 0; const m = String(s).match(/(\d+)\s*m\s*(\d+)\s*s/i) || String(s).match(/(\d+)/); return m ? (m[2] ? parseInt(m[1],10)*60 + parseInt(m[2],10) : parseInt(m[1],10)) : 0; };
            const entrySecs = parseSecs(entry.satFor);
            const existingSecs = parseSecs(existing.satFor);
            if (entrySecs <= existingSecs) {
                delete activeTimers[id];
                return;
            }
        }
        chrome.storage.local.set({ history: [entry, ...withoutThisId].slice(0, 5000) });
        chrome.tabs.sendMessage(tabId, { type: "LORE_UPDATE", entry: entry });
        delete activeTimers[id];
    });
}
