import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { blitExportFrameDirect } from "../tools/exportCanvas";

/**
 * Animation progress shared between React state (for drawing) and the video
 * recorder (reads `.current` synchronously so the first encoded frame matches
 * a freshly-reset animation).
 */
export function useAnimProgress(initial = 1) {
  const ref = useRef(initial);
  const [value, setValueState] = useState(initial);
  const setValue = useCallback((v: number) => {
    ref.current = v;
    setValueState(v);
  }, []);
  return [value, setValue, ref] as const;
}

/**
 * Finalize a recording only after the play-in animation finishes — not on the
 * first frame when `recording` is true but `animating` has not flipped yet.
 */
export function useStopRecordWhenAnimatingEnds(
  recording: boolean,
  animating: boolean,
  stop: () => void,
) {
  const sawAnimationRef = useRef(false);
  useEffect(() => {
    if (!recording) {
      sawAnimationRef.current = false;
      return;
    }
    if (animating) {
      sawAnimationRef.current = true;
      return;
    }
    if (sawAnimationRef.current) {
      sawAnimationRef.current = false;
      stop();
    }
  }, [recording, animating, stop]);
}

// H.264 profile/level candidates, widest-support first. We probe each with
// VideoEncoder.isConfigSupported and use the first the browser accepts for the
// requested dimensions (higher levels cover 4K-ish export frames).
const AVC_CODECS = [
  "avc1.640034", // High @ L5.2 — up to 4096×2304
  "avc1.640028", // High @ L4.0 — up to 1920×1080
  "avc1.4d0034", // Main @ L5.2
  "avc1.42E01E", // Baseline @ L3.0 (fallback)
];

const BITRATES = [40_000_000, 20_000_000, 8_000_000, 4_000_000];
// Force a keyframe ~every 2s at 60fps so seeking/scrubbing stays responsive.
const KEYFRAME_INTERVAL = 120;
// Don't feed the encoder faster than it can emit — avoids flush() hanging on stop.
const MAX_ENCODE_QUEUE = 3;
const FLUSH_TIMEOUT_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ExportRenderOptions {
  width: number;
  height: number;
  render: (ctx: CanvasRenderingContext2D, dpr: number) => void;
}

export interface CanvasRecorder {
  /** True while a recording is in progress. */
  recording: boolean;
  /** False when the browser can't encode video (no download offered). */
  supported: boolean;
  /** Begin capturing the canvas to a standard MP4. No-op if already recording. */
  start: () => void;
  /** Stop, finalize, and trigger an .mp4 download. */
  stop: () => void;
}

const webCodecsSupported =
  typeof VideoEncoder !== "undefined" &&
  typeof VideoFrame !== "undefined" &&
  typeof EncodedVideoChunk !== "undefined";

/** Even dimensions only — H.264 requires width/height divisible by 2. */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

async function pickCodec(
  width: number,
  height: number,
): Promise<{ codec: string; bitrate: number } | null> {
  for (const bitrate of BITRATES) {
    for (const codec of AVC_CODECS) {
      try {
        const { supported } = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate,
        });
        if (supported) return { codec, bitrate };
      } catch {
        // isConfigSupported can throw on malformed codec strings — skip it.
      }
    }
  }
  return null;
}

/**
 * Records a live `<canvas>` (2D or WebGL) into a **standard, non-fragmented
 * MP4** via WebCodecs (`VideoEncoder`) + an in-memory mp4 muxer, then downloads
 * it on stop. Unlike `MediaRecorder`, this produces a file with a real `moov`
 * atom up front, so it opens in QuickTime / Preview / editors — not the
 * fragmented fMP4 that MediaRecorder emits.
 *
 * When `getExportRender` is provided, frames are painted at those dimensions on
 * a hidden canvas so the video matches PNG export resolution (e.g. 1920×1080).
 */
