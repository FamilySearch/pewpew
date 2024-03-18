import { API_PEWPEW, AuthPermission, AuthPermissions, TestManagerError } from "../types";
import { Danger, Info, Success } from "../components/Alert";
import Div, { Column } from "../components/Div";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { H1, H3 } from "../components/Headers";
import { LogLevel, log } from "./api/util/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import { PewPewVersions, VersionInitalProps } from "../components/PewPewVersions";
import React, { useState } from "react";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  formatError,
  formatPageHref,
  isTestManagerError,
  latestPewPewVersion
} from "./api/util/clientutil";
import { CheckboxButton } from "../components/CheckboxButton";
import DropFile from "../components/DropFile";
import FilesList from "../components/FilesList";
import Layout from "../components/Layout";
import { Line } from "rc-progress";
import { authPage } from "./api/util/authserver";
import { getServerSideProps as getPropsPewPewVersions } from "../components/PewPewVersions/initialProps";
import styled from "styled-components";

const AdminRow = styled(Div)`
  flex-flow: row wrap;
  flex: initial;
`;
const AdminColumn = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;
const CommonDiv = styled(Div)`
  flex: initial;
`;
const ButtonDiv = styled(Div)`
  flex: initial;
  vertical-align: middle;
  align-items: center;
  justify-content: center;
`;
const UploadPewpewButton = styled.button`
  width: 250px;
  height: 50px;
  text-align: center;
`;

// What this returns or calls from the parents
export interface AdminProps {
  authPermission?: AuthPermission;
  versionInitalProps: VersionInitalProps;
  error?: string;
}

// It's own data that will redraw the UI on changes
export interface AdminState {
  additionalFiles: File[];
  setLatestVersion: boolean;
  pewpewVersions: string[];
  pewpewVersion: string;
  uploading: boolean;
  uploadProgress: number;
  success: string | undefined;
  error: string | undefined;
}

