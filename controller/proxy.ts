import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Proxy to handle basePath routing across different deployment scenarios:
 *
 * 1. DTM Routing (familysearch.org domains):
 *    - CloudFront/DTM adds x-orig-base header
 *    - Proxy reads and propagates it
 *
 * 2. CName Access (pewpewlocal.org):
 *    - Beanstalk nginx adds x-orig-base header
 *    - Proxy reads and propagates it
 *
 * 3. Local Dev:
 *    - Local nginx adds x-orig-base header
 *    - OR falls back to BASE_PATH env var
 *
 * 4. Build System (no basePath):
 *    - No x-orig-base header, no BASE_PATH env var
 *    - Proxy does nothing, app runs on /
 */
export function proxy (request: NextRequest) {
  // Check for x-orig-base from infrastructure (DTM routing or nginx)
  let origBase = request.headers.get("x-orig-base");

  // Fallback to environment variable for local dev without nginx
  if (!origBase && process.env.BASE_PATH) {
    origBase = process.env.BASE_PATH;
  }

  // If no basePath, just pass through (build system scenario)
  if (!origBase) {
    return NextResponse.next();
  }

  // Store it in a custom header that pages/API routes can access
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-base-path", origBase);

  // Pass modified headers to the app
  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  // Set as cookie for client-side access
  // Use the basePath as the cookie path to automatically scope it correctly
  // This ensures /pewpew/load-test/ only sees its cookie, and /status/performance-test/ only sees its own
  const cookieName = "BASE_PATH";

  // Only update if value changed (avoid unnecessary cookie writes)
  const currentCookie = request.cookies.get(cookieName)?.value;
  if (currentCookie !== origBase) {
    response.cookies.set(cookieName, origBase, {
      path: origBase, // Scope cookie to the basePath
      sameSite: "lax",
      // Secure only in production (https)
      secure: request.nextUrl.protocol === "https:"
    });
  }

  return response;
}

// Run on all requests except static files
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|img/).*)"
  ]
};
