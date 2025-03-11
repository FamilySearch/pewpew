import { API_TEST, AuthPermission, AuthPermissions, PAGE_TEST_HISTORY, TestManagerMessage } from "../types";
import { Danger, Info, Success } from "../components/Alert";
import Div, { Column } from "../components/Div";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { LogLevel, log } from "./api/util/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import React, { useState } from "react";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  formatError,
  formatPageHref,
  isTestManagerMessage,
  isYamlFile
} from "./api/util/clientutil";
import DropFile from "../components/DropFile";
import FilesList from "../components/FilesList";
import { H1 } from "../components/Headers";
import Layout from "../components/Layout";
import { Line } from "rc-progress";
import LinkButton from "../components/LinkButton";
import { authPage } from "./api/util/authserver";
import styled from "styled-components";

const TestUpdateRow = styled(Div)`
  flex-flow: row wrap;
  flex: initial;
`;
const TestUpdateColumn = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;
const ButtonDiv = styled(Div)`
  flex: initial;
  vertical-align: middle;
  align-items: center;
  justify-content: center;
`;
const UpdateYamlButton = styled.button`
  font-size: 1.25rem;
  width: 200px;
  height: 50px;
  text-align: center;
  margin: 10px;
`;

// What this returns or calls from the parents
export interface TestUpdateProps {
  testId?: string;
  authPermission?: AuthPermission;
}

// It's own data that will redraw the UI on changes
export interface TestUpdateState {
  yamlFile: File | undefined;
  bypassParser: boolean;
  success: string | undefined;
  uploading: boolean;
  uploadProgress: number;
  error: string | undefined;
}

