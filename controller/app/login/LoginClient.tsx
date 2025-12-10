"use client";

import { ACCESS_DENIED_AUTHENTICATION, NOT_AUTHORIZED_MESSAGE, logout as authLogout } from "../../src/authclient";
import { Alert, Danger, Info } from "../../components/Alert";
import { LogLevel, log } from "../../src/log";
import { Column } from "../../components/Div";
import { H1 } from "../../components/Headers";
import { JSX } from "react";
import { PAGE_TEST_HISTORY } from "../../types/pages";
import type { Route } from "next";
import { formatPageHref } from "../../src/clientutil";
import styles from "./Login.module.css";
import { useRouter } from "next/navigation";

export interface LoginClientProps {
  token: string | undefined;
  redirectUrl: string | undefined;
  errorLoading: string | undefined;
}

const NOT_AUTHORIZED_MESSAGE_AUTHENTICATION: JSX.Element = <><p>Please request 'Pewpew - User' permission if you need to be able to run tests.</p></>;
const ACCESS_DENIED_AUTHENTICATION_MESSAGE: JSX.Element = <><p>Please request either the 'Pewpew Test - User' (run tests) or 'Pewpew - Read Only' (view results) permission.</p></>;

export function LoginClient ({ token, redirectUrl, errorLoading }: LoginClientProps): JSX.Element {
  const router = useRouter();

  log("redirectUrl: " + redirectUrl, LogLevel.DEBUG);

  const clearCookies = () => {
    authLogout(true);
    router.push(formatPageHref(PAGE_TEST_HISTORY) as Route);
  };

  let extraErrorMessage: JSX.Element | undefined;
  if (errorLoading && errorLoading.includes(ACCESS_DENIED_AUTHENTICATION)) {
    extraErrorMessage = ACCESS_DENIED_AUTHENTICATION_MESSAGE;
  } else if (errorLoading && errorLoading.includes(NOT_AUTHORIZED_MESSAGE)) {
    extraErrorMessage = NOT_AUTHORIZED_MESSAGE_AUTHENTICATION;
  }

  return (
    <Column>
      <H1>Login Status</H1>
      {token && <Info>Authenticating</Info>}
      {errorLoading && <Danger><Column>
        <div>{errorLoading}</div>
        {extraErrorMessage && <><div>&nbsp;</div><div>{extraErrorMessage}</div></>}
      </Column></Danger>}
      {!token && redirectUrl && <a href={redirectUrl}><button className={styles.loginButton}>Login to run performance tests</button></a>}
      <br/><br/><br/><br/><br/><br/><br/><br/><br/><br/>
      <br/><br/><br/><br/><br/><br/><br/><br/><br/><br/>
      {!token && <Alert>If you encounter extended issues, try&nbsp;<button onClick={clearCookies}>Clearing your Cookies</button></Alert>}
    </Column>
  );
}
