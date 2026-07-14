# Nosey Little Bird! Who Dat? Edition

Browser extension (Chrome / Brave) for Strobe Hub queue alerts, order lookup, shift coverage, and HubSpot inbox helpers.

This repo is the **staff build** — the version you load and share with the team. Version: see `manifest.json`.

---

## What it does

| Area | Works when… |
|------|-------------|
| **Queue monitoring** (unfilled count on the toolbar icon, Bird Alert whistle) | Always — background poll of **Strobe Hub API**. HubSpot does **not** need to be open. |
| **Order lookup** (who / status / staff note) | Always — popup search and/or HubSpot HUD search, via Strobe Hub API. |
| **Who’s on shift** | After schedule is cached (visit schedule site once, or paste CSV). |
| **HubSpot HUD** (dark inbox tint, orange order IDs, optional HUD search / paused list) | Only while a HubSpot **live-messages** tab is open. Closing HubSpot closes the HUD. |

There is **no HubSpot chat API** in this extension. Inbox helpers only run while HubSpot is open.

This build does **not** grow a local order history list (no Bird Brain / Previous).

---

## Install

1. Get this folder (clone, zip, or a packed copy that contains `manifest.json`).
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. **Load unpacked** → select this folder.
5. Pin the bird icon if you want the badge visible.

**After an update:** on the extensions page, click **Reload** on Nosey Little Bird, then hard-refresh any open HubSpot tab.

**Brave tip:** if Brave is fully closed, `scripts/install-brave.sh` can register an unpacked path. If Brave is already running, use Load unpacked manually.

### Pack a clean staff copy (maintainers)

```bash
./scripts/pack-extension.sh staff
```

Default output: `~/Documents/nosey-little-bird-staff`. Share **that** folder (or a zip of it), not personal experiments.

---

## First-time setup

1. Click the bird toolbar icon → **⚙ Settings**.
2. Paste your **personal Strobe Hub API key** → **Save**.  
   - Accepts `strb_…` or a bare 40-character hex (auto-prefixed).  
   - Use **your own** key. Do not share keys in chat, screenshots, or git.
3. Set **BIRD ALERT** on the main popup: HIGH (4m) / MED (6m) / LOW (8m), or mute. Click the button to cycle.
4. (Optional) Pick an **alert sound** and volume; use **TEST**.
5. Open the schedule site once while logged in (Cloudflare Access), so the bird can cache who’s on shift. Or paste schedule CSV in Settings → Schedule → Save.
6. On HubSpot live messages, turn on the HUD pieces you want (search on HUD, paused list, dark mode).

**Pause monitoring** stops queue polling and clears the toolbar badge. Order lookup still works.

---

## Day-to-day use

### Toolbar / popup

- Badge = count of unfilled orders from the API (empty when monitoring is paused).
- Main popup: local time, on-duty names, queue count.
- Enable **Show search in popup** to look up an order ID without HubSpot.
- Optional lists: Pending / Paused.

### HubSpot live messages

- Order-looking IDs on the page are highlighted. **Click** → copies to clipboard; if HUD search is on, fills and runs the HUD lookup.
- **BIRD HUD** (when search and/or paused list is enabled): draggable overlay for lookup and/or paused rows from the API.
- Dark mode tint is optional in Settings.

**HUD and page highlights only exist while HubSpot is open.** Queue alerts do not need HubSpot.

---

## Privacy & screenshots

When documenting, demoing, or filing issues:

**Do not** include:

- Real **order IDs**, dodo codes, or payment references  
- Customer / visitor names or message text  
- Staff personal notes from lookups  
- HubSpot portal / inbox / thread IDs from the URL  
- API keys, cookies, or Cloudflare Access details  
- Full inbox screenshots with live chats  

**Do** use:

- Fake IDs like `ORDERID123EXAMPLE`  
- Cropped UI that shows only the bird chrome (popup / HUD frame)  
- Descriptions instead of screenshots when the page has chat content  

API keys live in **browser extension storage** on that profile only. Never commit keys or real customer data into git.

---

## Permissions (why they’re needed)

| Permission / host | Why |
|-------------------|-----|
| `storage` / `unlimitedStorage` | Settings, API key, schedule cache |
| `alarms` | ~1 minute background poll |
| `notifications` / `offscreen` | Desktop alert + whistle audio |
| `tabs` | Popup helpers |
| `https://strobe.gg/*`, `https://strobe.twizt.shop/*` | Hub API + schedule cache |
| `https://docs.google.com/*` | Optional schedule-related fetch |
| Content script on HubSpot live-messages | HUD + ID highlight/copy (page-only) |

---

## Limits & expectations

- Strobe Hub rate limit is roughly **~30 requests/minute** per key. Default polling stays well under that.
- If the API does not return an order, the bird cannot alert or look it up.
- Schedule cache uses your existing browser session on the schedule site; the extension does not store your Access password.
- Toolbar popup cannot be force-opened from a page click (browser security). Use HUD search or open the bird icon yourself.

---

## Disclaimer

Nosey Little Bird is an unofficial helper for staff workflow. It depends on a valid personal Strobe Hub API key and (for HUD features) an open HubSpot live-messages tab. It does not replace HubSpot or Strobe Hub.
