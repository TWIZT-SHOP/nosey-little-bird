# Nosey Little Bird! Who Dat? Edition

Chrome extension for tracking unfilled orders on **Strobe.gg** and **HubSpot** with audible alerts when orders sit too long. Shows who's on shift (Nookmart) and backup (Overflow) from a pasted schedule. Popup lists live and recent orders with click-to-copy IDs; full history with CSV export/import; volume control; HubSpot HUD for paused orders.

**Version:** 1.3

---

## Installation

1. Download and unzip the extension folder.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the unzipped extension folder.

---

## Features

- **Order tracking** – Keeps an eye on unfilled orders while you have the Strobe Unfilled Orders page open.
- **Bird Alert (whistle)** – Audible alert when orders sit past your chosen threshold (4 min / 6 min / 8 min). Toggle via the popup button; use TEST to preview. To use your own alert sound, replace `whistle.mp3` in the extension folder with your own MP3 file (keep the name `whistle.mp3`).
- **Volume control** – Adjust alarm volume (0–200%) in the popup.
- **Schedule** – Paste a CSV schedule (Mountain time) to see who’s on shift (Nookmart) and backup (Overflow).
- **Bird Brain History** – Full history with staff names, status, born/gone times, Sat For. Filter by user, export/import CSV.
- **Click to copy** – Click any order ID on Strobe, HubSpot, or in history to copy it; search on Strobe to update the user. On HubSpot, order IDs in your HUD (paused) are cyan; other order IDs are orange.
- **HubSpot HUD** – When viewing Paused Orders on Strobe, they appear in the HubSpot inbox HUD. Keep Unfilled Orders open to track; check Paused Orders to see them in Hub.

---

## Usage

- **Keep the Unfilled Orders page open** on Strobe to track orders and receive alerts.
- Use the **BIRD ALERT** button in the popup to set threshold (HIGH 4m / MED 6m / LOW 8m) or mute.
- Click **VIEW FULL HISTORY / CSV** to open Bird Brain, filter by user, export/import, and manage history.
- Click an order ID anywhere to copy it; search on Strobe to update staff info.

---

## Disclaimer

If you didn't see it, neither did the Bird. The extension only sees what's on the screen.

---

## Permissions

- **storage** / **unlimitedStorage** – Saves history, settings, schedule.
- **activeTab** / **tabs** – For popup and opening history.
- **https://docs.google.com/*** – Schedule (if used).
- Content scripts run on `*.strobe.gg` and `app.hubspot.com/live-messages/*`.
