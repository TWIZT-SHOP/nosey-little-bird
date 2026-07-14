(async function () {
  const MAX_TRIES = 8;
  const DELAY_MS = 1500;
  let inFlight = false;

  async function tryFetchSchedule() {
    try {
      const url = new URL("/schedule.json", location.origin).href;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      if (!data?.weeks) return { error: "missing weeks" };
      return { data };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }

  /** Write cache from the page — do not rely on the service worker being awake. */
  function persistSchedule(data) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(
          {
            scheduleJson: data,
            scheduleCachedAt: Date.now(),
            scheduleCacheError: "",
          },
          () => {
            void chrome.runtime.lastError;
            resolve(true);
          }
        );
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function cacheSchedule() {
    if (inFlight) return;
    inFlight = true;
    try {
      for (let i = 0; i < MAX_TRIES; i++) {
        const result = await tryFetchSchedule();
        if (result.data) {
          await persistSchedule(result.data);
          // Best-effort: also notify SW so it can rebuild CSV for paste/legacy.
          try {
            chrome.runtime.sendMessage(
              { type: "SCHEDULE_RAW_JSON", data: result.data },
              () => {
                void chrome.runtime.lastError;
              }
            );
          } catch (_) {
            /* ignore */
          }
          return;
        }
        if (i === MAX_TRIES - 1) {
          try {
            chrome.storage.local.set({
              scheduleCacheError: String(result.error || "fetch failed"),
            });
          } catch (_) {
            /* ignore */
          }
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    } finally {
      inFlight = false;
    }
  }

  await cacheSchedule();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") cacheSchedule();
  });
})();
