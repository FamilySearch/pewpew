import { AUTH_COOKIE_NAME, COOKIE_DURATION_DAYS, HINT_COOKIE_NAME, REFRESH_COOKIE_DURATION_DAYS, REFRESH_COOKIE_NAME, getCookiePath } from "../../../src/authclient";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import { NextRequest, NextResponse } from "next/server";
import { PAGE_LOGIN, PAGE_TEST_HISTORY } from "../../../types/pages";
import { ROUTING_DOMAIN, formatPageHref } from "../../../src/clientutil";
import { getTokenFromCode, getTokenFromRefreshToken, validateUrlDomain } from "../../../src/authserver";
import { TokenResponse } from "../../../types";

// Force dynamic rendering
export const dynamic = "force-dynamic";

const getAndValidateUrlFromState = (state: string | undefined, hostUrl: string): string => {
  const redirectUrl: string = state ? decodeURIComponent(state) : "";
  logServer("redirectUrl: " + redirectUrl, LogLevelServer.DEBUG, { redirectUrl, state });

  if (redirectUrl === "" || redirectUrl.startsWith("/")) {
    return redirectUrl;
  }
  try {
    const url: URL = new URL(redirectUrl, hostUrl);
    validateUrlDomain(url);
  } catch (error) {
    logServer("Error parsing redirect url from query.state", LogLevelServer.WARN, error, { state, hostUrl });
    throw error;
  }
  return redirectUrl;
};

export async function GET (request: NextRequest) {
  const host = request.headers.get("host") || "";
  const protocol = host.includes(ROUTING_DOMAIN) ? "https" : "http";
  const hostUrl = `${protocol}://${host}`;

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // Handle OAuth errors
    if (error) {
      const errorMessage = errorDescription ? `${error} - ${errorDescription}` : error;
      return NextResponse.redirect(new URL(formatPageHref(`${PAGE_LOGIN}?error=${encodeURIComponent(errorMessage)}`), hostUrl));
    }

    // 1. Handle OAuth callback with code
    if (code) {
      const tokenResponse: TokenResponse = await getTokenFromCode(request);

      const { token, refreshToken, hintToken } = tokenResponse;
      if (!token) {
        throw new Error("Could not get the auth token from: " + JSON.stringify(tokenResponse));
      }

      logServer("OAuth callback - token received", LogLevelServer.DEBUG, { hasToken: !!token, hasRefreshToken: !!refreshToken, hasHintToken: !!hintToken });

      const redirectUrl: string = getAndValidateUrlFromState(state || undefined, hostUrl);
      const finalRedirect = redirectUrl || PAGE_TEST_HISTORY;
      const response = NextResponse.redirect(new URL(formatPageHref(finalRedirect), hostUrl));

      // Get cookie path (may be basePath or "/")
      const cookiePath = getCookiePath(request) || "/";
      const oneDay = 60 * 60 * 24;

      // Set cookies
      if (refreshToken) {
        response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * REFRESH_COOKIE_DURATION_DAYS
        });
      }
      if (token) {
        response.cookies.set(AUTH_COOKIE_NAME, token, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * COOKIE_DURATION_DAYS
        });
      }
      if (hintToken) {
        response.cookies.set(HINT_COOKIE_NAME, hintToken, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * COOKIE_DURATION_DAYS
        });
      }

      logServer("OAuth callback successful, redirecting to: " + redirectUrl, LogLevelServer.DEBUG, { redirectUrl });
      return response;
    }

    // 2. Handle refresh token
    const refreshTokenCookie = request.cookies.get(REFRESH_COOKIE_NAME);
    const refreshToken = refreshTokenCookie?.value;

    if (refreshToken) {
      const tokenResponse: TokenResponse = await getTokenFromRefreshToken(refreshToken);
      const { token, refreshToken: newRefreshToken, hintToken } = tokenResponse;

      if (!token) {
        logServer("Failed to refresh token, redirecting to login", LogLevelServer.DEBUG);
        return NextResponse.redirect(new URL(formatPageHref(PAGE_LOGIN), hostUrl));
      }

      logServer("Refresh token successful", LogLevelServer.DEBUG, { hasToken: !!token, hasRefreshToken: !!newRefreshToken, hasHintToken: !!hintToken });

      const redirectUrl: string = getAndValidateUrlFromState(state || undefined, hostUrl);
      const finalRedirect = redirectUrl || PAGE_TEST_HISTORY;
      const response = NextResponse.redirect(new URL(formatPageHref(finalRedirect), hostUrl));

      // Get cookie path (may be basePath or "/")
      const cookiePath = getCookiePath(request) || "/";
      const oneDay = 60 * 60 * 24;

      // Set cookies with new tokens
      if (newRefreshToken) {
        response.cookies.set(REFRESH_COOKIE_NAME, newRefreshToken, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * REFRESH_COOKIE_DURATION_DAYS
        });
      }
      if (token) {
        response.cookies.set(AUTH_COOKIE_NAME, token, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * COOKIE_DURATION_DAYS
        });
      }
      if (hintToken) {
        response.cookies.set(HINT_COOKIE_NAME, hintToken, {
          httpOnly: true,
          secure: protocol === "https",
          sameSite: "lax",
          path: cookiePath,
          maxAge: oneDay * COOKIE_DURATION_DAYS
        });
      }

      logServer("Refresh successful, redirecting to: " + redirectUrl, LogLevelServer.DEBUG, { redirectUrl });
      return response;
    }

    // 3. No code or refresh token - redirect to login
    logServer("No code or refresh token, redirecting to login", LogLevelServer.DEBUG);
    return NextResponse.redirect(new URL(formatPageHref(PAGE_LOGIN), hostUrl));

  } catch (error) {
    logServer("Error in auth handler", LogLevelServer.ERROR, error);
    return NextResponse.redirect(new URL(formatPageHref(`${PAGE_LOGIN}?error=Authentication failed`), hostUrl));
  }
}
