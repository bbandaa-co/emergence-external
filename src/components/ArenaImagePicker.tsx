import { useCallback, useEffect, useState } from 'react';
import {
  ARENA_REFERENCE_CHANNEL,
  fetchArenaChannelImages,
  fetchArenaChannels,
  type ArenaChannelSummary,
  type ArenaImageBlock,
} from '../sources/arena';

interface ArenaImagePickerProps {
  /** Called with the full-resolution image URL when a block is chosen. */
  onSelect: (url: string, block: ArenaImageBlock) => void;
  onClose: () => void;
}

export default function ArenaImagePicker({ onSelect, onClose }: ArenaImagePickerProps) {
  const [channels, setChannels] = useState<ArenaChannelSummary[]>([]);
  const [active, setActive] = useState<ArenaChannelSummary | null>(null);
  const [blocks, setBlocks] = useState<ArenaImageBlock[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadImages = useCallback(async (channel: ArenaChannelSummary, pageNum: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setBlocks([]);
    }
    setError('');

    try {
      const res = await fetchArenaChannelImages(channel.slug, pageNum);
      setBlocks((prev) => (append ? [...prev, ...res.blocks] : res.blocks));
      setPage(pageNum);
      setHasMore(res.hasMore);
      if (!append && res.blocks.length === 0) {
        setError('No images in this channel.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Open the COPO-Emergence reference channel by default.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchArenaChannels()
      .then((res) => {
        if (cancelled) return;
        setChannels(res.channels);
        const ref =
          res.channels.find((c) => c.slug === ARENA_REFERENCE_CHANNEL.slug) ??
          res.channels[0] ??
          null;
        if (ref) {
          setActive(ref);
          return loadImages(ref, 1, false);
        }
        setError('Reference channel not found.');
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadImages]);

  const openChannel = useCallback(
    (channel: ArenaChannelSummary) => {
      setActive(channel);
      void loadImages(channel, 1, false);
    },
    [loadImages],
  );

  const loadNextPage = () => {
    if (!active || !hasMore || loadingMore) return;
    void loadImages(active, page + 1, true);
  };

  // Esc closes; back from a channel returns to the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (active && channels.length > 1) setActive(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, channels.length, onClose]);

  const showChannelList = !active && channels.length > 1;

  return (
    <div className="arena-picker__backdrop" onClick={onClose} role="presentation">
      <div
        className="arena-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a reference image from Are.na"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="arena-picker__header">
          {active && channels.length > 1 ? (
            <button
              type="button"
              className="arena-picker__back"
              onClick={() => {
                setActive(null);
                setError('');
              }}
            >
              ← Channels
            </button>
          ) : (
            <span className="arena-picker__title">Are.na</span>
          )}
          <span className="arena-picker__subtitle">
            {active ? active.title : 'Reference images'}
          </span>
          <button
            type="button"
            className="arena-picker__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="arena-picker__body">
          {active && (
            <p className="arena-picker__channel-link">
              <a
                href={ARENA_REFERENCE_CHANNEL.url}
                target="_blank"
                rel="noreferrer"
              >
                {ARENA_REFERENCE_CHANNEL.url.replace('https://', '')}
              </a>
            </p>
          )}

          {loading && <p className="arena-picker__note">Loading…</p>}
          {error && !loading && (
            <p className="arena-picker__note arena-picker__note--error">{error}</p>
          )}

          {showChannelList && !loading && !error && (
            <ul className="arena-picker__channels">
              {channels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="arena-picker__channel"
                    onClick={() => openChannel(c)}
                  >
                    <span className="arena-picker__channel-title">{c.title}</span>
                    <span className="arena-picker__channel-count">{c.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {active && !loading && blocks.length > 0 && (
            <>
              <ul className="arena-picker__grid">
                {blocks.map((b) => (
                  <li key={b.id} className="arena-picker__card">
                    <button
                      type="button"
                      className="arena-picker__thumb"
                      title={b.title ?? undefined}
                      onClick={() => onSelect(b.full, b)}
                    >
                      <img src={b.thumb} alt={b.title ?? ''} loading="lazy" />
                    </button>
                    <a
                      className="arena-picker__source"
                      href={`https://www.are.na/block/${b.id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="View on Are.na"
                      title="View on Are.na"
                    >
                      ↗ Are.na
                    </a>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="arena-picker__more">
                  <button
                    type="button"
                    className="btn"
                    onClick={loadNextPage}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
