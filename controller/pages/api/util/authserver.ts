/* eslint-disable camelcase */
import {
  API_LOGIN,
  AuthPermission,
  AuthPermissions,
  PAGE_LOGIN,
  TokenResponse
} from "../../../types";
import {
  AUTH_COOKIE_NAME,
  AUTH_HEADER_HOST,
  AUTH_HEADER_NAME,
  AUTH_MODE,
  COOKIE_DURATION_DAYS,
  HINT_COOKIE_NAME,
  IS_RUNNING_IN_AWS,
  NOT_AUTHORIZED_MESSAGE,
  REFRESH_COOKIE_DURATION_DAYS,
  REFRESH_COOKIE_NAME,
  SESSION_EXPIRED_MESSAGE,
  VALID_DOMAINS,
  getCookiePath,
  getDomain,
  isAuthEnabled
} from "./authclient";
import {
  CallbackParamsType,
  Client,
  ClientMetadata,
  Issuer,
  IssuerMetadata,
  TokenSet,
  UserinfoResponse
} from "openid-client";
import { GetServerSidePropsContext, NextApiRequest, NextApiResponse } from "next";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { formatPageHref, getHostUrl } from "./clientutil";
import { IncomingMessage } from "http";
import cookie from "cookie";
import { createErrorResponse } from "./util";
import { getClientSecretOpenId } from "./secrets";
import nextCookie from "next-cookies";

// server side we want to use process.env rather than publicRuntimeConfig
const publicRuntimeConfig: NodeJS.ProcessEnv = process.env;

logger.config.LogFileName = "ppaas-controller";

const AUTH_CALLBACK_PAGE_NAME = PAGE_LOGIN;
const OPENID_CLIENT_ID: string = `${publicRuntimeConfig.OPENID_CLIENT_ID}`;
const OPENID_OIDC_BASE_URL: string = `https://${publicRuntimeConfig.OPENID_HOST}`;

/** If set, only admins can run tests */
const OPENID_ONLY_ADMIN_RUN_TESTS: boolean = publicRuntimeConfig.OPENID_ONLY_ADMIN_RUN_TESTS === "true";
if (publicRuntimeConfig.OPENID_ONLY_ADMIN_RUN_TESTS) {
  log("OPENID_ONLY_ADMIN_RUN_TESTS: " + publicRuntimeConfig.OPENID_ONLY_ADMIN_RUN_TESTS, LogLevel.WARN, { OPENID_ONLY_ADMIN_RUN_TESTS });
}
const TEST_AUTH_PERMISSION: AuthPermission | undefined = publicRuntimeConfig.TEST_AUTH_PERMISSION
   && Object.values(AuthPermission).includes(parseInt(publicRuntimeConfig.TEST_AUTH_PERMISSION))
   ? parseInt(publicRuntimeConfig.TEST_AUTH_PERMISSION)
   : undefined;
if (TEST_AUTH_PERMISSION !== undefined) {
  const [permissionName, permissionValue] = Object.entries(AuthPermission).find(([_key, value]) => TEST_AUTH_PERMISSION === value)!;
  log("TEST_AUTH_PERMISSION overridden, using: " + permissionName, LogLevel.ERROR, { TEST_AUTH_PERMISSION, permissionName, permissionValue });
}
let openIdAuthClient: Client | undefined;

const getOpenIdClientId = (): string => OPENID_CLIENT_ID;

