// Fetches the public COPO-Emergence reference channel directly from Are.na's
// API (CORS-enabled, no token). https://www.are.na/lyd-found/copo-emergence

const ARENA_API = 'https://api.are.na/v2';
const CONTENTS_PER = 48;

/** Public reference channel: https://www.are.na/lyd-found/copo-emergence */
export const ARENA_REFERENCE_CHANNEL = {
  slug: 'copo-emergence',
  userSlug: 'lyd-found',
  title: 'COPO-Emergence',
  url: 'https://www.are.na/lyd-found/copo-emergence',
} as const;

export interface ArenaChannelSummary {
  id: number;
  slug: string;
  title: string;
  length: number;
  status?: string;
}

export interface ArenaImageBlock {
  id: number;
  title: string | null;
  thumb: string;
  full: string;
}

interface ArenaImage {
  thumb?: { url: string };
  square?: { url: string };
  display?: { url: string };
  large?: { url: string };
  original?: { url: string };
}

interface ArenaBlock {
  id: number;
  title?: string | null;
  image?: ArenaImage | null;
}

interface ArenaChannel {
  id: number;
  slug: string;
  title: string;
  length: number;
  status?: string;
}

async function arenaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ARENA_API}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'Channel not found on Are.na.'
        : `Could not reach Are.na (${res.status}).`,
    );
  }
  return res.json() as Promise<T>;
}

function imageUrls(img: ArenaImage) {
  return {
    thumb: img.thumb?.url ?? img.square?.url ?? img.display?.url ?? null,
    // images.are.na sends access-control-allow-origin: * for canvas use
    full: img.large?.url ?? img.display?.url ?? img.original?.url ?? null,
  };
}

function mapImageBlocks(raw: ArenaBlock[]): ArenaImageBlock[] {
  return raw
    .filter((b) => b.image)
    .map((b) => {
      const { thumb, full } = imageUrls(b.image as ArenaImage);
      return { id: b.id, title: b.title ?? null, thumb, full };
    })
    .filter((b): b is ArenaImageBlock => Boolean(b.thumb && b.full));
}

export async function fetchArenaChannels() {
  const ref = await arenaGet<ArenaChannel>(
    `/channels/${ARENA_REFERENCE_CHANNEL.slug}`,
  );
  return {
    channels: [
      {
        id: ref.id,
        slug: ref.slug,
        title: ref.title,
        length: ref.length,
        status: ref.status,
      },
    ],
    page: 1,
    hasMore: false,
    referenceSlug: ARENA_REFERENCE_CHANNEL.slug,
  };
}

export async function fetchArenaChannelImages(
  slug: string = ARENA_REFERENCE_CHANNEL.slug,
  page = 1,
) {
  const data = await arenaGet<{ contents?: ArenaBlock[] }>(
    `/channels/${encodeURIComponent(slug)}/contents?per=${CONTENTS_PER}&page=${page}`,
  );
  const raw = data.contents ?? [];
  return {
    blocks: mapImageBlocks(raw),
    page,
    hasMore: raw.length === CONTENTS_PER,
    slug,
  };
}

/**
 * Load an Are.na image as a canvas-safe HTMLImageElement.
 */
export function loadArenaImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = url;
  });
}
