import {
  ACCESS_DENIED_AUTHENTICATION,
  NOT_AUTHORIZED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  logout as authLogout
} from "./api/util/authclient";
import { Alert, Danger, Info, Warning } from "../components/Alert";
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  NextApiRequest
} from "next";
import { LogLevel, log } from "./api/util/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import { formatError, formatPageHref, getHostUrl } from "./api/util/clientutil";
import {
  getLoginApiUrl,
  getRefreshTokenFromCookie,
  getTokenFromCode,
  getTokenFromRefreshToken,
  setCookies,
  validateUrlDomain
} from "./api/util/authserver";
import Div from "../components/Div";
import { H1 } from "../components/Headers";
import React from "react";
import Router from "next/router";
import { TokenResponse } from "../types";
import styled from "styled-components";

const LoginColumn = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;
const LoginButton = styled.button`
  width: 250px;
  height: 50px;
  text-align: center;
`;

// What this returns or calls from the parents
export interface LoginProps {
  token: string | undefined;
  redirectUrl: string | undefined;
  errorLoading: string | undefined;
}

const NOT_AUTHORIZED_MESSAGE_AUTHENTICATION: JSX.Element = <><p>Please request 'Pewpew - User' permission if you need to be able to run tests.</p><Warning>DO NOT request 'Non Prod' Permissions. Those are for internal authentication testing only.</Warning></>;
const ACCESS_DENIED_AUTHENTICATION_MESSAGE: JSX.Element = <><p>Please request either the 'Pewpew Test - User' (run tests) or 'Pewpew - Read Only' (view results) permission.</p><Warning>DO NOT request 'Non Prod' Permissions. Those are for internal authentication testing only.</Warning></>;

const Login = ({ token, redirectUrl, errorLoading }: LoginProps): JSX.Element => {
  log("redirectUrl: " + redirectUrl, LogLevel.DEBUG);
  const clearCookies = () => {
    authLogout(true);
    Router.push("/", formatPageHref("/"))
    .catch((error) => log("Error redirecting to /", LogLevel.ERROR, error));
  };
  let extraErrorMessage: JSX.Element | undefined;
  // ACCESS_DENIED_AUTHENTICATION means they have NO permissions whatsoever for this app
  if (errorLoading && errorLoading.includes(ACCESS_DENIED_AUTHENTICATION)) {
    extraErrorMessage = ACCESS_DENIED_AUTHENTICATION_MESSAGE;
  } else if (errorLoading && errorLoading.includes(NOT_AUTHORIZED_MESSAGE)) {
    // NOT_AUTHORIZED_MESSAGE is insufficient permissions. They need User
    extraErrorMessage = NOT_AUTHORIZED_MESSAGE_AUTHENTICATION;
  }
  return (
    <LoginColumn>
      <H1>Login Status</H1>
      {token && <Info>Authenticating</Info>}
      {errorLoading && <Danger><LoginColumn>
        <div>{errorLoading}</div>
        {extraErrorMessage && <><div>&nbsp;</div><div>{extraErrorMessage}</div></>}
      </LoginColumn></Danger>}
      {!token && redirectUrl && <a href={redirectUrl}><LoginButton>Login to run performance tests</LoginButton></a>}
      <br/><br/><br/><br/><br/><br/><br/><br/><br/><br/>
      <br/><br/><br/><br/><br/><br/><br/><br/><br/><br/>
      {!token && <Alert>If you encounter extended issues, try&nbsp;<button onClick={clearCookies}>Clearing your Cookies</button></Alert>}
    </LoginColumn>
  );
};

const getAndValidateUrlFromState = (state: string | string[] | undefined, hostUrl: string): string => {
  const redirectUrl: string = state && !Array.isArray(state) ? decodeURIComponent(state) : "";
  log("redirectUrl: " + redirectUrl, LogLevel.DEBUG, { redirectUrl, state });

  if (redirectUrl === "" || redirectUrl.startsWith("/")) {
    return redirectUrl;
  }
  try {
    const url: URL = new URL(redirectUrl, hostUrl);
    validateUrlDomain(url);
  } catch (error) {
    log("Error parsing redirect url from query.state", LogLevel.WARN, error, { state, hostUrl });
    throw error;
  }
  return redirectUrl;
};

