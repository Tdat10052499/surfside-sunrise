// Small helpers shared by the public JSON routes.

/** Fresh on every request: availability and prices change as soon as someone books. */
export const NO_STORE = { "Cache-Control": "no-store" };
/** Home details change rarely; the CDN may serve them for a minute. */
export const SHORT_CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

export function jsonError(status: number, code: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, ...extra } }, { status, headers: NO_STORE });
}

/** Slugs are lowercase words joined by hyphens; anything else can't be a home. */
export const isSlug = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 80;
