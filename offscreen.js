let flashTimer = null;
let pollTimer = null;
/** Kept warm so Bird Alerts aren't blocked by autoplay after SW wake. */
let audioCtx = null;

function stopFlash() {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
}

function stopPollTimer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Sub-minute Hub polls — chrome.alarms floor is ~1 min. */
function setPollCadence(seconds) {
  stopPollTimer();
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 15 || sec >= 60) return;
  const ms = Math.round(sec * 1000);
  pollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: "POLL_TICK" }).catch(() => {
      stopPollTimer();
    });
  }, ms);
  chrome.runtime.sendMessage({ type: "POLL_TICK" }).catch(() => {});
}

async function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (self.AudioContext || self.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  return audioCtx;
}

/** Decode + play via WebAudio (more reliable than HTMLAudioElement in offscreen). */
async function playAlert(src, volume) {
  const vol = Math.min(2, Math.max(0, Number(volume) || 0.5));
  const url =
    String(src || "").trim() || chrome.runtime.getURL("sounds/whistle.mp3");

  const ctx = await ensureAudioCtx();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sound fetch ${res.status}`);
  const raw = await res.arrayBuffer();
  const buf = await ctx.decodeAudioData(raw.slice(0));
  const gain = ctx.createGain();
  gain.gain.value = vol;
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.connect(gain);
  gain.connect(ctx.destination);
  node.start();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING_OFFSCREEN" || msg?.type === "PING") {
    sendResponse({ ok: true, offscreen: true });
    return false;
  }
  if (msg?.type === "SET_POLL_CADENCE") {
    setPollCadence(msg.seconds);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "START_ICON_FLASH") {
    stopFlash();
    flashTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: "ICON_FLASH_TICK" }).catch(() => {
        stopFlash();
      });
    }, 700);
    chrome.runtime.sendMessage({ type: "ICON_FLASH_TICK" }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "STOP_ICON_FLASH") {
    stopFlash();
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type !== "PLAY_ALERT" && msg?.type !== "PLAY_WHISTLE") return;

  playAlert(msg.src, msg.volume)
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

// Warm the audio graph early so the first real alert is less likely to be blocked.
ensureAudioCtx().catch(() => {});