// Three ways to get this page:
// 1. Return from oauth => validate code and token
// 2. No token or expired token => If we have a refresh token try it (unless we have an error with permissions)
// 3. Not authorized for page => Show error
// 4: No token or expired token => show login
// 4?: This page timed out
export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<LoginProps>> => {
  let loginApiUrl: string | undefined;
  try {
    // Create the Login API to use always
    loginApiUrl = getLoginApiUrl(ctx);

    // 1. Check the query for a code on redirect back from AUTH
    if (ctx.query.code && !Array.isArray(ctx.query.code)) {
      const tokenResponse: TokenResponse = await getTokenFromCode({ ...(ctx.req), query: ctx.query, headers: ctx.req.headers } as NextApiRequest);
      const { token, refreshToken: newRefreshToken, hintToken } = tokenResponse;
      if (token) {
        logServer("auth token: " + JSON.stringify(token), LogLevelServer.DEBUG, { token, refreshToken: newRefreshToken, hintToken });
      } else {
        throw new Error("Could not get the auth token from: " + JSON.stringify(tokenResponse));
      }
      const redirectUrl: string = getAndValidateUrlFromState(ctx.query.state, getHostUrl(ctx.req));
      // Instead of loading the page and setting the cookie, we do a 302 to redirectUrl and add a Set-Cookie header
      setCookies({ ctx, token, refreshToken: newRefreshToken, hintToken });
      return {
        redirect: { destination: redirectUrl, permanent: false },
        props: { token, redirectUrl, errorLoading: undefined }
      };
    }

    let errorLoading: string | undefined = ctx.query.error && !Array.isArray(ctx.query.error) ? ctx.query.error : undefined;
    if (errorLoading && ctx.query.error_description && !Array.isArray(ctx.query.error_description)) {
      errorLoading += " - " + ctx.query.error_description;
    }

    // 2. Check if we have a refreshToken
    // But only if we don't have a an error message or an expired message.
    // If it's a insufficient permissions, we need to display that not go into a refresh loop
    const refreshToken: string | undefined = getRefreshTokenFromCookie(ctx);
    // If we have a refreshToken, attempt to use it.
    if (refreshToken && (errorLoading === undefined || errorLoading === SESSION_EXPIRED_MESSAGE)) {
      const tokenResponse: TokenResponse = await getTokenFromRefreshToken(refreshToken);
      // The old refresh token is dead. This is a new one
      const { token, refreshToken: newRefreshToken, hintToken } = tokenResponse;
      if (token) {
        logServer("auth token: " + JSON.stringify(token), LogLevelServer.DEBUG, { token, refreshToken, hintToken });
      } else {
        throw new Error("Could not get the auth token from: " + JSON.stringify(tokenResponse));
      }
      const redirectUrl: string = getAndValidateUrlFromState(ctx.query.state, getHostUrl(ctx.req));
      // Instead of loading the page and setting the cookie, we do a 302 to redirectUrl and add a Set-Cookie header
      setCookies({ ctx, token, refreshToken: newRefreshToken, hintToken });
      return {
        redirect: { destination: redirectUrl, permanent: false },
        props: { token, redirectUrl, errorLoading: undefined }
      };
    }

    // 3. Check if we have an error to display
    if (errorLoading) {
      return {
        props: { token: undefined, redirectUrl: loginApiUrl, errorLoading }
      };
    }

    // 4. Redirect to the login API, if we've come from another page (redirect) we'll have a state to pass on
    return {
      redirect: {
        destination: loginApiUrl,
        permanent: false
      },
      props: { token: undefined, redirectUrl: loginApiUrl, errorLoading: undefined }
    };
  } catch (error) {
    const errorLoading = formatError(error);
    logServer("Error Logging In: " + errorLoading, LogLevelServer.WARN, error);
    return {
      props: { token: undefined, redirectUrl: loginApiUrl, errorLoading }
    };
  }
};

export default Login;
