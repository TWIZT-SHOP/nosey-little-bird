import assert from "node:assert/strict";
import {
  scheduleJsonToCsv,
  namesOnDutyAt,
} from "../schedule-from-json.js";

const sample = {
  sourceTz: "America/Phoenix",
  weeks: [
    {
      dates: [{ iso: "2026-07-13", label: "Jul 13" }],
      columns: [
        [
          {
            name: "chAos",
            start: "13:00",
            end: "18:00",
            startIso: "2026-07-13T13:00:00-07:00",
            endIso: "2026-07-13T18:00:00-07:00",
          },
        ],
      ],
    },
  ],
};

const csv = scheduleJsonToCsv(sample);
assert.match(csv, /Nookmart/);
assert.match(csv, /chAos/);

const at = Date.parse("2026-07-13T15:00:00-07:00");
const names = namesOnDutyAt(sample, at);
assert.deepEqual(names, ["chAos"]);
console.log("schedule-from-json tests ok");
