"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setAudioMode } from "@/lib/audio-unlock";

interface RecordOptions {
  /** Stop automatically after the speaker goes quiet. */
  autoStop?: boolean;
  silenceMs?: number;
  /** Give up if nobody speaks within this window (auto mode). */
  noSpeechMs?: number;
  maxMs?: number;
}

export class MicrophoneError extends Error {}

/**
 * Microphone recorder with simple voice-activity detection (WebAudio RMS).
 * Audio stays in the browser until it is sent to the local backend.
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const cancelledRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const record = useCallback(async (opts: RecordOptions = {}): Promise<Blob | null> => {
    const { autoStop = true, silenceMs = 1100, noSpeechMs = 8000, maxMs = 30000 } = opts;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicrophoneError(
        "The microphone only works on a secure (https) page. On a phone, open AVENZA on its https address, not 192.168.x.x.",
      );
    }
    setAudioMode("record"); // iPhone: the microphone only works in record mode
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      throw new MicrophoneError("Microphone permission was denied. Allow it in the browser's address bar.");
    }

    // iPhone Safari records AAC in MP4; the backend decodes all of these.
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const ctx = new AudioContext();
    // Phones start an AudioContext paused unless a tap created it. A paused one measures silence, so the
    // recorder would think nobody spoke and stop (or cut you off). Resume it, and if it stays paused, stop
    // judging by loudness at all (see "blind" below).
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const started = performance.now();
    let floor = 0.004;
    let heard = false;
    let loudSince = 0;
    let quietSince = 0;
    let raf = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      const elapsed = now - started;
      setLevel(Math.min(1, rms * 9));

      // Calibrate background noise, capped: talking straight away must not raise the bar above your voice.
      if (elapsed < 350) floor = Math.min(0.02, Math.max(floor, rms));
      const threshold = Math.max(0.012, floor * 2.5);
      // The meter cannot hear (context never started): keep recording until the user stops or maxMs.
      const blind = ctx.state !== "running" && elapsed > 1000;
      if (rms > threshold) {
        loudSince ||= now;
        quietSince = 0;
        if (now - loudSince > 150) heard = true;
      } else {
        loudSince = 0;
        quietSince ||= now;
      }

      const silenceDone = autoStop && !blind && heard && quietSince && now - quietSince > silenceMs;
      const nobody = autoStop && !blind && !heard && elapsed > noSpeechMs;
      if ((silenceDone || nobody || elapsed > maxMs) && rec.state === "recording") {
        if (nobody) cancelledRef.current = true;
        rec.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    let cleaned = false;
    const cleanup = () => {
      // Can run from onstop, cancel() and unmount: make it safe to call more than once.
      if (cleaned) return;
      cleaned = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      if (ctx.state !== "closed") ctx.close().catch(() => {});
      setRecording(false);
      setLevel(0);
      recRef.current = null;
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    cancelledRef.current = false;

    return new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        resolve(cancelledRef.current || blob.size < 1200 ? null : blob);
      };
      recRef.current = rec;
      rec.start(250);
      setRecording(true);
      raf = requestAnimationFrame(tick);
    });
  }, []);

  /** Finish now and keep what was said. */
  const stop = useCallback(() => {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  /** Finish now and discard the audio. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recRef.current?.state === "recording") recRef.current.stop();
    else cleanupRef.current?.();
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  return { record, stop, cancel, recording, level };
}
