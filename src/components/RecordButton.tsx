interface RecordButtonProps {
  /** True while recording — flips the control to a "stop" affordance. */
  recording: boolean;
  /** Hide entirely when the browser can't record canvas video. */
  supported?: boolean;
  disabled?: boolean;
  /** Start a recording (always saves a standard MP4 with the background). */
  onStart?: () => void;
  /** Stop the in-progress recording. */
  onStop?: () => void;
  /** Legacy alias used by tools that wire a single start/stop handler. */
  onClick?: () => void;
}

const RecordIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/**
 * Shared "Record" control for tools with a play/grow animation. Captures the
 * canvas as a standard MP4 while the animation runs. Pairs with
 * {@link useCanvasRecorder}.
 */
export default function RecordButton({
  recording,
  supported = true,
  disabled,
  onStart,
  onStop,
  onClick,
}: RecordButtonProps) {
  if (!supported) return null;

  if (recording) {
    return (
      <button
        type="button"
        className="btn is-active"
        onClick={onStop ?? onClick}
        disabled={disabled}
        title="Stop recording"
      >
        <StopIcon />
        Stop
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn"
      onClick={onStart ?? onClick}
      disabled={disabled}
      title="Record the animation as a video"
    >
      <RecordIcon />
      Record
    </button>
  );
}
