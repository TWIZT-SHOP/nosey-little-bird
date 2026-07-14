chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
