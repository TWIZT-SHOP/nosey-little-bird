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

  async function cacheSchedule() {
    if (inFlight) return;
    inFlight = true;
    try {
      for (let i = 0; i < MAX_TRIES; i++) {
        const result = await tryFetchSchedule();
        if (result.data) {
          chrome.runtime.sendMessage(
            { type: "SCHEDULE_RAW_JSON", data: result.data },
            () => void chrome.runtime.lastError
          );
          return;
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
