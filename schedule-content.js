(async function () {
  async function tryFetchSchedule() {
    try {
      const url = new URL("/schedule.json", location.origin).href;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const data = await tryFetchSchedule();
  if (!data?.weeks) return;

  chrome.runtime.sendMessage({ type: "SCHEDULE_RAW_JSON", data }, () => {});
})();
