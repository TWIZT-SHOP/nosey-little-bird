// tests/queue-monitor.test.mjs
import assert from "node:assert/strict";
import {
  applyQueueSnapshot,
  ordersCrossingThreat,
  markWhistled,
  THREAT_SECONDS,
} from "../queue-monitor.js";

let state = { byId: {}, whistled: {} };
const t0 = 1_000_000;

state = applyQueueSnapshot(state, [{ id: "A", createdAtMs: null }], t0);
assert.equal(state.byId.A.firstSeenAt, t0);

state = applyQueueSnapshot(state, [{ id: "A", createdAtMs: null }], t0 + 1000);
assert.equal(state.byId.A.firstSeenAt, t0);

const cross = ordersCrossingThreat(
  state,
  t0 + THREAT_SECONDS.high * 1000,
  "high"
);
assert.deepEqual(cross, ["A"]);

state = markWhistled(state, ["A"]);
assert.deepEqual(
  ordersCrossingThreat(state, t0 + THREAT_SECONDS.high * 1000, "high"),
  []
);

state = applyQueueSnapshot(state, [], t0 + 5000);
assert.equal(state.byId.A, undefined);
console.log("queue-monitor tests ok");
