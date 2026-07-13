chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "PLAY_WHISTLE") return;
  const vol = Math.min(2, Math.max(0, Number(msg.volume) || 0.5));
  const audio = new Audio(chrome.runtime.getURL("whistle.mp3"));
  audio.volume = Math.min(1, vol);
  audio.play().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
