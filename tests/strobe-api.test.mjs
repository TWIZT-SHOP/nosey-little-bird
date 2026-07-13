// tests/strobe-api.test.mjs
import assert from "node:assert/strict";
import { normalizePulledOrders, THREAT_SECONDS } from "../strobe-api.js";

const sample = {
  success: true,
  pulled: {
    orders: [
      {
        publicId: "ABC123DEF45678",
        status: "NEW",
        form: { extendedData: {} },
        breakdown: { total: 1500 },
      },
    ],
  },
};

const orders = normalizePulledOrders(sample);
assert.equal(orders.length, 1);
assert.equal(orders[0].id, "ABC123DEF45678");
assert.equal(orders[0].status, "NEW");
assert.equal(THREAT_SECONDS.high, 240);
assert.equal(THREAT_SECONDS.medium, 360);
assert.equal(THREAT_SECONDS.low, 480);
console.log("strobe-api tests ok");