async function getOpenIdClient (): Promise<Client> {
  if (openIdAuthClient === undefined) {
    log("getOpenIdClient", LogLevel.DEBUG, { OPENID_CLIENT_ID, OPENID_OIDC_BASE_URL, OPENID_HOST: publicRuntimeConfig.OPENID_HOST, env: process.env });
    let issuer: Issuer<Client>;
    const metadata: IssuerMetadata = {
      issuer: OPENID_OIDC_BASE_URL,
      authorization_endpoint: OPENID_OIDC_BASE_URL + "/oauth2/v1/authorize",
      token_endpoint: OPENID_OIDC_BASE_URL + "/oauth2/v1/token",
      userinfo_endpoint: OPENID_OIDC_BASE_URL + "/oauth2/v1/userinfo",
      end_session_endpoint: OPENID_OIDC_BASE_URL + "/oauth2/v1/logout",
      jwks_uri: OPENID_OIDC_BASE_URL + "/oauth2/v1/keys"
    };
    const client_id: string = getOpenIdClientId();
    const client_secret: string = getClientSecretOpenId();
    const scopes: string[] = ["offline_access", "openid", "profile", "groups", "email"];
    try {
      issuer = await Issuer.discover(metadata.issuer);
    } catch (error) {
      log("Error Discovering Issuer", LogLevel.ERROR, { metadata }, error);
      issuer = new Issuer(metadata);
    }
    log("issuer", LogLevel.DEBUG, { issuer, metadata });
    const options: ClientMetadata = {
      client_id,
      client_secret,
      // Use authorization_code flow
      response_types: ["code"],
      scopes
    };
    openIdAuthClient = new issuer.Client(options);
    log("openIdAuthClient", LogLevel.DEBUG, {
      openIdAuthClient: { ...openIdAuthClient, client_secret: undefined },
      metadata: { ...openIdAuthClient.metadata, client_secret: undefined },
      issuer: openIdAuthClient.issuer.metadata
    });
  }
  return openIdAuthClient;
}

interface OpenIdPermissionNames {
  ReadOnly: string;
  User: string;
  Admin: string;
}

const OpenIdPermissions: OpenIdPermissionNames = {
  ReadOnly: process.env.OPENID_PERMISSIONS_READONLY || "read_only",
  User: process.env.OPENID_PERMISSIONS_USER || "user",
  Admin: process.env.OPENID_PERMISSIONS_ADMIN || "administrator"
};

// If AUTH_MODE is set and not "off", we want it on.
log("AUTH_MODE=" + AUTH_MODE, LogLevel.INFO);

function getPermissions (userInfoResponse: UserinfoResponse): AuthPermission {
  log("userInfoResponse", LogLevel.DEBUG, userInfoResponse);
  if (TEST_AUTH_PERMISSION !== undefined) {
    log("TEST_AUTH_PERMISSION overridden, using: " + TEST_AUTH_PERMISSION, LogLevel.ERROR, { TEST_AUTH_PERMISSION });
    return TEST_AUTH_PERMISSION;
  }
  const groups = (userInfoResponse as any).groups;
  if (groups && Array.isArray(groups) && groups.length > 0 && typeof groups[0] === "string") {
    const openIdPermissionNames: OpenIdPermissionNames = OpenIdPermissions;
    if (groups.includes(openIdPermissionNames.Admin)) {
      return AuthPermission.Admin;
    }
    // In prod, we only give Admins run access. Return Read-Only for all others
    if (groups.includes(openIdPermissionNames.User) && !OPENID_ONLY_ADMIN_RUN_TESTS) {
      return AuthPermission.User;
    }
    if (groups.includes(openIdPermissionNames.ReadOnly) || groups.includes(openIdPermissionNames.User)) {
      return AuthPermission.ReadOnly;
    }
  }
  /**
   * By default we allow anyone who has authenticated with OpenId to have read-only. Unauthenticated does not have access
   */
  return AuthPermission.ReadOnly;
}

/**
 * Queries the session service for the session information and returns undefined if not valid
 * @param token session token
 * @returns SessionResponse if valid, undefined otherwise
 */
async function getSessionFromToken (token: string): Promise<UserinfoResponse | undefined> {
  try {
    const openIdClient: Client = await getOpenIdClient();
    const userInfo: UserinfoResponse = await openIdClient.userinfo(token);
    log("userInfo", LogLevel.DEBUG, userInfo);
    return userInfo;
  } catch (error) {
    log(`Token is not valid: ${(error as any)?.message || error}`, LogLevel.WARN, error);
    return undefined;
  }
}

