import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import RecordButton from "../components/RecordButton";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { renderPngBlob, scaleStrokeParams } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildEmergenceRoots,
  buildFlowSVG,
  buildNoiseField,
  DEFAULT_FLOW,
  EMERGE_PRESET,
  FH,
  FLOW_HINTS,
  FLOW_LABELS,
  FLOW_RANGES,
  FW,
  INK,
  randomFlowParams,
  SLIDER_KEYS_EMERGE,
  SLIDER_KEYS_FIELD,
  SLIDER_KEYS_LINE,
  traceStreamlines,
  drawFlow,
  type FlowParams,
} from "./flowFieldCore";

const GROWTH_MS = 3200;

export default function FlowField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } = useCanvasDimensions(FW, FH);
  const [params, setParams] = useState<FlowParams>(DEFAULT_FLOW);
  const exportParams = useMemo(() => scaleStrokeParams(params, pxScale), [params, pxScale]);
  const [emerge, setEmerge] = useState(false);
  // Flow-mode params snapshot: switching Emerge on loads a sketch preset, and
  // switching back restores whatever the user had in Flow mode.
  const preEmergeParams = useRef<FlowParams | null>(null);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(false);

  const lines = useMemo(() => {
    if (emerge) return buildEmergenceRoots(w, h, params);
    return traceStreamlines(buildNoiseField(w, h, params), w, h, params);
  }, [params, emerge, w, h]);

  const exportLines = useMemo(() => {
    if (emerge) return buildEmergenceRoots(exportDims.w, exportDims.h, exportParams);
    return traceStreamlines(
      buildNoiseField(exportDims.w, exportDims.h, exportParams),
      exportDims.w,
      exportDims.h,
      exportParams,
    );
  }, [exportParams, emerge, exportDims]);

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
    drawFlow(
      ctx,
      dpr,
      w,
      h,
      lines,
      params,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      fade,
      params.seed,
    );
  }, [lines, params, ink, background, growth, w, h, fade]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Animate the reveal front 0 → 1, then settle fully drawn.
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
        drawFlow(
          ctx,
          dpr,
          exportDims.w,
          exportDims.h,
          exportLines,
          exportParams,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          fade,
          params.seed,
        );
      },
    }),
    [exportDims, exportLines, exportParams, ink, background, growth, fade, params.seed],
  );

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `flow-field-${params.seed}`,
    getExportRender,
  );

  // Record the full reveal: replay from empty while capturing, stop at the end.
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
    <K extends keyof FlowParams>(key: K, value: FlowParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const regenerate = () => setParams((prev) => randomFlowParams(prev));

  // Enter Emerge: snapshot the current Flow params and load the sketch preset.
  // Leave Emerge: restore the snapshot so Flow mode is untouched.
  const enableEmerge = () => {
    if (emerge) return;
    preEmergeParams.current = params;
    setParams((prev) => ({ ...prev, ...EMERGE_PRESET }));
    setEmerge(true);
  };
  const disableEmerge = () => {
    if (!emerge) return;
    if (preEmergeParams.current) {
      setParams(preEmergeParams.current);
      preEmergeParams.current = null;
    }
    setEmerge(false);
  };

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_FLOW);
    setEmerge(false);
    preEmergeParams.current = null;
    setInk(INK);
    setBackground(BG);
    setFade(false);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flow-field-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    const svg = buildFlowSVG(
      exportDims.w,
      exportDims.h,
      exportLines,
      exportParams,
      safeColor(ink, INK),
      "transparent",
      fade,
      params.seed,
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    void renderPngBlob(exportDims.w, exportDims.h, (ctx, dpr) => {
      drawFlow(
        ctx,
        dpr,
        exportDims.w,
        exportDims.h,
        exportLines,
        exportParams,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        fade,
        params.seed,
      );
    }).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof FlowParams) => {
    const [min, max, step] = FLOW_RANGES[key];
    const value = params[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={FLOW_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{FLOW_LABELS[key]}</span>
          <output className="tool-param-row__value">{value}</output>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            updateParam(key, +e.target.value as FlowParams[typeof key])
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
        <h1 className="tool-page__title">Fingerprint</h1>
        <div className="specimen-tree__actions" style={{ marginTop: 0 }}>
          <AspectRatioControl value={config} onChange={setConfig} />
          <button
            type="button"
            className={`btn${fade ? " is-active" : ""}`}
            aria-pressed={fade}
            onClick={() => setFade((f) => !f)}
            title="Thin the linework from dense to sparse toward the bottom"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16" />
              <path d="M5 11h14" strokeOpacity="0.7" />
              <path d="M7 16h10" strokeOpacity="0.4" strokeDasharray="2 2.5" />
              <path d="M9 20h6" strokeOpacity="0.2" strokeDasharray="1.5 3" />
            </svg>
            Fade
          </button>
          <ExportButtons onPNG={downloadPNG} onSVG={downloadSVG} />
          <RecordButton recording={recorder.recording} supported={recorder.supported} onStart={startRecord} onStop={stopRecord} />
        </div>
      </header>

      <section className="specimen-tree" aria-label="Flow field canvas">
        <aside className="specimen-tree__controls">
          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">field</span>
            <div className="specimen-tree__shapes">
              <button
                type="button"
                className={`btn specimen-tree__shape${emerge ? " is-active" : ""}`}
                onClick={enableEmerge}
                title="Ridges fan out from one point, like the root brush"
              >
                Emerge
              </button>
              <button
                type="button"
                className={`btn specimen-tree__shape${!emerge ? " is-active" : ""}`}
                onClick={disableEmerge}
                title="Ridges flow across the whole frame"
              >
                Flow
              </button>
            </div>
            <div className="specimen-tree__sliders">
              {/* Emerge ignores drift (the field radiates from the crown, not a
                  global direction), so hide that slider in Emerge mode. */}
              {(emerge
                ? SLIDER_KEYS_FIELD.filter((k) => k !== "drift")
                : SLIDER_KEYS_FIELD
              ).map(renderRow)}
              {emerge && SLIDER_KEYS_EMERGE.map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">lines</span>
            <div className="specimen-tree__sliders">
              {/* Emerge builds roots by count/morph, not by streamline spacing,
                  step, or seed scatter — those do nothing here, so hide them. */}
              {(emerge
                ? SLIDER_KEYS_LINE.filter(
                    (k) => k !== "spacing" && k !== "stepLen" && k !== "jitter",
                  )
                : SLIDER_KEYS_LINE
              ).map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            {colorRow(
              "stroke color",
              "Color of the flow lines.",
              ink,
              INK,
              setInk,
            )}
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
              {growing ? "Drawing…" : "Play"}
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
    </>
  );
}