export function useCanvasRecorder(
  getCanvas: () => HTMLCanvasElement | null,
  filename: string,
  getExportRender?: () => ExportRenderOptions | null,
): CanvasRecorder {
  const [recording, setRecording] = useState(false);

  const muxerRef = useRef<Muxer<ArrayBufferTarget> | null>(null);
  const encoderRef = useRef<VideoEncoder | null>(null);
  const rafRef = useRef(0);
  const frameCountRef = useRef(0);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const offCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Set the instant a recording session begins; cleared on stop. Guards against
  // a stop() that races the async encoder setup.
  const activeRef = useRef(false);
  const stoppingRef = useRef(false);

  const getCanvasRef = useRef(getCanvas);
  getCanvasRef.current = getCanvas;
  const getExportRenderRef = useRef(getExportRender);
  getExportRenderRef.current = getExportRender;
  const nameRef = useRef(filename);
  nameRef.current = filename;

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    muxerRef.current = null;
    encoderRef.current = null;
    offscreenRef.current = null;
    offCtxRef.current = null;
    frameCountRef.current = 0;
  }, []);

  const stop = useCallback(async () => {
    // Always clear UI state — even if stop is a no-op or flush is slow.
    setRecording(false);
    if (!activeRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    activeRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    const encoder = encoderRef.current;
    const muxer = muxerRef.current;
    try {
      if (encoder && encoder.state !== "closed") {
        const flushDeadline = performance.now() + FLUSH_TIMEOUT_MS;
        while (encoder.encodeQueueSize > 0 && performance.now() < flushDeadline) {
          await sleep(16);
        }
        try {
          await Promise.race([
            encoder.flush(),
            sleep(FLUSH_TIMEOUT_MS).then(() => {
              throw new Error("VideoEncoder flush timed out");
            }),
          ]);
        } catch (err) {
          console.warn("Encoder flush failed — closing with partial output:", err);
        }
        try {
          encoder.close();
        } catch {
          // already closed
        }
      }
      if (muxer && frameCountRef.current > 0) {
        muxer.finalize();
        const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${nameRef.current}.mp4`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      } else {
        console.warn("Recording stopped with no encoded frames.");
      }
    } catch (err) {
      console.error("Recording failed to finalize:", err);
    } finally {
      stoppingRef.current = false;
      cleanup();
    }
  }, [cleanup]);

  const start = useCallback(() => {
    if (activeRef.current || stoppingRef.current || !webCodecsSupported) return;

    const exportOpts = getExportRenderRef.current?.();
    let width: number;
    let height: number;
    let usingOffscreen = false;

    if (exportOpts && exportOpts.width > 0 && exportOpts.height > 0) {
      width = even(exportOpts.width);
      height = even(exportOpts.height);
      const off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      const ctx = off.getContext("2d");
      if (!ctx) return;
      offscreenRef.current = off;
      offCtxRef.current = ctx;
      usingOffscreen = true;
    } else {
      const live = getCanvasRef.current();
      if (!live) return;
      width = even(live.width);
      height = even(live.height);
    }

    activeRef.current = true;
    stoppingRef.current = false;
    setRecording(true);

    void (async () => {
      const picked = await pickCodec(width, height);
      // stop() may have fired while we were probing — bail without a download.
      if (!activeRef.current) return;
      if (!picked) {
        console.error("No supported H.264 encoder configuration found.");
        activeRef.current = false;
        cleanup();
        setRecording(false);
        return;
      }
      const { codec, bitrate } = picked;

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width, height },
        fastStart: "in-memory",
        firstTimestampBehavior: "offset",
      });
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => {
          console.error("VideoEncoder error:", err);
          void stop();
        },
      });
      // realtime: emit each frame promptly (1-in-1-out). The default "quality"
      // mode buffers frames and stalls a live rAF canvas pipeline — output never
      // fires, so the muxer finalizes with no codec config.
      encoder.configure({
        codec,
        width,
        height,
        bitrate,
        latencyMode: "realtime",
      });

      muxerRef.current = muxer;
      encoderRef.current = encoder;
      frameCountRef.current = 0;

      const frameDurationUs = Math.round(1_000_000 / 60);

      const tick = () => {
        if (!activeRef.current || encoder.state !== "configured") return;

        // Back off when the encoder is backed up — prevents flush() from hanging.
        if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        let source: CanvasImageSource | null;
        if (usingOffscreen) {
          const latest = getExportRenderRef.current?.();
          const ctx = offCtxRef.current;
          if (latest && ctx) {
            blitExportFrameDirect(ctx, width, height, latest.render);
          }
          source = offscreenRef.current;
        } else {
          source = getCanvasRef.current();
        }
        if (!source) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        // Frame-index timestamps — first chunk is always 0 (mp4-muxer requirement).
        const timestamp = frameCountRef.current * frameDurationUs;
        const frame = new VideoFrame(source, { timestamp });
        const keyFrame = frameCountRef.current % KEYFRAME_INTERVAL === 0;
        try {
          encoder.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
        frameCountRef.current += 1;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    })();
  }, [cleanup, stop]);

  useEffect(
    () => () => {
      activeRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const encoder = encoderRef.current;
      if (encoder && encoder.state !== "closed") encoder.close();
    },
    [],
  );

  return useMemo(
    () => ({ recording, supported: webCodecsSupported, start, stop }),
    [recording, start, stop],
  );
}