// Possible returns:
// 1. Token expired/invalid
// 2. Token has User permissions
// 3. Token has Admin permissions
export async function validateToken (token: string): Promise<AuthPermissions> {
  // Check if the token is valid
  const sessionResponse: UserinfoResponse | undefined = await getSessionFromToken(token);
  log(`getSessionFromToken(token): ${JSON.stringify(sessionResponse)}`, LogLevel.DEBUG, sessionResponse);
  // If it's expired redirect to login
  if (!sessionResponse) {
    // Return invalid
    return { token, authPermission: AuthPermission.Expired };
  }
  // If it's valid, check CAS
  // Check CAS for permissions
  const authPermission = getPermissions(sessionResponse);
  log("getPermissions(token): " + authPermission, LogLevel.DEBUG);
  const sessionAny = sessionResponse as any;
  return {
    token,
    authPermission,
    userId: sessionAny.preferred_username || sessionAny.email || sessionAny.cisId || sessionAny.userId,
    groups: (sessionResponse as any).groups
  };
}

export function getLoginApiUrl (ctx: GetServerSidePropsContext): string {
  const state: string = ctx.query.state && !Array.isArray(ctx.query.state)
    ? ctx.query.state
    : formatPageHref("/"); // If we have a state, it's already formatted with basePath.
  const location = formatPageHref(`${API_LOGIN}?state=${state}`);
  return location;
}

export function validateUrlDomain (url: URL): void {
  const validDomain = VALID_DOMAINS.find((domain: string) => url.hostname.endsWith(domain));
  log("validDomain: " + validDomain, LogLevel.DEBUG, { VALID_DOMAINS, url, hostname: url.hostname });
  if (validDomain === undefined) {
    throw new Error(url + " is not an approved domain Url");
  }
}

function getFullCallbackUrl (req: IncomingMessage): string {
  // There is an issue with our new "LocalHost" api calling that we need the real domain/host passed
  // to the auth api so we can use the same redirect_uri used by the auth call. We'll pass it down as a header
  let hostUrl: string = getHostUrl(req);
  log("getFullCallbackUrl hostUrl: " + hostUrl, LogLevel.DEBUG, { hostUrl, host: req.headers.host, [AUTH_HEADER_HOST]: req.headers[AUTH_HEADER_HOST] });
  if (hostUrl.startsWith("http://localhost") && typeof req.headers[AUTH_HEADER_HOST] === "string") {
    hostUrl = req.headers[AUTH_HEADER_HOST] as string;
    log("getFullCallbackUrl modified hostUrl: " + hostUrl, LogLevel.DEBUG, { hostUrl, host: req.headers.host, [AUTH_HEADER_HOST]: req.headers[AUTH_HEADER_HOST] });
    // The authheader needs to be our domain. Don't allow others to spoof. But only if the requester is localhost.
    try {
      const url: URL = new URL(hostUrl);
      validateUrlDomain(url);
    } catch (error) {
      log("Error parsing FullCallbackUrl from hostUrl: " + hostUrl, LogLevel.ERROR, error, { hostUrl, host: req.headers.host, [AUTH_HEADER_HOST]: req.headers[AUTH_HEADER_HOST] });
      throw error;
    }
  }
  if (IS_RUNNING_IN_AWS && hostUrl.includes("localhost")) {
    log("getFullCallbackUrl hostUrl: " + hostUrl, LogLevel.WARN, { hostUrl, host: req.headers.host, [AUTH_HEADER_HOST]: req.headers[AUTH_HEADER_HOST] });
  }
  return `${hostUrl}${formatPageHref(AUTH_CALLBACK_PAGE_NAME)}`;
}

export async function getAuthUrl (req: NextApiRequest): Promise<string> {
  const state: string = req.query.state && !Array.isArray(req.query.state)
    ? req.query.state
    : formatPageHref("/");
  // Auth redirects do not support wildcards and query params
  const loginUrl = getFullCallbackUrl(req);

  const openIdClient: Client = await getOpenIdClient();
  const authUrl = openIdClient.authorizationUrl({
    scope: "offline_access openid profile groups email",
    response_type: "code",
    redirect_uri: loginUrl,
    client_secret: undefined, // undefined for OpenId so it's not exposed to the client
    state
  });
  log("getAuthUrl: " + authUrl, LogLevel.DEBUG);
  return authUrl;
}

