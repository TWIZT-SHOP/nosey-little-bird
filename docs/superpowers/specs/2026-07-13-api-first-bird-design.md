# Nosey Little Bird — API-first redesign

**Date:** 2026-07-13  
**Status:** Approved for planning  
**Repo:** `nosey-little-bird` (Brave/Chrome MV3 extension)

## Problem

The extension tracked Strobe unfilled orders by scraping the Unfilled Orders DOM. After a Strobe site redesign, it no longer sees orders. Monitoring required keeping that page open. Staff without a spare monitor (unlike the strobe-panel / case-bar style always-on HUD) need the same “queue is backing up” awareness while doing other work (e.g. YouTube).

## Goals

- Each user pastes their own **Strobe Hub API key**; bird polls the queue in the **background** while Brave is running — **no Strobe tab required**.
- Desktop **notification + whistle** when an unfilled order ages past the chosen **threat level** (HIGH 4m / MED 6m / LOW 8m) — not on brand-new orders.
- Watch the **whole** `NEW_OR_PENDING` queue (help clear backlog when not the primary taker). Assigned-to-you is irrelevant.
- Keep **who’s on now** (Nookmart + Overflow) so the user knows who to ping.
- Keep **HubSpot click-to-copy** order IDs; restore **paused** visibility via API (not “visit Paused on Strobe”).
- Schedule is password-gated monthly on **strobe.twizt.shop** (later **strobe.gg**). After the user unlocks the page in Brave, the bird reads and caches the schedule. **Never store the monthly password** in the extension.

## Non-goals (v1)

- Cloud/server poller holding API keys.
- SMS / Discord / non-browser alerts.
- Notify on every new order.
- Re-chasing fragile Strobe DOM as the primary data source.
- Bundling a shared team API key in the zip.

## Context (existing lab)

Lab already has a working Hub client (`ACNHSuperPoker/strobe-panel/daemon/strobe_api.py`):

- `POST https://strobe.gg/api/order/pull` with `Authorization: Bearer <key>`
- Body: `{ "order": { "code": "<CODE>" }, "page": 1 }`
- Codes include `NEW_OR_PENDING`, `PAUSED`, and others
- Rate limit: **30 requests/min** — back off on HTTP 429

## Approach

**API-first Brave extension** (chosen over DOM-fix or cloud poller).

```
Brave (running)
  └─ service worker
       ├─ chrome.alarms (~15–20s)
       ├─ POST /api/order/pull  Bearer <user key>
       │    ├─ NEW_OR_PENDING → live queue + age timers
       │    └─ PAUSED → HubSpot HUD / popup paused list
       ├─ threat check → notify + whistle (once per order per threshold)
       └─ chrome.storage.local

Schedule host (after user unlocks)
  └─ content script → cache roster for “who’s on now”

HubSpot inbox
  └─ content script → click-to-copy + paused HUD from storage
```

## Architecture

### Components

| Piece | Role |
|-------|------|
| `background.js` (service worker) | Poll Hub API; maintain timers; fire notify/whistle; write `currentOrders` / `pausedOrders` / history; badge count |
| `popup.html` / `popup.js` | API key field; threat / mute / volume; who’s-on-now; live unfilled + paused lists (copy); link to history |
| `content.js` (HubSpot) | Click-to-copy IDs; HUD for paused from storage |
| Schedule content script | Matches schedule host(s); after unlock, extract roster → `scheduleCsv` (or structured equivalent) |
| `schedule-shift.js` | Keep existing “is user on shift / who’s on now” helpers (Mountain time) |
| Optional Strobe helpers | Light copy-ID only; **not** required for monitoring |

### Data flow — unfilled

