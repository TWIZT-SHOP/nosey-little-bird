# Nosey Little Bird

**See the Strobe queue without living on the Hub page.**

Staff keep Brave (or Chrome) running. Each person pastes their own Strobe Hub API key once. The bird watches unfilled orders in the background and alerts when the queue is sitting too long — so nobody has to leave HubSpot, YouTube, or another tab open on Strobe just to know work is piling up.

---

![Nosey Little Bird](docs/github-social.png)

---

## What you get

- **Background queue watch** — badge = unfilled count; desktop alert + sound when Strobe orders age past your Bird Alert level (Strobe page does not need to stay open)
- **Your key, your browser** — each person uses their own Hub API key from settings
- **HubSpot helpers** (when live messages is open) — dark mode, one-click copy for order IDs / dodo codes, optional lookup HUD — not HubSpot alerts
- **Who’s on shift** — after you unlock the schedule site once (or paste the CSV)

---

## Install

1. Download **`nosey-little-bird-*-staff.zip`** from  
   **[Latest release](https://github.com/chAosTwizt/nosey-little-bird/releases/latest)**  
   (the named zip — **not** “Source code”) → unzip
2. Open `brave://extensions` or `chrome://extensions`
3. Turn on **Developer mode**
4. **Load unpacked** → pick the folder that contains `manifest.json`
5. Pin the bird icon so the badge stays visible

**Updating:** Reload the extension (or remove + load the new folder), then refresh HubSpot if you use the HUD.

---

## First-time setup

1. Click the bird → **⚙ Settings**
2. Get your key at [strobe.gg/core/settings](https://strobe.gg/core/settings) → paste → **Save**  
   Use **your own** key. Don’t share it.
3. Set **BIRD ALERT**: HIGH (4m) / MED (6m) / LOW (8m) / **1 ORDER** / OFF  
   (click the button to cycle)
4. Optional: alert sound + volume — hit **TEST** once (uses the real alert engine). Queue check speed default is easy on your PC.
5. Open the schedule site once while logged in (for who’s on shift), or paste schedule CSV in Settings

**Pause monitoring** stops queue checks and clears the badge. Order lookup still works.

---

## Day to day

- Badge = how many unfilled orders are waiting
- Popup = local time, who’s on duty, queue snapshot
- **1 ORDER** = alert once when a waiting order shows up (handy on slow nights). Already-seen orders stay quiet until they leave and come back — cycle the button back to **1 ORDER** to re-arm a ping for what’s in queue now.
- Red flash = something has sat **15+ minutes**
- Queue alerts keep working with the Strobe page closed (alerts are for the Hub queue, not HubSpot)

---

## Privacy

Your API key stays in your browser profile only. Don’t paste keys, real order IDs, or customer chat into group chats when asking for help.

---

Built for Strobe Hub staff ops. Unofficial helper — does not replace HubSpot or Strobe Hub.
