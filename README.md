# Nosey Little Bird! Who Dat? Edition

Chrome extension that polls the **Strobe Hub API** for unfilled and paused orders, whistles when orders sit past your threat level, and shows who's on shift from the team schedule. HubSpot inbox gets a paused-order HUD and click-to-copy order IDs.

**Version:** 2.0

---

## Installation

1. Download or clone this folder.
2. Open Chrome (or Brave) and go to `chrome://extensions` (Brave: `brave://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.

**Brave (optional):** If Brave is fully closed, `scripts/install-brave.sh` from the main repo can register the unpacked extension automatically. If Brave is already running, use Load unpacked manually.

---

## Features

- **API polling** — Background polls Strobe Hub every ~1 minute. No need to keep the Unfilled Orders page open.
- **Threat levels** — HIGH (4 min), MED (6 min), or LOW (8 min). Bird Alert (notification + whistle) only when an order crosses your marker.
- **Paused orders** — Fetched from the API on alternating polls; shown in the popup and HubSpot HUD.
- **Schedule / who's on now** — Visit [https://strobe.twizt.shop](https://strobe.twizt.shop) once after Cloudflare Access login; the bird caches `schedule.json` and shows Nookmart + Overflow coverage in the popup. Manual CSV paste still works as a fallback.
- **HubSpot HUD** — Paused orders appear in a draggable HUD on `app.hubspot.com/live-messages`. IDs in the HUD are cyan; other order IDs on the page are orange. Click any wrapped ID to copy.
- **Bird Brain History** — Full order history with staff, status, born/gone times. Filter, export/import CSV.
- **Volume control** — Adjust whistle volume (0–200%) in the popup; replace `whistle.mp3` for a custom alert sound.

---

## Usage

1. **Load unpacked** from this folder (see Installation).
2. Open the popup and paste your **personal Strobe Hub API key**, then save.
3. Set **BIRD ALERT** threat level (HIGH / MED / LOW) or mute.
4. Open **https://strobe.twizt.shop** once while logged into Cloudflare Access so the bird can cache the schedule.
5. Work normally — unfilled orders are tracked in the background. Alerts fire when an order sits past your marker.
6. On **HubSpot live messages**, use the paused HUD and click-to-copy on order IDs. You do **not** need to visit Strobe's Paused page for the HUD to update.

**Rate limit:** Strobe Hub allows about **30 requests per minute** per key. The bird stays well under that with ~1-minute polling.

---

## Disclaimer

The bird needs a **valid personal API key** to see orders. It does not read Strobe page DOM anymore — if the API does not return an order, the bird cannot alert on it. Schedule caching uses your existing Cloudflare Access session cookies on `strobe.twizt.shop`; the extension never stores your Access password.

---

## Permissions

- **storage** / **unlimitedStorage** — History, settings, API key, schedule cache.
- **alarms** — Background poll (~1 min).
- **notifications** / **offscreen** — Bird Alert whistle and desktop notifications.
- **tabs** — Popup and history page.
- **https://strobe.gg/***, **https://strobe.twizt.shop/***, **https://docs.google.com/***
- Content scripts: HubSpot live messages (`content.js`); schedule cache on `strobe.twizt.shop` / `strobe.gg` (`schedule-content.js`).