1. Alarm fires → if key present and monitoring not paused → `pull("NEW_OR_PENDING")`.
2. Normalize orders to `{ id, staff?, status, createdAt? }`.
3. For each id: if new, record `firstSeenAt` (prefer API created timestamp if available; else `Date.now()`).
4. Drop timers for ids no longer in pull (treat as taken/cleared; append history when useful).
5. If `now - firstSeenAt >= threatSeconds` and not yet whistled for that id → desktop notification + whistle (respect mute/volume).
6. Update badge to queue length; write `currentOrders` for popup.

### Data flow — paused

1. Same alarm cycle (or every other tick to stay under rate limit): `pull("PAUSED")`.
2. Write `pausedOrders` for HubSpot HUD and popup.
3. HubSpot content script hydrates HUD from storage (no dependency on viewing Strobe Paused).

### Data flow — schedule

1. User opens schedule URL and passes monthly password in the normal browser session.
2. Content script detects unlocked schedule content, extracts roster, stores in `chrome.storage.local`.
3. Popup / background show who’s on Nookmart / Overflow from cache.
4. If cache missing/stale: UI prompts “open schedule page to refresh.” Extension does **not** store or submit the password.

### Host permissions

- `https://strobe.gg/*` (API + future schedule)
- Current schedule host: `https://strobe.twizt.shop/*` (and path once known)
- Existing HubSpot match: `https://app.hubspot.com/live-messages/*`

## Alert & threat policy

| Setting | Seconds | Intent |
|---------|---------|--------|
| HIGH | 4 min | Early heads-up (team often delivers ≤5m; aim ≤15m) |
| MED | 6 min | Mid pressure |
| LOW | 8 min | Really pushing it |
| OFF | — | Mute monitoring alerts |

- Alert only when age **crosses** the selected marker — **not** on first sight of a new order.
- Fire **once per order id** per monitoring session (track `whistledOrderIds` or equivalent).
- Badge shows unfilled count for quiet glance.
- Optional pause-monitoring without clearing the API key.
- **Do not** gate polling/alerts on “operator is on Nookmart shift.” Who’s-on-now is for knowing who to ping; the point of the bird is helping clear the queue even when you are not the primary taker. (Retire the old default `monitorOnlyOnShift: true` behavior for API alerts.)

## UX (popup)

1. Strobe API key (masked) + Save / Clear  
2. Threat: HIGH / MED / LOW / OFF  
3. Volume + Test whistle  
4. Who’s on now + Overflow (from schedule cache)  
5. Current unfilled (id, age, copy)  
6. Paused (from API, copy)  
7. History / CSV (existing Bird Brain)

## Error handling

| Case | Behavior |
|------|----------|
| No / invalid key | No poll; badge “!”; popup asks for Hub API key |
| HTTP 429 | Back off (~60s); do not spam alerts |
| Network blip | Keep last known queue; retry next alarm |
| Schedule missing/stale | Show last cache + “open schedule page to refresh” |

## Security

- API key only in `chrome.storage.local` for that browser profile.
- Never commit or ship a real key.
- Schedule password never stored by the extension.

## Testing / acceptance

1. Real key → popup unfilled list matches Hub `NEW_OR_PENDING`.
2. YouTube (or any non-Strobe tab) foreground → notification when a queue order ages past selected threat.
3. `PAUSED` pull → HubSpot HUD shows paused; click-to-copy works.
4. Unlock schedule page → who’s-on-now updates without storing password.
5. Threat OFF or mute → no whistle and no desktop notify; badge may still show unfilled count.

## Migration from v1.3 DOM bird

- Retire DOM scan of Unfilled Orders as the source of truth.
- Keep history format, whistle asset, threat UI, schedule-shift helpers where possible.
- Version bump (e.g. 2.0) and README: “paste API key; no need to keep Unfilled open.”

## Open details (resolve in implementation plan)

- Exact schedule page URL/selectors on strobe.twizt.shop (inspect after unlock).
- Whether Hub order objects include a reliable created-at for age (fallback: firstSeen).
- Poll cadence split between NEW_OR_PENDING and PAUSED within the 30/min budget (e.g. unfilled every 15s, paused every 30s).
