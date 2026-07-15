import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_SIZE_CONFIG,
  dimsForPreview,
  exportScale,
  resolveExportDims,
  type CanvasSizeConfig,
} from "../tools/aspectRatio";

/**
 * Shared preview + export dimensions for generative tools. Preview keeps the
 * tool's native pixel area but matches the export aspect ratio (WYSIWYG).
 */
export function useCanvasDimensions(baseW: number, baseH: number) {
  const [config, setConfig] = useState<CanvasSizeConfig>(DEFAULT_SIZE_CONFIG);

  const exportDims = useMemo(() => resolveExportDims(config), [config]);
  const preview = useMemo(
    () => dimsForPreview(baseW, baseH, exportDims.w, exportDims.h),
    [baseW, baseH, exportDims.w, exportDims.h],
  );
  const pxScale = useMemo(
    () => exportScale(preview.w, exportDims.w),
    [preview.w, exportDims.w],
  );

  const resetSize = useCallback(() => setConfig(DEFAULT_SIZE_CONFIG), []);

  return {
    config,
    setConfig,
    resetSize,
    w: preview.w,
    h: preview.h,
    exportDims,
    pxScale,
  };
}
