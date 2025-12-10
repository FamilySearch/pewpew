import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import { REFRESH_COOKIE_NAME, SESSION_EXPIRED_MESSAGE } from "../../src/authclient";
import { ROUTING_DOMAIN, formatError, formatPageHref } from "../../src/clientutil";
import { cookies, headers } from "next/headers";
import { API_AUTH } from "../../types/pages";
import { LoginClient } from "./LoginClient";
import type { Route } from "next";
import type { GetServerSidePropsContext } from "next";
import { getLoginApiUrl } from "../../src/authserver";
import { redirect } from "next/navigation";

// Force dynamic rendering - this page requires cookies, headers, and handles OAuth callbacks
export const dynamic = "force-dynamic";

interface SearchParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | string[] | undefined;
}

// Server Component - displays login page, handles refresh token logic, and redirects OAuth callbacks
export default async function LoginPage ({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let loginApiUrl: string | undefined;

  try {
    // Get request information for context
    const headersList = await headers();
    const host = headersList.get("host") || "";
    const protocol = host.includes(ROUTING_DOMAIN) ? "https" : "http";
    const hostUrl = `${protocol}://${host}`;

    // getLoginApiUrl only needs query.state
    loginApiUrl = getLoginApiUrl({ query: params } as GetServerSidePropsContext);

    // 1. Check for OAuth callback code - redirect to auth handler
    if (params.code) {
      // Build auth URL with code and state
      const authUrl = new URL(formatPageHref(API_AUTH), hostUrl);
      if (params.code) { authUrl.searchParams.set("code", params.code); }
      if (params.state) { authUrl.searchParams.set("state", params.state); }
      redirect(authUrl.toString() as Route);
    }

    let errorLoading: string | undefined = params.error;
    if (errorLoading && params.error_description) {
      errorLoading += " - " + params.error_description;
    }

    // 2. Check if we have a refreshToken and try to use it
    // But only if we don't have an error message or if it's just an expired session
    // (Don't retry if insufficient permissions)
    const cookieStore = await cookies();
    const refreshTokenCookie = cookieStore.get(REFRESH_COOKIE_NAME);
    const refreshToken = refreshTokenCookie?.value;

    if (refreshToken && (errorLoading === undefined || errorLoading === SESSION_EXPIRED_MESSAGE)) {
      // Redirect to auth handler which will use the refresh token from cookie
      const authUrl = new URL(formatPageHref(API_AUTH), hostUrl);
      if (params.state) {
        authUrl.searchParams.set("state", params.state);
      }
      redirect(authUrl.toString() as Route);
    }

    // 3. Show error if present
    if (errorLoading) {
      return <LoginClient token={undefined} redirectUrl={loginApiUrl} errorLoading={errorLoading} />;
    }

    // 4. Redirect to login API (OAuth provider)
    redirect(loginApiUrl as Route);
  } catch (error) {
    // Re-throw redirect errors - these are not real errors, just Next.js's redirect mechanism
    // Next.js redirect() throws an error with digest "NEXT_REDIRECT"
    if (error && typeof error === "object" && "digest" in error &&
        typeof error.digest === "string" && error.digest.includes("NEXT_REDIRECT")) {
      throw error;
    }

    const errorLoading = formatError(error);
    logServer("Error Logging In: " + errorLoading, LogLevelServer.WARN, error);
    return <LoginClient token={undefined} redirectUrl={loginApiUrl} errorLoading={errorLoading} />;
  }
}
