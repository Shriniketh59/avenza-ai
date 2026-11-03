/**
 * Mobile Safari only plays sound that a tap started. Voice replies arrive seconds after the tap, so the
 * player would be blocked (silently). Calling unlockAudio() inside the tap that opens voice mode plays a
 * 25 ms silent clip on the shared player; after that, the same player may play replies at any time.
 */

// 25 ms of silence (8 kHz, 16-bit mono WAV).
const SILENCE = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let shared: HTMLAudioElement | null = null;

/** The one audio element all speech plays through (unlocked by the first tap). */
export function speechAudio(): HTMLAudioElement {
  return (shared ??= new Audio());
}

/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * iOS 17+ audio session. "play-and-record" lets the microphone work but plays at call (earpiece) level;
 * "playback" uses the loudspeaker at full media volume but switches the microphone off. So: record mode while
 * listening, playback mode while AVENZA speaks (the microphone is already closed by then).
 */
export function setAudioMode(mode: "record" | "play"): void {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = mode === "record" ? "play-and-record" : "playback";
}

/** Call from a click/tap handler, before any await. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  setAudioMode("record");
  const el = speechAudio();
  if (!el.src || el.src === SILENCE) {
    el.src = SILENCE;
    el.play().catch(() => {});
  }
}