const Admin = ({ authPermission, versionInitalProps, error: propsError }: AdminProps) => {
  let doubleClickCheck: boolean = false;
  const defaultState: AdminState = {
    additionalFiles: [],
    setLatestVersion: false,
    pewpewVersions: versionInitalProps.pewpewVersions,
    pewpewVersion: versionInitalProps.pewpewVersion,
    uploading: false,
    uploadProgress: 0,
    success: undefined,
    error: propsError
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<AdminState>) => setFormData((oldState: AdminState) => ({ ...oldState, ...newState}));
  // eslint-disable-next-line require-await
  const onDropFile = async (filelist: File[]) => {
    setState({
      success: undefined,
      error: undefined
    });
    if (filelist && filelist.length > 0) {
      const additionalFiles: File[] = [];
      for (const file of filelist) {
        // log("File Upload File", LogLevel.DEBUG, file);
        if (file.name === "pewpew" || file.name === "pewpew.exe" || file.name.endsWith(".zip")) {
          const existingIndex = state.additionalFiles.findIndex((additionalFile: File) => additionalFile.name === file.name);
          if (existingIndex >= 0) {
            // We can't have two files with the same name even if their path's are different. They go in the same s3 folder
            // Replace the existing one, but don't worry about redraw
            state.additionalFiles[existingIndex] = file;
          } else {
            // New file
            additionalFiles.push(file);
          }
        } else {
          setState({ error: "Only pewpew executables are allowed" });
        }
      }
      // We can't just assign the value in or it won't redraw the UI. You must call setState, but we have to copy in the old values
      setFormData((prevState: AdminState) => ({ ...prevState, additionalFiles: [...prevState.additionalFiles, ...additionalFiles] }));
    // } else {
      // This was called by the text input or we didn't add any files
    }
  };

  const onRemoveFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    setState({
      success: undefined,
      error: undefined
    });
    const button: HTMLButtonElement = event.target as HTMLButtonElement;
    const filename: string | undefined = button.name;
    if (!filename) { return; }
    // additional file
    setFormData((prevState: AdminState) => {
      const additionalFiles = prevState.additionalFiles.filter((additionalFile: File) => additionalFile.name !== filename);
      return { ...prevState, additionalFiles };
    });
  };

  const onChangeHandlerCheckbox = (event: React.MouseEvent<HTMLInputElement | HTMLLabelElement, MouseEvent>) => {
    const id: string = event.currentTarget.id;
    setFormData((oldState) => ({ ...oldState, [id]: !(oldState as any)[id] }));
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
        success: undefined,
        error: undefined
      });
      if (!state.additionalFiles || state.additionalFiles.length === 0) {
        setState({
          error: "You must provide pewpew file"
        });
        return;
      }
      const formData: FormData = new FormData();
      for (const additionalFile of state.additionalFiles) {
        formData.append("additionalFiles", additionalFile);
      }
      if (state.setLatestVersion) {
        log("setting form version: " + state.setLatestVersion, LogLevel.DEBUG);
        formData.append(latestPewPewVersion, "true");
      }
      // log("Admin formData:", LogLevel.DEBUG);
      // formData.forEach((value: FormDataEntryValue, key: string) => log(`${key}: ${value instanceof File ? value.name : value}`, LogLevel.DEBUG));
      const config: AxiosRequestConfig<FormData> = {
        onUploadProgress: (progressEvent) => {
          const { loaded, total } = progressEvent || {};
          if (typeof loaded !== "number" || typeof total !== "number") {
            log("onUploadProgress invalid loaded or total type", LogLevel.ERROR, { loaded, total, typeofloaded: typeof loaded, typeoftotal: typeof total });
            return;
          }
          const percent = Math.floor((loaded / total) * 100);
          log("onUploadProgress: " + loaded, LogLevel.DEBUG, { percent, loaded, total });
          setState({ uploadProgress: percent });
        }
      };
      const response: AxiosResponse = await axios.post(formatPageHref(API_PEWPEW), formData, config);
      // log("Admin post response", LogLevel.DEBUG, response);
      if (!isTestManagerError(response.data)) {
        const errorString = API_PEWPEW + " did not return a TestManagerError object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const testData: TestManagerError = response.data;
      log("pewpew post response json", LogLevel.DEBUG, testData);
      // If we have a testRunTime, use now as the earliest and set the latest to now + testRuntime + 10 minutes
      // Splunk time is in seconds
      setState({
        success: testData.message,
        setLatestVersion: false, // Set it back to false if it was checked (on success only)
        error: undefined
      });
    } catch (error) {
      log("Error uploading pewpew files", LogLevel.ERROR, error);
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

  const onChangeHandlerSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (event && event.target && event.target.name && event.target.value && event.target.value.length > 0) {
      setState({ [event.target.name]: event.target.value, success: undefined, error: undefined });
    }
  };

  const onClickHandlerDelete = async (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    if (doubleClickCheck) {
      return;
    }
    try {
      doubleClickCheck = true;
      event.preventDefault();
      setState({
        uploading: true,
        success: undefined,
        error: undefined
      });
      if (!state.pewpewVersion) {
        setState({
          error: "You must select a pewpew version"
        });
        return;
      }
      if (!confirm(`Would you like to delete pewpew version ${state.pewpewVersion}?`)) {
        return;
      }
      const deletePewPewVersion: string = state.pewpewVersion;
      const deleteURL = `${formatPageHref(API_PEWPEW)}?version=${deletePewPewVersion}`;
      log("deleteURL: " + deleteURL, LogLevel.DEBUG);
      // formData.forEach((value: FormDataEntryValue, key: string) => log(`${key}: ${value instanceof File ? value.name : value}`, LogLevel.DEBUG));
      const response: AxiosResponse = await axios.delete(deleteURL, { method: "DELETE" });
      // log("Admin post response", LogLevel.DEBUG, response);
      if (!isTestManagerError(response.data)) {
        const errorString = API_PEWPEW + " did not return a TestManagerError object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const testData: TestManagerError = response.data;
      log("pewpew post response json", LogLevel.DEBUG, testData);
      // If we have a testRunTime, use now as the earliest and set the latest to now + testRuntime + 10 minutes
      // Splunk time is in seconds

      setFormData(({ pewpewVersions: oldPewPewVersions, ...prevState }: AdminState) => {

        const pewpewVersions: string[] = oldPewPewVersions.filter((version: string) => version !== deletePewPewVersion);
        return {
          ...prevState,
          pewpewVersions,
          pewpewVersion: latestPewPewVersion,
          success: testData.message,
          error: undefined
        };
      });
    } catch (error) {
      log("Error uploading pewpew files", LogLevel.ERROR, error);
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
      <AdminColumn>
        <H1>Admin Page</H1>
        {state.error && <Danger>Error: {state.error}</Danger>}
        {state.success && <Success>Success: {state.success}</Success>}
        <AdminRow>
        <AdminColumn>
        <H3>Upload a new version of PewPew</H3>
        <form onSubmit={onClickHandlerSubmit}>
          <AdminRow className="admin">
          <AdminColumn className="admin-form">
            <CommonDiv className="version-div">
              <label>Set version as {latestPewPewVersion}:&nbsp;</label>
              <CheckboxButton id="setLatestVersion" value={state.setLatestVersion} text={state.setLatestVersion ? "Y" : "N"} onClick={onChangeHandlerCheckbox} />
              &nbsp;(Sets this as the default version run for all tests)
            </CommonDiv>
            <FilesList files={state.additionalFiles} onClick={onRemoveFile} />
            <DropFile onDropFile={onDropFile} />
            <ButtonDiv>
              {state.uploading
                ? <Column>
                    <Line
                      percent={state.uploadProgress}
                      strokeWidth={10} // left side (finished) of the line. "percent"
                      strokeColor={"#5cf52d"}
                      trailWidth={6} // Right side (unfinished) of the line
                      strokeLinecap={"round"}
                    />
                    <Info>Files Changing: {state.uploadProgress}%</Info>
                  </Column>
                : <UploadPewpewButton className="upload-pewpew-button" type="submit">Upload PewPew</UploadPewpewButton>
              }
            </ButtonDiv>
          </AdminColumn>
        </AdminRow>
        </form>
        </AdminColumn>
        <AdminColumn>
        <H3>Remove old version of PewPew</H3>
        <PewPewVersions name="pewpewVersion" {...versionInitalProps} pewpewVersions={state.pewpewVersions} pewpewVersion={state.pewpewVersion} onChange={onChangeHandlerSelect} />
        <ButtonDiv>
          {state.uploading
            ? <Info>Files Changing</Info>
            : <UploadPewpewButton name="delete" onClick={onClickHandlerDelete}>Remove PewPew Version</UploadPewpewButton>
          }
        </ButtonDiv>
        </AdminColumn>
        </AdminRow>
      </AdminColumn>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<AdminProps>> => {
  let versionInitalProps: VersionInitalProps = { pewpewVersion: "", loading: false, pewpewVersions: [], latestPewPewVersion: "", error: true };
  try {
    // Authenticate
    const authPermissions: AuthPermissions | string = await authPage(ctx, AuthPermission.Admin);
    // If we have a authPermissions we're authorized, if we're not, we'll redirect
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        },
        props: { versionInitalProps }
      };
    }

    versionInitalProps = await getPropsPewPewVersions();

    return { props: { authPermission: authPermissions.authPermission, versionInitalProps } };
  } catch (error) {
    logServer("Error loading versions", LogLevelServer.ERROR, error);
    return {
      props: {
        error: `Error loading data: ${formatError(error)}`,
        versionInitalProps
      }
    };
  }
};

export default Admin;
