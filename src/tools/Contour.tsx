import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArenaImagePicker from "../components/ArenaImagePicker";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import RecordButton from "../components/RecordButton";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { loadArenaImage } from "../sources/arena";
import { renderPngBlob, scaleStrokeParams } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildContourSVG,
  CONTOUR_HINTS,
  CONTOUR_LABELS,
  CONTOUR_RANGES,
  computeContours,
  CW,
  CH,
  DEFAULT_CONTOUR,
  drawContours,
  INK,
  randomContourParams,
  sampleLuminance,
  SLIDER_KEYS_DRAW,
  SLIDER_KEYS_FIELD,
  SLIDER_KEYS_IMAGE,
  type ContourParams,
} from "./contourCore";

const GROWTH_MS = 3600;

export default function Contour() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [params, setParams] = useState<ContourParams>(DEFAULT_CONTOUR);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [showArena, setShowArena] = useState(false);
  const [arenaError, setArenaError] = useState("");
  const [fade, setFade] = useState(false);

  const { w, h, exportDims, pxScale, config, setConfig, resetSize } = useCanvasDimensions(CW, CH);
  const exportParams = useMemo(() => scaleStrokeParams(params, pxScale), [params, pxScale]);

  const buf = useMemo(
    () => (image ? sampleLuminance(image, w, h) : null),
    [image, w, h],
  );
  const exportBuf = useMemo(
    () => (image ? sampleLuminance(image, exportDims.w, exportDims.h) : null),
    [image, exportDims],
  );

  const result = useMemo(
    () => computeContours(w, h, params, buf),
    [w, h, params, buf],
  );
  const exportResult = useMemo(
    () => computeContours(exportDims.w, exportDims.h, exportParams, exportBuf),
    [exportDims, exportParams, exportBuf],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.setProperty("--canvas-ar-w", String(w));
    canvas.style.setProperty("--canvas-ar-h", String(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawContours(
      ctx,
      dpr,
      w,
      h,
      result,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      fade,
      params.seed,
    );
  }, [result, ink, background, w, h, growth, fade, params.seed]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (!growing) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / GROWTH_MS);
      setGrowth(1 - (1 - p) * (1 - p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setGrowing(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [growing]);

  const toggleGrow = () => {
    if (growing) {
      setGrowing(false);
      setGrowth(1);
      return;
    }
    setGrowth(0);
    setGrowing(true);
  };

  const getExportRender = useCallback(
    () => ({
      width: exportDims.w,
      height: exportDims.h,
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawContours(
          ctx,
          dpr,
          exportDims.w,
          exportDims.h,
          exportResult,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          fade,
          params.seed,
        );
      },
    }),
    [exportDims, exportResult, ink, background, growth, fade, params.seed],
  );

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `contour-${params.seed}`,
    getExportRender,
  );

  const startRecord = () => {
    growthRef.current = 0;
    setGrowth(0);
    setGrowing(true);
    recorder.start();
  };
  const stopRecord = () => recorder.stop();

  useStopRecordWhenAnimatingEnds(recorder.recording, growing, recorder.stop);

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const updateParam = useCallback(
    <K extends keyof ContourParams>(key: K, value: ContourParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const regenerate = () => setParams((prev) => randomContourParams(prev));

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleArenaSelect = async (url: string) => {
    setShowArena(false);
    setArenaError("");
    try {
      const img = await loadArenaImage(url);
      setImage(img);
    } catch (e) {
      setArenaError((e as Error).message);
    }
  };

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_CONTOUR);
    setInk(INK);
    setBackground(BG);
    setImage(null);
    setFade(false);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contour-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!result.lines.length) return;
    const svg = buildContourSVG(
      exportDims.w,
      exportDims.h,
      exportResult,
      safeColor(ink, INK),
      "transparent",
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!result.lines.length) return;
    void renderPngBlob(exportDims.w, exportDims.h, (ctx, dpr) => {
      drawContours(
        ctx,
        dpr,
        exportDims.w,
        exportDims.h,
        exportResult,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        fade,
        params.seed,
      );
    }).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof ContourParams) => {
    const [min, max, step] = CONTOUR_RANGES[key];
    const value = params[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={CONTOUR_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{CONTOUR_LABELS[key]}</span>
          <output className="tool-param-row__value">{value}</output>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            updateParam(key, +e.target.value as ContourParams[typeof key])
          }
        />
      </label>
    );
  };

  const colorRow = (
    label: string,
    tip: string,
    value: string,
    fallback: string,
    onChange: (v: string) => void,
  ) => (
    <label className="tool-param-row has-tip tool-color-row" data-tip={tip}>
      <span className="tool-param-row__label">{label}</span>
      <span className="tool-color-row__inputs">
        <input
          type="color"
          className="tool-color-row__swatch"
          value={safeColor(value, fallback)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          className="tool-color-row__hex"
          value={value}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.startsWith("#") ? v : `#${v}`);
          }}
          aria-label={`${label} hex code`}
        />
      </span>
    </label>
  );

  return (
    <>
      <header className="tool-page__header tool-page__header--row">
        <h1 className="tool-page__title">Contour</h1>
        <div className="specimen-tree__actions" style={{ marginTop: 0 }}>
          <AspectRatioControl value={config} onChange={setConfig} />
          <button
            type="button"
            className={`btn${fade ? " is-active" : ""}`}
            aria-pressed={fade}
            onClick={() => setFade((f) => !f)}
            title="Dissolve the linework toward the bottom"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16" />
              <path d="M5 11h14" strokeOpacity="0.7" />
              <path d="M7 16h10" strokeOpacity="0.4" strokeDasharray="2 2.5" />
              <path d="M9 20h6" strokeOpacity="0.2" strokeDasharray="1.5 3" />
            </svg>
            Fade
          </button>
          <ExportButtons onPNG={downloadPNG} onSVG={downloadSVG} disabled={!result.lines.length} />
          <RecordButton recording={recorder.recording} supported={recorder.supported} onStart={startRecord} onStop={stopRecord} />
        </div>
      </header>

      <section
        className="specimen-tree specimen-tree--viewport"
        aria-label="Contour map canvas"
      >
        <aside className="specimen-tree__controls">
          <label
            className="specimen-tree__upload has-tip"
            data-tip="Optional. Drop in an image and the contours band its tone like a survey of the picture. Leave empty for pure generated terrain."
          >
            <span className="tool-param-row__label">source image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleImageUpload(e.target.files?.[0])}
            />
            {image && (
              <span className="specimen-tree__upload-name">
                {image.naturalWidth}×{image.naturalHeight} loaded
              </span>
            )}
          </label>

          <button
            type="button"
            className="btn specimen-tree__arena-btn"
            onClick={() => {
              setArenaError("");
              setShowArena(true);
            }}
          >
            Browse Are.na
          </button>
          {arenaError && <p className="specimen-tree__arena-error">{arenaError}</p>}

          {image && (
            <div className="specimen-tree__group">
              <span className="specimen-tree__group-title">image</span>
              <div className="specimen-tree__sliders">
                {SLIDER_KEYS_IMAGE.map(renderRow)}
              </div>
            </div>
          )}

          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">field</span>
            <div className="specimen-tree__sliders">
              {SLIDER_KEYS_FIELD.map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">lines</span>
            <div className="specimen-tree__sliders">
              {SLIDER_KEYS_DRAW.map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            {colorRow("stroke color", "Color of the contour lines.", ink, INK, setInk)}
            {colorRow(
              "background",
              "Canvas background color behind the lines.",
              background,
              BG,
              setBackground,
            )}
          </div>

          <div className="specimen-tree__actions">
            <button
              type="button"
              className={`btn${growing ? " is-active" : ""}`}
              onClick={toggleGrow}
              disabled={!result.lines.length}
            >
              {growing ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {growing ? "Rising…" : "Play"}
            </button>
            <button type="button" className="btn" onClick={regenerate}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              Regenerate
            </button>
            <button type="button" className="btn" onClick={reset}>
              Reset
            </button>
          </div>
        </aside>

        <div className="specimen-tree__canvas-wrap">
          <canvas ref={canvasRef} className="specimen-tree__canvas" />
        </div>
      </section>

      {showArena && (
        <ArenaImagePicker
          onSelect={handleArenaSelect}
          onClose={() => setShowArena(false)}
        />
      )}
    </>
  );
}
