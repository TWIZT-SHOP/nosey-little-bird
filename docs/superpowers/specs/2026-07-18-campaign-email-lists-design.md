# Campaign email lists (Bird Brain) — design

**Date:** 2026-07-18  
**Status:** Approved for planning  
**Build:** DEV only (`BUILD_PROFILE === "dev"` / Bird Brain). Staff pack stays lean.

## Goal

While staff work HubSpot live-messages, the bird collects customer **From** emails and sorts them into campaign-ready lists. Primary campaign list is **Nook Mart (ACNH)**. Other brands are kept so nothing is lost and can be reviewed or re-bucketed later.

## Product rules

### Collect

- **When:** Automatically when a HubSpot live-messages thread is open/viewed (and collect toggle is on).
- **What:** Customer email from **From** (display name optional).
- **Sources (both):**
  1. **Primary — DOM:** Parse From/To (and related thread metadata) from the HubSpot UI (including the message metadata popover: From / To / Date / Subject).
  2. **Also — in-page / API payload:** If HubSpot already exposes participant emails in page data or network payloads the extension can read while on the thread, harvest those too. Same bucket rules. No HubSpot private-app token required in v1.
- **Skip as “customer” From:** `@hubspot.com`, own brand support addresses used as sender, empty/invalid addresses. Do not add staff tooling noise to campaign lists.

### Buckets (sort after collect)

Every kept address lands in exactly one bucket. Prefer a brand bucket over Unknown when signal exists.

| Bucket | Signal (v1) |
|--------|-------------|
| **nookmart** | To/mailbox or thread links mention `nookmart.com` / `support@nookmart.com` |
| **kitty** | `kittymart.com` / Kitty Mart signals (e.g. order URLs on kittymart.com) |
| **pokemon** | Known Pokemon shop domain/mailbox when configured; empty rule set until known → rare until then |
| **unknown** | No clear brand signal (or mixed/unclear) |

**Campaign use:** Copy-all from **nookmart** for ACNH campaigns. Other lists are for review / move / later campaigns.

### Dedupe & re-sort

- Key: email lowercased / trimmed.
- Same address seen again: update `lastSeen`, merge name if newly available, refresh source tags.
- Stronger brand signal may promote out of **unknown** into nookmart / kitty / pokemon. Do not delete the row when re-bucketing.
- Manual **Move to…** on a row overrides / sets bucket explicitly (stored as user override so auto-sort does not immediately fight the user without new stronger opposite signal — implementation detail: once manually moved, prefer manual bucket unless user moves again).

### Pause / wipe

- Settings (DEV): **Collect campaign emails** (default on for DEV).
- Off → no new upserts; existing lists remain.
- **Wipe emails** clears campaign email storage only — not order history / Bird Brain memories.

## Architecture

| Piece | Responsibility |
|-------|----------------|
| `content.js` (HubSpot) | Observe open thread; extract From/To (+ in-page payloads when available); classify bucket; message SW to upsert |
| `background.js` | Own `campaignEmails` in `chrome.storage.local`; dedupe; honor pause + DEV feature flag |
| `build-profile.js` / `content-features.js` | Feature flag e.g. `campaignEmails: IS_DEV` |
| Bird Brain (`history.html` / `history.js`) | Tabs: **Orders** \| **Emails**; bucket filters; table; copy/delete/wipe/move |
| Popup settings | Collect toggle; fix update-check copy so DEV does not say “staff build” |

### Storage shape (logical)

```text
campaignEmails: Array<{
  email: string,          // canonical lowercase
  name?: string,
  bucket: "nookmart" | "kitty" | "pokemon" | "unknown",
  bucketManual?: boolean,
  firstSeen: number,      // ms
  lastSeen: number,
  sources: Array<"dom" | "api">,
  signals?: string[]      // e.g. "to:support@nookmart.com", "link:kittymart.com"
}>
campaignEmailsCollect: boolean  // default true when feature on
```

Cap: generous but bounded (e.g. 5000 rows); drop oldest by `lastSeen` if over cap.

## UI

### Bird Brain → Emails

- Filters with counts: Nook Mart · Kitty · Pokemon · Unknown
- Columns: email, name, bucket, first seen, last seen, source
- **Copy all** — emails in the current filter, one per line (no CSV in v1)
- Per-row delete; **Move to…** bucket
- **Wipe emails** (confirm)

### Settings DEV

- Checkbox: Collect campaign emails
- Update status string uses build label (**DEV** vs **STAFF**), not hard-coded “staff”

## Out of scope (v1)

- CSV export
- HubSpot private app / PAT setup
- Sending campaigns from the bird
- Staff build distribution of this feature
- Perfect Pokemon auto-sort before the domain is known (Unknown is fine)

## Success criteria

1. Opening a Nook Mart thread with a visible customer From adds/updates that email under **nookmart**.
2. A Kitty Mart thread (`kittymart.com`) lands under **kitty**, not nookmart.
3. Unclear brand → **unknown**, not dropped.
4. Copy all on Nook Mart produces a pasteable one-per-line list.
5. Staff pack does not expose the feature; DEV does.
6. DEV settings update line does not claim “staff build”.

## Testing notes

- Fixture HTML snippets for HubSpot From/To popover text.
- Unit tests for bucket classifier (nook / kitty / unknown / skip internal).
- Manual: live HubSpot Nook vs Kitty thread, confirm Bird Brain counts + copy.
