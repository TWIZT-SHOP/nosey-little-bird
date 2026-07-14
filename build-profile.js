/**
 * Build profile — staff is the shared / default product.
 * Local-only experiments: `./scripts/pack-extension.sh dev` (do not distribute).
 */
export const BUILD_PROFILE = "staff";

export const IS_DEV = BUILD_PROFILE === "dev";
export const IS_STAFF = BUILD_PROFILE === "staff";

/** Feature flags — staff stays lean so HubSpot + Brave don't bog down. */
export const FEATURES = {
  /** Persist lookups / queue-leave into Bird Brain history page */
  birdBrain: IS_DEV,
  /** Absorb/Extract lore CSV on history page */
  birdBrainImportExport: IS_DEV,
  /** Custom uploaded alert sound (can be large in storage) */
  customAlertSound: IS_DEV,
  /** Popup "FULL HISTORY" / Bird Brain nav */
  historyPage: IS_DEV,
  /** Cap for history[] when birdBrain is on */
  historyMaxEntries: IS_DEV ? 2000 : 0,
  /** HubSpot HUD refresh (ms). 1s was chewing CPU for everyone. */
  hudRefreshMs: IS_DEV ? 3000 : 8000,
  /** Show build badge in popup settings */
  showBuildBadge: true,
};

export function buildLabel() {
  return IS_DEV ? "DEV" : "STAFF";
}