function getTokenFromQueryOrHeader (req: NextApiRequest, headerName: string = AUTH_HEADER_NAME): string | undefined {
  let token: string | undefined;
  // If we don't have a cookie token, check the querystring (for a redirect)
  const queryToken: string | string[] | undefined = req.query[headerName];
  log("req.query: " + JSON.stringify(req.query), LogLevel.DEBUG);
  if (queryToken && !Array.isArray(queryToken)) {
    token = queryToken;
    log("query token: " + JSON.stringify(token), LogLevel.DEBUG);
  }
  // Or check the headers
  const headersToken: string | string[] | undefined = req.headers[headerName];
  log("req.headers: " + JSON.stringify(req.headers), LogLevel.DEBUG);
  if (!token && headersToken && !Array.isArray(headersToken)) {
    token = headersToken;
    log("header token: " + JSON.stringify(token), LogLevel.DEBUG);
  }
  if (!token && req.headers.cookie && !Array.isArray(req.headers.cookie)) {
    const cookies = cookie.parse(req.headers.cookie);
    token = cookies[headerName];
    log("cookie token: " + JSON.stringify(token), LogLevel.DEBUG);
  }
  return token;
}

/**
 * Uses the code queryparam returned by the Auth call to generate a session token
 * and refreshToken if the two-week checkbox was checked
 * @param code code queryparam returned by Web Auth call
 */
export async function getTokenFromCode (req: NextApiRequest): Promise<TokenResponse> {
  let loginUrl: string | undefined;
  try {
    // https://github.com/panva/node-openid-client
    const openIdClient: Client = await getOpenIdClient();
    const params: CallbackParamsType = openIdClient.callbackParams(req);
    loginUrl = getFullCallbackUrl(req);
    // When it was a NextApiRequest, this parsed fine, with the new GetServerSideContext we parse an extra "state"
    // which causes an error if it's there.
    if (params.state) {
      delete params.state;
    }
    log("openIdClient.callback", LogLevel.DEBUG, { params, loginUrl });
    const tokenSet: TokenSet = await openIdClient.callback(loginUrl, params, undefined);
    log("openIdClient.callback result", LogLevel.DEBUG, { tokenSet });
    if (tokenSet && tokenSet.access_token) {
      const { access_token: token, refresh_token: refreshToken, id_token: hintToken } = tokenSet;
      log("auth token: " + JSON.stringify(token), LogLevel.DEBUG, { token, refreshToken, hintToken });
      return { token, refreshToken, hintToken };
    } else {
      throw new Error("Could not get the auth token from: " + JSON.stringify(tokenSet));
    }
  } catch (error) {
    log("Error calling getTokenFromCode", LogLevel.WARN, error, { loginUrl, headers: req.headers });
    throw error;
  }
}

/**
 * Attempts to refresh the token via the token endpoint
 * @param refreshToken refreshToken stored in cookie from either getTokenFromCode or a prior call to getTokenFromRefreshToken
 * @returns a new token and refreshToken
 */
export async function getTokenFromRefreshToken (refreshToken: string): Promise<TokenResponse> {
  try {
    const openIdClient: Client = await getOpenIdClient();
    const tokenSet: TokenSet = await openIdClient.refresh(refreshToken);
    log("getTokenFromRefreshToken tokenResponse: " + JSON.stringify(tokenSet), LogLevel.DEBUG, tokenSet);
    if (tokenSet && tokenSet.access_token) {
      // There will be a NEW refresh_token we have to use in the future. The old one is dead now.
      const { access_token: token, refresh_token: newRefreshToken, id_token: hintToken } = tokenSet;
      log("openId token: " + JSON.stringify(token), LogLevel.DEBUG, { token, newRefreshToken, hintToken });
      return { token, refreshToken: newRefreshToken, hintToken };
    } else {
      throw new Error("Could not get the auth token from: " + JSON.stringify(tokenSet));
    }
  } catch (error) {
    log("Error calling getTokenFromRefreshToken", LogLevel.WARN, error);
    throw error;
  }
}

