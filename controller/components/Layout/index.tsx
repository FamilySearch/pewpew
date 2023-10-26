import {
  API_LOGOUT,
  AuthPermission,
  PAGE_ADMIN,
  PAGE_CALENDAR,
  PAGE_START_TEST,
  PAGE_TEST_HISTORY,
  PAGE_YAML_WRITER
} from "../../types";
import { Button, LinkButton, defaultButtonTheme } from "../LinkButton";
import React, { useEffect } from "react";
import { formatAssetHref, getBasePath } from "../../pages/api/util/clientutil";
import styled, { createGlobalStyle } from "styled-components";
import Div from "../Div";
import Head from "next/head";
import { logout as authLogout } from "../../pages/api/util/authclient";
import getConfig from "next/config";

// Have to check for null on this since the tsc test compile it will be, but nextjs will have a publicRuntimeConfig
const publicRuntimeConfig: any = getConfig() && getConfig().publicRuntimeConfig ? getConfig().publicRuntimeConfig : process.env;
const HIDE_ENVIRONMENT: unknown = publicRuntimeConfig.HIDE_ENVIRONMENT;

export type OtherControllers = Record<string, {
    url: string;
    hover?: string;
  }>;

export const OTHER_CONTROLLERS_DEFAULT: OtherControllers = {
  // This can be populated if you have multiple controllers to link to them
};
export const OTHER_CONTROLLERS: OtherControllers = {};
if (Object.keys(OTHER_CONTROLLERS).length === 0) {
  for (const [name, data] of Object.entries(OTHER_CONTROLLERS_DEFAULT)) {
    if (!data || typeof HIDE_ENVIRONMENT === "string" && HIDE_ENVIRONMENT.toLowerCase().includes(name.toLowerCase())) {
      continue;
    }
    OTHER_CONTROLLERS[name] = { ...data };
  }
}

export const GlobalStyle = createGlobalStyle`
  body {
    background-color: rgb(30, 30, 30);
    color: rgb(200, 200, 200);
    // https://familysearch.slack.com/archives/C09E2K6PL/p1577117592008900
    // https://www.youtube.com/watch?v=jVhlJNJopOQ
    // font-family: Papyrus,fantasy;
    font-family: sans-serif;
    font-size: 1.25rem;
    line-height: 150%;
    text-align: center;
  }
  input, select, option, button, textarea {
    background-color: rgb(51, 51, 51);
    color: rgb(200, 200, 200);
    // font-family: Papyrus,fantasy;
    font-size: .9rem;
  }
  ul {
    text-align: left;
  }
  a {
    color: lightblue;
  }
  a:visited {
    color: magenta;
  }
`;

const Root = styled.div`
  min-height: 100vh;
  flex-flow: column wrap;
  align-content: stretch;
  justify-content: left;
`;
const Index = styled(Div)`
  flex-flow: column wrap;
  align-content: stretch;
`;
const LinkContainer = styled(Div)`
  flex: 1;
  flex-flow: row wrap;
  text-align: center;
`;
const LinkDiv = styled(Div)`
  padding: 2px;
`;
const ImagePewPew = styled.img`
  height: 20px;
  width: 70px;
  align-self: center;
`;

// We need the AuthPermission to know if we should show the admin page link.
export interface LayoutProps {
  title?: string;
  children: any;
  authPermission: AuthPermission | undefined;
  otherControllers?: OtherControllers;
}

export const Layout = ({
    title = "PewPew as a Service - Run your load tests!",
    children,
    authPermission,
    otherControllers = OTHER_CONTROLLERS
  }: LayoutProps) => {
    // There seems to be a bug when usling our LinkButton that when the button goes
    // to "/" it removes the "/" from the url and refresh breaks if there is a query param
    // Ctrl-click keeps the trailing slash, but the click routing removes it.
    // Two possible fixes. 1) Fix the routing in nginx. I don't think we can fix the routing by
    // re-adding the trailing slash since it's on the familysearch routing. we get a 301 without the query param on refresh
    // 2) On the client-side check if we're at the root
    // And re-write the url without causing a redirect to add back in the "/"
    // 3) https://nextjs.org/docs/api-reference/next.config.js/trailing-slash doesn't work.
    // https://github.com/vercel/next.js/issues/22122 and it then removes our basepath when redirecting to the /
    useEffect(() => {
      const basePath = getBasePath();
      // This is solution (2). If we have a basepath and it doesn't have a trailing slash add it
      if (basePath && basePath === window.location.pathname) {
        const newLoc = `${window.location.origin}${window.location.pathname}/${window.location.search}`;
        // console.log(`changing ${window.location.href} to ${newLoc}`);
        window.history.replaceState(null, title, newLoc);
      }
    });

    return (
    <React.Fragment>
      <GlobalStyle />
      <Head>
        <title>{title}</title>
        <link rel="apple-touch-icon" sizes="180x180" href={formatAssetHref("/img/apple-touch-icon.png")}/>
        <link rel="icon" type="image/png" sizes="32x32" href={formatAssetHref("/img/favicon-32x32.png")}/>
        <link rel="icon" type="image/png" sizes="16x16" href={formatAssetHref("/img/favicon-16x16.png")}/>
        <link rel="manifest" href={formatAssetHref("/img/site.webmanifest")}/>
        <link rel="mask-icon" href={formatAssetHref("/img/safari-pinned-tab.svg")} color="#5bbad5"/>
        <link rel="shortcut icon" href={formatAssetHref("/img/favicon.ico")}/>
        <meta name="msapplication-TileColor" content="#da532c"/>
        <meta name="msapplication-config" content="/img/browserconfig.xml"/>
        <meta name="theme-color" content="#ffffff"/>
      </Head>
      <Root id="root">
        <LinkContainer>
          <LinkDiv>
            <ImagePewPew className="img-pewpew" src={formatAssetHref("/img/pewpew.jpg")} alt="PEW PEW IMAGE" />
          </LinkDiv>
          <LinkDiv>
            <LinkButton href={PAGE_START_TEST} title="Start a new load test">New Test</LinkButton>
          </LinkDiv>
          <LinkDiv>
            <LinkButton href={PAGE_TEST_HISTORY} title="View the test history or search for a test">Test History</LinkButton>
          </LinkDiv>
          <LinkDiv>
            <LinkButton href={PAGE_CALENDAR} title="View the test calendar">Calendar</LinkButton>
          </LinkDiv>
          <LinkDiv>
            <LinkButton href={PAGE_YAML_WRITER} title="Convert a HAR file to a YAML load test">Yaml Writer</LinkButton>
          </LinkDiv>
          {authPermission === AuthPermission.Admin &&
            <LinkDiv>
              <LinkButton href={PAGE_ADMIN} title="Manage the pewpew versions">Admin</LinkButton>
            </LinkDiv>
          }
          {Object.entries(otherControllers).map(([name, data]) =>
            <LinkDiv key={name}>
              <a href={data.url} title={data.hover} ><Button name={name} theme={{...defaultButtonTheme}}>{name} Controller</Button></a>
            </LinkDiv>)}
          <LinkDiv>
            <LinkButton href={API_LOGOUT} title="Log out of the controller" onClick={() => authLogout()}>Logout</LinkButton>
          </LinkDiv>
        </LinkContainer>
        <Index className="index">
          {children}
        </Index>
      </Root>
    </React.Fragment>
    );
  };

export default Layout;
