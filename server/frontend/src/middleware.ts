import { NextResponse, type NextRequest } from 'next/server';
import {
  buildMalformedActionLog,
  clientKey,
  createMalformedActionLimiter,
  isMalformedServerActionHeader,
} from './lib/request-hygiene';

/**
 * Frontend request hygiene (see lib/request-hygiene.ts for the full rationale).
 *
 * Two jobs, both cheap:
 *   1. Tag every request with a request id and the release commit, so a frontend log
 *      line can be joined to the API log and to the Caddy access log. Before this the
 *      only way to attribute an error was to correlate timestamps by hand.
 *   2. Reject a fabricated `Next-Action` header before Next.js turns it into an
 *      unclassified framework error, and log one structured line instead.
 *
 * Anything unexpected falls through to the application: this middleware must never be
 * the reason a page fails to render.
 */

const limiter = createMalformedActionLimiter({ windowMs: 60_000, max: 20 });

// Static assets are excluded: they are content-hashed, served immutable, and no
// server action can be posted to them. Pages, RSC payloads and route handlers are not.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|txt|xml|json|woff2?|ttf|otf)$).*)',
  ],
};

function releaseCommit(): string {
  return String(process.env.RELEASE_COMMIT || 'unknown');
}

export function middleware(request: NextRequest): NextResponse {
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID();

  try {
    if (request.method !== 'POST' || !isMalformedServerActionHeader(request.headers.get('next-action'))) {
      const headers = new Headers(request.headers);
      headers.set('x-request-id', requestId);
      const response = NextResponse.next({ request: { headers } });
      response.headers.set('x-request-id', requestId);
      response.headers.set('x-dzhoof-release', releaseCommit());
      return response;
    }

    const allowed = limiter.allow(clientKey(request.headers));
    const entry = buildMalformedActionLog({
      route: request.nextUrl.pathname,
      method: request.method,
      nextActionHeader: request.headers.get('next-action'),
      userAgent: request.headers.get('user-agent'),
      requestId,
      releaseCommit: releaseCommit(),
      outcome: allowed ? 'rejected' : 'rate_limited',
    });

    // One structured warning per request; nothing here is fatal, and the caller gets a
    // 4xx it can act on instead of a framework stack trace in the server log.
    console.warn(JSON.stringify(entry));

    return NextResponse.json(
      {
        error: 'Invalid server action request',
        errorCode: entry.errorCode,
        requestId,
        retryable: false,
      },
      {
        status: entry.status,
        headers: {
          'x-request-id': requestId,
          'x-dzhoof-release': releaseCommit(),
          'cache-control': 'no-store',
        },
      },
    );
  } catch {
    // Never block a request because hygiene bookkeeping failed.
    return NextResponse.next();
  }
}