export async function getLogoutUrl (req: NextApiRequest): Promise<string> {
  const post_logout_redirect_uri = `${getHostUrl(req)}${formatPageHref("/")}`;
  if (!isAuthEnabled()) {
    log("Authentication is turned off", IS_RUNNING_IN_AWS ? LogLevel.ERROR : LogLevel.WARN);
    return post_logout_redirect_uri;
  }
  const id_token_hint: string | undefined = getTokenFromQueryOrHeader(req, HINT_COOKIE_NAME);
  // If we don't have a token, all we can do is redirect to login
  // The openId logout will error if we don't pass a token
  if (id_token_hint) {
    // const logoutUrl: string = `${OPENID_OIDC_BASE_URL}/oauth2/v1/logout?id_token_hint=${token}&post_logout_redirect_uri=${homeUrl}}`;
    const openIdClient: Client = await getOpenIdClient();
    const logoutUrl = openIdClient.endSessionUrl({ id_token_hint, post_logout_redirect_uri });
    log("getLogoutUrl: " + logoutUrl, LogLevel.DEBUG, { id_token_hint, post_logout_redirect_uri });
    return logoutUrl;
  }
  return post_logout_redirect_uri;
}

// Check the auth. If we're not authorized, we'll use the response object to set a 401 or 403 and return undefined
// to let the caller know we've set a response
export async function authApi (req: NextApiRequest, res: NextApiResponse, requiredPermissions: AuthPermission = AuthPermission.User): Promise<AuthPermissions | undefined> {
  if (!isAuthEnabled()) {
    log("Authentication is turned off", IS_RUNNING_IN_AWS ? LogLevel.ERROR : LogLevel.WARN);
    return { token: undefined, authPermission: AuthPermission.Admin };
  }

  log(`Checking authorization for ${req.method} ${req.url}`, LogLevel.DEBUG);
  try {
    const token: string | undefined = getTokenFromQueryOrHeader(req);
    if (!token) {
      res.status(401).json({ message: "Not Authorized" });
      return undefined;
    }

    const authPermissions: AuthPermissions = await validateToken(token);
    log(`${req.method} ${req.url} authPermissions: ${JSON.stringify(authPermissions)}`, LogLevel.DEBUG);
    // If it's expired redirect to login
    if (authPermissions.authPermission === AuthPermission.Expired) {
      res.status(401).json({ message: "Session Expired. Please login again." });
      return undefined;
    }
    // If we don't have permissions or the permissions are not greater than requiredPermissions
    if (authPermissions.authPermission < requiredPermissions) {
      log("User was not authorized for api", LogLevel.WARN, { token, method: req.method, url: req.url });
      res.status(403).json({ message: "User is not authorized for this api. If you think this is an error, please contact the PerformanceQA team." });
      return undefined;
    }

    // Don't set the response, just return so the api can do the response
    return authPermissions;
  } catch (error) {
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    return undefined;
  }
}

const getCurrentUrlEncoded = (ctx: GetServerSidePropsContext) => {
  // When prepending the basePath, server side will only have the server side routing from /,
  // while window.location.pathname actually has the full path including the basepath
  return encodeURIComponent(formatPageHref(ctx.resolvedUrl || ""));
};

const redirectToLogin = (ctx: GetServerSidePropsContext, error?: any): string => {
  let state: string | undefined;
  // Server side, check if there's an existing state and use it
  if (ctx.query.state) {
    state = Array.isArray(ctx.query.state) ? ctx.query.state[0] : ctx.query.state;
  }
  // If we already have a state (from above) use it, otherwise encode the current state
  const currentUrlEncoded = state || getCurrentUrlEncoded(ctx);
  let errorFormatted: string | undefined;
  if (error) {
    if (typeof error === "string") {
      errorFormatted = encodeURIComponent(error);
    } else {
      errorFormatted = encodeURIComponent(error && error.message ? error.message : `${error}`);
    }
  }
  const baseLoginUrl: string = formatPageHref(`${AUTH_CALLBACK_PAGE_NAME}?state=${currentUrlEncoded}${errorFormatted ? `&error=${errorFormatted}` : ""}`);
  const loginUrl = formatPageHref(baseLoginUrl);
  log("loginUrl: " + loginUrl, LogLevel.DEBUG, { AUTH_CALLBACK_PAGE_NAME, baseLoginUrl, loginUrl });
  // If we have a req we're server side
  return loginUrl;
};

