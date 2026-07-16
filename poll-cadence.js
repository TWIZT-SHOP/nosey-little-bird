/** Hub queue poll cadence (seconds). Sub-minute needs offscreen timer. */
export const POLL_INTERVAL_OPTIONS = [
  {
    sec: 60,
    label: "Every ~1 min (easy on PC)",
  },
  {
    sec: 30,
    label: "Every 30s (balanced)",
  },
  {
    sec: 15,
    label: "Every 15s (snappy, more load)",
  },
];

export const DEFAULT_POLL_INTERVAL_SEC = 60;

const ALLOWED = new Set(POLL_INTERVAL_OPTIONS.map((o) => o.sec));

export function normalizePollIntervalSec(raw) {
  const n = Number(raw);
  if (ALLOWED.has(n)) return n;
  return DEFAULT_POLL_INTERVAL_SEC;
}

export function pollIntervalNeedsOffscreen(sec) {
  return normalizePollIntervalSec(sec) < 60;
}

export function labelForPollInterval(sec) {
  const n = normalizePollIntervalSec(sec);
  return POLL_INTERVAL_OPTIONS.find((o) => o.sec === n)?.label || `Every ${n}s`;
}
