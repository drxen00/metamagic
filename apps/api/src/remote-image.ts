import { PlexError } from "./plex.js";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Convert common artwork *page* URLs into direct image URLs.
 * ThePosterDB: /poster/{id} pages serve HTML, but /api/assets/{id} is the image.
 */
export function normalizeImageUrl(raw: string): string {
  const tpdb = raw.match(/^https?:\/\/(?:www\.)?theposterdb\.com\/poster\/(\d+)/i);
  if (tpdb) return `https://theposterdb.com/api/assets/${tpdb[1]}`;
  return raw;
}

export async function fetchRemoteImage(
  rawUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = normalizeImageUrl(rawUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PlexError(`Could not download the image from ${new URL(url).hostname}.`, 502);
  }
  if (!res.ok) {
    throw new PlexError(
      `The image host returned ${res.status}. If the site blocks server downloads, save the file and use Upload instead.`,
      502,
    );
  }
  const contentType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new PlexError(
      `That link returned ${contentType || "unknown content"}, not an image. Paste a direct image link (for ThePosterDB, the poster page link works — it's converted automatically).`,
      400,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new PlexError("The image host returned an empty file.", 502);
  if (buffer.length > MAX_BYTES) throw new PlexError("That image is larger than 25 MB.", 400);
  return { buffer, contentType };
}
