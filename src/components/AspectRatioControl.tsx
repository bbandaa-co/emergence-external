import { useEffect, useRef, useState } from "react";
import {
  clampCustomDims,
  labelForConfig,
  SIZE_PRESETS,
  type CanvasSizeConfig,
} from "../tools/aspectRatio";

const AspectIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
  </svg>
);

interface AspectRatioControlProps {
  value: CanvasSizeConfig;
  onChange: (config: CanvasSizeConfig) => void;
  disabled?: boolean;
}

function customDraftFrom(config: CanvasSizeConfig): { w: string; h: string } {
  if (config.mode === "custom") {
    return { w: String(config.w), h: String(config.h) };
  }
  const preset = SIZE_PRESETS.find((p) => p.id === config.presetId) ?? SIZE_PRESETS[1];
  return { w: String(preset.w), h: String(preset.h) };
}

/**
 * Canvas size picker — resolution presets plus custom W×H. Drives preview framing
 * and PNG / MP4 export dimensions.
 */
export default function AspectRatioControl({
  value,
  onChange,
  disabled,
}: AspectRatioControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [draftW, setDraftW] = useState(() => customDraftFrom(value).w);
  const [draftH, setDraftH] = useState(() => customDraftFrom(value).h);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    const { w, h } = customDraftFrom(value);
    setDraftW(w);
    setDraftH(h);
  }, [value]);

  const applyCustom = () => {
    const w = Number.parseInt(draftW, 10);
    const h = Number.parseInt(draftH, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    onChange({ mode: "custom", ...clampCustomDims(w, h) });
    setOpen(false);
  };

  const isPresetActive = (presetId: string) =>
    value.mode === "preset" && value.presetId === presetId;

  return (
    <div className="export-menu" ref={ref}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <AspectIcon />
        {labelForConfig(value)}
        <svg
          className="export-menu__caret"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="export-menu__list export-menu__list--size" role="menu">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={isPresetActive(p.id)}
              className={`export-menu__item${isPresetActive(p.id) ? " is-active" : ""}`}
              onClick={() => {
                onChange({ mode: "preset", presetId: p.id });
                setOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
          <div
            className={`export-menu__custom${value.mode === "custom" ? " is-active" : ""}`}
            role="group"
            aria-label="Custom dimensions"
          >
            <span className="export-menu__custom-label">Custom</span>
            <div className="export-menu__custom-fields">
              <input
                type="number"
                className="export-menu__dim-input"
                min={320}
                max={4096}
                step={2}
                value={draftW}
                onChange={(e) => setDraftW(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                aria-label="Width in pixels"
              />
              <span className="export-menu__dim-sep">×</span>
              <input
                type="number"
                className="export-menu__dim-input"
                min={320}
                max={4096}
                step={2}
                value={draftH}
                onChange={(e) => setDraftH(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                aria-label="Height in pixels"
              />
              <button type="button" className="export-menu__apply" onClick={applyCustom}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
