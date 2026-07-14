export function scheduleJsonToCsv(data) {
  const lines = ["Section,Date,Day,Users,Start,End,Hours,Notes"];
  const weeks = data?.weeks || [];
  for (const week of weeks) {
    const dates = week.dates || [];
    const columns = week.columns || [];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      const shifts = columns[i] || [];
      const iso = d.iso || "";
      // ISO date avoids M/D vs D/M ambiguity in parsers
      const dateStr = iso || d.label || "";
      const dayName = iso
        ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: "UTC",
          })
        : "";
      for (const s of shifts) {
        if (!s?.name || /^OPEN$/i.test(s.name)) continue;
        lines.push(
          ["Nookmart", dateStr, dayName, s.name, s.start || "", s.end || "", "", ""]
            .map(csvEscape)
            .join(",")
        );
      }
    }
  }
  return lines.join("\n");
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function namesOnDutyAt(data, nowMs) {
  const names = [];
  for (const week of data?.weeks || []) {
    for (const col of week.columns || []) {
      for (const s of col || []) {
        if (!s?.name || /^OPEN$/i.test(s.name)) continue;
        const a = Date.parse(s.startIso);
        const b = Date.parse(s.endIso);
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        if (nowMs >= a && nowMs < b) names.push(normalizeName(s.name));
      }
    }
  }
  return [...new Set(names)];
}

function normalizeName(n) {
  const t = String(n).trim();
  if (/^chaos$/i.test(t)) return "chAos";
  return t;
}
