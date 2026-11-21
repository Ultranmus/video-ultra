/**
 * Keeps the demo's AI routes (captions, voice, assistant) from being used as a free key: they run
 * on the site owner's Groq and Google keys.
 *
 * 1. Same site only (production): a browser request must come from this site's own pages, so
 *    another website can't spend the keys through its visitors. Scripts on a developer's machine
 *    (no `Origin`) are still allowed outside production.
 * 2. Per visitor: at most `limit` requests in a rolling window, counted per IP address. Far above
 *    normal use (a 10-minute video is ~20 caption pieces), low enough that one script can't
 *    drain the quota. Over the limit: 429 with `Retry-After`, which the editor already handles.
 *
 * Counts live in this server instance's memory: no database, nothing to set up. An instance
 * that restarts forgets them, which only ever errs toward letting people in. Provider spending
 * caps stay the real backstop.
 */

/** How many requests one visitor may make per window, per route. */
const LIMITS = {
  captions: 150,
  speech: 40,
  assistant: 40,
} as const;

const WINDOW_MS = 10 * 60 * 1000;
/** Visitors tracked at once; the least recently seen are dropped first (bounded memory). */
const MAX_VISITORS = 5000;

type Route = keyof typeof LIMITS;

/** Per route: visitor → times of their requests in the window (oldest first). */
const seen = new Map<Route, Map<string, number[]>>();

/** The visitor's address. Vercel sets `x-forwarded-for` itself; the first entry is the client. */
function visitor(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** True when the request comes from a page on this same site (host matches the origin's). */
function sameSite(request: Request): boolean {
  const from = request.headers.get('origin') ?? request.headers.get('referer');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!from) return process.env.NODE_ENV !== 'production';
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

function minutes(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/**
 * Checks a request to one of the AI routes. Returns a response to send instead (403 or 429),
 * or `null` when the request may go ahead (it is then counted).
 */
export function guard(request: Request, route: Route, now = Date.now()): Response | null {
  if (!sameSite(request))
    return new Response('This service only answers the VideoUltra demo site.', { status: 403 });

  let visitors = seen.get(route);
  if (!visitors) seen.set(route, (visitors = new Map()));
  const who = visitor(request);
  const times = (visitors.get(who) ?? []).filter((t) => now - t < WINDOW_MS);

  if (times.length >= LIMITS[route]) {
    const wait = WINDOW_MS - (now - times[0]!);
    visitors.set(who, times);
    return new Response(`Too many requests from this device. Try again in ${minutes(wait)}.`, {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(wait / 1000)) },
    });
  }

  times.push(now);
  // Re-insert so the Map's order is least recently seen first, then trim the oldest visitors.
  visitors.delete(who);
  visitors.set(who, times);
  while (visitors.size > MAX_VISITORS) visitors.delete(visitors.keys().next().value!);
  return null;
}
