let flashTimer = null;
let pollTimer = null;

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
  // First tick soon so cadence change feels immediate
  chrome.runtime.sendMessage({ type: "POLL_TICK" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

  const vol = Math.min(2, Math.max(0, Number(msg.volume) || 0.5));
  const src =
    String(msg.src || "").trim() ||
    chrome.runtime.getURL("sounds/whistle.mp3");

  try {
    const audio = new Audio(src);
    // HTMLMediaElement.volume caps at 1; boost via WebAudio when > 100%
    if (vol <= 1) {
      audio.volume = vol;
      audio
        .play()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    const ctx = new AudioContext();
    const track = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = vol;
    track.connect(gain);
    gain.connect(ctx.destination);
    audio.volume = 1;
    audio
      .play()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    audio.addEventListener("ended", () => {
      try {
        ctx.close();
      } catch (_) {}
    });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
  return true;
});
