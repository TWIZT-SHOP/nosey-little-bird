# Nosey Little Bird! Who Dat? Edition

Chrome / Brave extension for Strobe Hub queue alerts, order lookup, who’s on shift, and HubSpot inbox helpers.

---

## What it does

| Feature | Notes |
|---------|--------|
| **Queue monitoring** | Toolbar badge + Bird Alert when unfilled orders sit too long. Runs in the background — HubSpot does not need to be open. |
| **Order lookup** | Who / status / staff note via Strobe Hub (popup search and/or HubSpot HUD). |
| **Who’s on shift** | After you unlock the schedule once (or paste CSV in Settings). |
| **HubSpot helpers** | Dark tint, highlighted order IDs, optional HUD search and paused list — while HubSpot live messages is open. |

---

## Install

Get the **latest** build (look for **⚙** next to BIRD ALERT — that’s the current UI):

1. Download **`nosey-little-bird-*-staff.zip`** from:  
   **https://github.com/chAosTwizt/nosey-little-bird/releases/latest**  
   (the named zip — not “Source code”) → unzip  
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. **Load unpacked** → select the unzipped folder that contains `manifest.json`.
5. Pin the bird icon if you want the badge visible.

**Wrong / old build:** if you see “Current time (Mountain)” and the API key on the front screen with no ⚙, remove that extension and install from **Latest** above.

**After an update:** remove or Reload the old load-unpacked folder, load the new files, then refresh HubSpot.

---

## First-time setup

1. Click the bird icon → **⚙ Settings**.
2. Get your personal API key from [Strobe Hub settings](https://strobe.gg/core/settings), paste it → **Save**. Use **your own** key — don’t share it.
3. Set **BIRD ALERT**: HIGH (4m) / MED (6m) / LOW (8m) / **1 ORDER** (any new unfilled order) / OFF. Click the button to cycle.
4. (Optional) **Queue check speed** — Every ~1 min (default, easy on PC), 30s, or 15s (snappier, more load).
5. (Optional) Pick an alert sound and volume; use **TEST**.
6. Open the schedule site once while logged in, so who’s-on-shift can update. Or paste schedule CSV under Settings → Schedule → Save.
7. On HubSpot, turn on the HUD options you want (search, paused list, dark mode).

**Pause monitoring** stops queue polling and clears the badge. Lookup still works.

---

## Day-to-day

### Toolbar / popup

- Badge = unfilled order count (empty when monitoring is paused).
- Popup shows local time, who’s on duty, and queue count.
- **1 ORDER** mode is handy on slow nights — alerts when any unfilled order appears.
- Icon **flashes red** (and the queue count flashes) when an order has sat **15+ minutes**.
- Turn on **Show search in popup** to look up an ID without HubSpot.
- Optional lists: Pending / Paused.

### HubSpot

- Highlighted order IDs: click to copy (and fill HUD search when that’s on).
- **BIRD HUD**: lookup and/or paused list when enabled in Settings.
- Queue alerts still work with HubSpot closed; the on-page HUD does not.

---

## Privacy

- Don’t share API keys, real order IDs, chat screenshots, or customer details when asking for help.
- Your key stays in your browser’s extension storage on your profile only.

---

## Permissions

| Permission | Why |
|------------|-----|
| Storage | Settings, your API key, schedule cache |
| Alarms / offscreen timer | Background queue check (Settings: ~60s / 30s / 15s) |
| Notifications / offscreen | Desktop alert + sound |
| Tabs | Open helper pages |
| strobe.gg / strobe.twizt.shop | Hub API + schedule |
| HubSpot live-messages | On-page HUD and ID helpers |

---

## Notes

- Each person uses their own Strobe Hub API key from [settings](https://strobe.gg/core/settings).
- If Hub doesn’t return an order, the bird can’t look it up or alert on it.
- Unofficial helper — does not replace HubSpot or Strobe Hub.