// This can be called from the server
export function setCookies (
  { ctx, token, refreshToken, hintToken }: {
    ctx: GetServerSidePropsContext,
    token: string,
    refreshToken?: string,
    hintToken?: string
  }) {
  const domain: string = getDomain(ctx.req);
  const path: string = getCookiePath(ctx.req) || "/";
  log(`Set cookie to ${token} on ${domain}`, LogLevel.DEBUG);
  // server side
  const oneDay: number = 60 * 60 * 24;
  const cookies: string[] = [cookie.serialize(AUTH_COOKIE_NAME, token, { domain, path, maxAge: oneDay * COOKIE_DURATION_DAYS })];
  if (refreshToken) {
    cookies.push(cookie.serialize(REFRESH_COOKIE_NAME, refreshToken, { domain, path, maxAge: oneDay * REFRESH_COOKIE_DURATION_DAYS }));
  }
  if (hintToken) {
    cookies.push(cookie.serialize(HINT_COOKIE_NAME, hintToken, { domain, path, maxAge: oneDay * COOKIE_DURATION_DAYS }));
  }
  // Set the cookie and then redirect
  ctx.res.setHeader("Set-Cookie", cookies);
}

function getTokenFromCookieOrHeader (ctx: GetServerSidePropsContext, cookieName: string = AUTH_COOKIE_NAME, headerName?: string): string | undefined {
  if (headerName === undefined) {
    headerName = cookieName;
  }
  let token: string | undefined = nextCookie(ctx)[cookieName];
  log("cookie token: " + JSON.stringify(token), LogLevel.DEBUG);
  // If we don't have a cookie token, check the querystring (for a redirect)
  const queryToken: string | string[] | undefined = ctx.query[headerName];
  if (!token && queryToken && !Array.isArray(queryToken)) {
    token = queryToken;
    log("query token: " + JSON.stringify(token), LogLevel.DEBUG);
  }
  // Or check the headers
  const headersToken: string | string[] | undefined = ctx.req && ctx.req.headers[headerName];
  log("ctx.req.headers: " + JSON.stringify(ctx.req && ctx.req.headers), LogLevel.DEBUG);
  if (!token && headersToken && !Array.isArray(headersToken)) {
    token = headersToken;
    log("header token: " + JSON.stringify(token), LogLevel.DEBUG);
  }
  return token;
}

export function getRefreshTokenFromCookie (ctx: GetServerSidePropsContext): string | undefined {
  return getTokenFromCookieOrHeader(ctx, REFRESH_COOKIE_NAME, REFRESH_COOKIE_NAME);
}

// This should be loaded on every page. If we need elevated permissions (Admin), pass requiredPermissions = AuthPermission.Admin
// This will redirect us to the login page if our session is expired, non-existent, or has insufficient priveleges.
export async function authPage (ctx: GetServerSidePropsContext, requiredPermissions: AuthPermission = AuthPermission.User): Promise<AuthPermissions | string> {
  if (!isAuthEnabled()) {
    log("Authentication is turned off", IS_RUNNING_IN_AWS ? LogLevel.ERROR : LogLevel.WARN);
    return { token: undefined, authPermission: AuthPermission.Admin };
  }
  const token: string | undefined = getTokenFromCookieOrHeader(ctx);

  // If we have a token, check if it has cas roles for this site
  if (token) {
    // Check if the token is valid
    // if we have a ctx.req we're server side and can just call the code
    const authPermissions: AuthPermissions = await validateToken(token);
    log("validateToken(token): " + JSON.stringify(authPermissions), LogLevel.DEBUG);
    // If it's expired redirect to login
    if (authPermissions.authPermission === AuthPermission.Expired) {
      return redirectToLogin(ctx, SESSION_EXPIRED_MESSAGE);
    }
    // If we don't have permissions or the permissions are not greater than requiredPermissions
    if (authPermissions.authPermission < requiredPermissions) {
      log("User was not authorized for page", LogLevel.WARN, { ...authPermissions, token: undefined, currentUrl: getCurrentUrlEncoded(ctx) });
      return redirectToLogin(ctx, NOT_AUTHORIZED_MESSAGE);
    }
    // Finally If we have a valid token, with permissions and are on the login page, return, let the page set the cookie and redirect
    return authPermissions;
  }

  return redirectToLogin(ctx);
}
