// tests/strobe-api.test.mjs
import assert from "node:assert/strict";
import {
  normalizePulledOrders,
  normalizeSearchOrders,
  zeroOhVariants,
  THREAT_SECONDS,
} from "../strobe-api.js";

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

const searched = normalizeSearchOrders({
  success: true,
  results: {
    orders: [
      {
        publicId: "DXFC9094N3XKRY",
        status: "COMPLETE",
        worker: { ign: "chaos" },
      },
    ],
  },
});
assert.equal(searched.length, 1);
assert.equal(searched[0].id, "DXFC9094N3XKRY");
assert.equal(searched[0].status, "COMPLETE");
assert.equal(searched[0].staff, "chAos");

const variants = zeroOhVariants("3KOD2YR8SVXZ14");
assert.ok(variants.includes("3KOD2YR8SVXZ14"));
assert.ok(variants.includes("3K0D2YR8SVXZ14"));
console.log("strobe-api tests ok");