const TestUpdate = ({ testId, authPermission }: TestUpdateProps) => {
  let doubleClickCheck: boolean = false;
  const defaultState: TestUpdateState = {
    yamlFile: undefined,
    bypassParser: false,
    success: undefined,
    uploading: false,
    uploadProgress: 0,
    error: undefined
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<TestUpdateState>) => setFormData((oldState: TestUpdateState) => ({ ...oldState, ...newState}));
  // eslint-disable-next-line require-await
  const onDropFile = async (filelist: File[]) => {
    if (filelist && filelist.length > 0) {
      for (const file of filelist) {
        // log("File Upload File", LogLevel.DEBUG, file);
        if (isYamlFile(file.name)) {
          // Replace it, don't add
          setState({ yamlFile: file, error: undefined });
        } else {
          setState({ error: "Only Yaml files are supported" });
        }
      }
    } else {
      // This was called by the text input or we didn't add any files
      setState({ error: undefined });
    }
  };

  const onRemoveFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    const button: HTMLButtonElement = event.target as HTMLButtonElement;
    const filename: string | undefined = button.name;
    if (!filename) { return; }
    if (isYamlFile(filename)) {
      // yamlFile
      setState({ yamlFile: undefined, error: undefined });
    }
  };

  const onChangeHandlerCheckbox = (event: React.ChangeEvent<HTMLInputElement>) => {
    setState({ [event.target.name]: event.target.checked });
  };

  const onClickHandlerSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    if (doubleClickCheck) {
      return;
    }
    try {
      doubleClickCheck = true;
      event.preventDefault();
      setState({
        uploading: true,
        uploadProgress: 0,
        error: undefined
      });
      if (!state.yamlFile) {
        setState({ error: "You must provide 1 yaml file" });
        return;
      }
      const formData: FormData = new FormData();
      formData.append("yamlFile", state.yamlFile);
      formData.append("testId", testId!);
      if (state.bypassParser) {
        formData.append("bypassParser", "true");
      }
      const config: AxiosRequestConfig<FormData> = {
        onUploadProgress: (progressEvent) => {
          const { loaded, total } = progressEvent || {};
          if (typeof loaded !== "number" || typeof total !== "number") {
            log("onUploadProgress invalid loaded or total type", LogLevel.DEBUG, { loaded, total, typeofloaded: typeof loaded, typeoftotal: typeof total });
            return;
          }
          const percent = Math.floor((loaded / total) * 100);
          log("onUploadProgress: " + loaded, LogLevel.DEBUG, { percent, loaded, total });
          setState({ uploadProgress: percent });
        }
      };
      // log("TestUpdate formData:", LogLevel.DEBUG);
      // formData.forEach((value: FormDataEntryValue, key: string) => log(`${key}: ${value instanceof File ? value.name : value}`, LogLevel.DEBUG));
      const response: AxiosResponse = await axios.put(formatPageHref(API_TEST), formData, config);
      // log("TestUpdate post response", LogLevel.DEBUG, response);
      if (!isTestManagerMessage(response.data)) {
        const errorString = API_TEST + " did not return a TestManagerMessage object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const testData: TestManagerMessage = response.data;
      log("StartNewTest post response json", LogLevel.DEBUG, testData);
      // If we have a testRunTime, use now as the earliest and set the latest to now + testRuntime + 10 minutes
      // Splunk time is in seconds
      setState({
        success: `${testData.message}${testData.messageId ? `\nmessageId: ${testData.messageId}` : ""}`,
        error: undefined
      });
    } catch (error) {
      log("Error submitting test", LogLevel.ERROR, error);
      setState({
        error: formatError(error)
      });
    } finally {
      setState({
        uploading: false
      });
      doubleClickCheck = false;
    }
  };

  return (
    <Layout authPermission={authPermission}>
      <TestUpdateColumn>
        <H1>Update Yaml file for testId: {testId}</H1>
        {testId ?
        <form onSubmit={onClickHandlerSubmit}>
          <TestUpdateRow className="update-yaml">
            <TestUpdateColumn className="update-yaml-form">
              {(authPermission === undefined || authPermission === AuthPermission.Admin) ? <Div className="bypass-div">
                <label> Bypass Config Parser </label>
                <input type="checkbox" name="bypassParser" className="bypass-control"
                  checked={state.bypassParser} onChange={onChangeHandlerCheckbox} />
              </Div> : undefined }
              <FilesList files={state.yamlFile ? [state.yamlFile] : []} onClick={onRemoveFile} />
              <DropFile onDropFile={onDropFile} />
              <ButtonDiv className="button-div">
                {state.uploading
                  ? <Column>
                      <Line
                        percent={state.uploadProgress}
                        strokeWidth={5} // left side (finished) of the line. "percent"
                        strokeColor={"#5cf52d"}
                        trailWidth={3} // Right side (unfinished) of the line
                        strokeLinecap={"round"}
                      />
                      <Info>File Uploading: {state.uploadProgress}%</Info>
                    </Column>
                  : <>
                      <UpdateYamlButton type="submit">Update Yaml File</UpdateYamlButton>
                      <LinkButton theme={{ buttonFontSize: "1.25rem", buttonWidth: "200px", buttonHeight: "50px" , buttonMargin: "10px"}}
                        href={PAGE_TEST_HISTORY + "?testId=" + testId}>Back to Test Status</LinkButton>
                    </>
                }
              </ButtonDiv>
              {state.error && <Danger>Error: {state.error}</Danger>}
              {state.success && <Success>{state.success}</Success>}
            </TestUpdateColumn>
          </TestUpdateRow>
        </form>
        : <Danger>Must provide a TestId to this page</Danger>
        }
      </TestUpdateColumn>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<TestUpdateProps>> => {
  try {
    // Authenticate
    const authPermissions: AuthPermissions | string = await authPage(ctx, AuthPermission.User);
    // If we have a authPermissions we're authorized, if we're not, we'll redirect
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        },
        props: {}
      };
    }

    // If we get more than one testId, just return all, don't try to pick one
    if (ctx.query && ctx.query.testId && !Array.isArray(ctx.query.testId)) {
      const testId: string = ctx.query.testId;
      return {
        props: { testId, authPermission: authPermissions.authPermission }
      };
    } else {
      return {
        props: { testId: undefined, authPermission: authPermissions.authPermission }
      };
    }
  } catch (error) {
    logServer("Error loading permissions", LogLevelServer.WARN, error);
    throw error;
  }
};

export default TestUpdate;
