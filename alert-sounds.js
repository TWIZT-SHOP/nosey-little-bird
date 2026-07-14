/** Built-in Bird Alert sounds (bundled under sounds/). */
export const ALERT_SOUNDS = [
  { id: "whistle", label: "Bird Whistle", file: "sounds/whistle.mp3" },
  { id: "drop", label: "Strobe Drop", file: "sounds/drop.mp3" },
  { id: "original", label: "Strobe Original", file: "sounds/original.wav" },
  { id: "kaching", label: "Strobe Ka-ching", file: "sounds/kaching.mp3" },
  { id: "thud", label: "Strobe Thud", file: "sounds/thud.mp3" },
  { id: "punch", label: "Strobe Punch", file: "sounds/punch.mp3" },
  { id: "bruh", label: "Strobe Bruh", file: "sounds/bruh.mp3" },
  { id: "custom", label: "Custom file…", file: null },
];

export const DEFAULT_ALERT_SOUND = "whistle";

export function soundById(id) {
  return ALERT_SOUNDS.find((s) => s.id === id) || ALERT_SOUNDS[0];
}

/** Resolve playable URL for offscreen / popup (extension path or custom data URL). */
export function resolveAlertSrc(soundId, customDataUrl) {
  const id = soundId || DEFAULT_ALERT_SOUND;
  if (id === "custom") {
    const data = String(customDataUrl || "").trim();
    if (data.startsWith("data:audio") || data.startsWith("data:application")) return data;
    return chrome.runtime.getURL("sounds/whistle.mp3");
  }
  const meta = soundById(id);
  const file = meta?.file || "sounds/whistle.mp3";
  return chrome.runtime.getURL(file);
}
