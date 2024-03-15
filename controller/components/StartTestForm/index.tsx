import {
  API_SCHEDULE,
  API_TEST,
  API_YAML_FORMAT,
  AuthPermission,
  AuthPermissions,
  EnvironmentVariablesFile,
  PAGE_CALENDAR,
  PAGE_TEST_HISTORY,
  PreviousTestData,
  TestData
} from "../../types";
import { Column, Div, DivLeft, DivRight, Row } from "../Div";
import { Danger, Info, Warning } from "../Alert";
import {
  EnvironmentVariablesList,
  EnvironmentVariablesState,
  EnvironmentVariablesUpdate
} from "../EnvironmentVariablesList";
import { H1, H3 } from "../Headers";
import { LogLevel, log } from "../../pages/api/util/log";
import PewPewVersions, { VersionInitalProps } from "../PewPewVersions";
import React, { useState } from "react";
import TestQueues, { QueueInitialProps } from "../TestQueues";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  formatError,
  formatPageHref,
  getMaxVersion,
  isTestData,
  isYamlFile,
  latestPewPewVersion
} from "../../pages/api/util/clientutil";
import { CheckboxButton } from "../CheckboxButton";
import DatePicker from "react-datepicker";
import DropFile from "../DropFile";
import FilesList from "../FilesList";
import { Line } from "rc-progress";
import LinkButton from "../LinkButton";
import TestInfo from "../TestInfo";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { YamlViewer } from "../YamlViewer";
import styled from "styled-components";
import { useRouter } from "next/router";
const CommonDiv = styled(Div)`
  flex: initial;
`;
const LabelDiv = DivLeft;
const ContentDiv = DivRight;
const ButtonDiv = styled(Div)`
  flex: initial;
  vertical-align: middle;
  align-items: center;
  justify-content: center;
`;
const UploadTestButton = styled.button`
  width: 250px;
  height: 50px;
  text-align: center;
`;

const notAuthorizedMessageOpenId = (username?: string | null): JSX.Element => <Info>
  <Column>
  <p>
    {`'${username}'` || "User"} is not authorized to run tests.<br/>
    Please request 'Pewpew - User' permission if you need to be able to run tests.
  </p>
  <Warning>DO NOT request 'Non Prod' Permissions. Those are for internal authentication testing only.</Warning>
  </Column>
  </Info>;

/** Props to pass to the StartTestForm */
export interface StartTestProps {
  queueInitialProps: QueueInitialProps;
  versionInitalProps: VersionInitalProps;
  /** We need the full Permissions so we can check the user id if it's a User */
  authPermissions?: AuthPermissions;
  /** Date to prepop into the date/time picker */
  queryScheduleDate?: number; // Passing this in as a Date gave our time picker errors. Switched it to a number and it works fine.
  previousTestData?: PreviousTestData;
  editSchedule?: boolean;
  error?: string;
}

/** Used for testing and storybook to set uploading and uploadProgress display */
export interface StartTestPropsStorybook extends StartTestProps {
  uploading?: boolean;
  uploadProgress?: number;
}

// It's own data that will redraw the UI on changes
interface DayValue {
  name: string;
  value: boolean;
}
export interface StartTestState {
  yamlFile: File | string | undefined;
  additionalFiles: (File | string)[];
  scheduleTest: boolean;
  scheduleDate: Date;
  recurringTest: boolean;
  endDate: Date;
  daysOfWeek: DayValue[];
  allDays: boolean;
  queueName: string;
  pewpewVersion: string;
  environmentVariables: EnvironmentVariablesState[];
  restartOnFailure: boolean;
  bypassParser: boolean;
  testId: string | undefined;
  s3Folder: string | undefined;
  resultsFileLocation: string[] | undefined;
  startTime: number | undefined;
  endTime: number | undefined;
  testStatus: TestStatus;
  uploading: boolean;
  uploadProgress: number;
  error: string | undefined;
  yamlFileExpand: boolean;
  yamlFileContents?: string;
  yamlFileLoading?: true;
  yamlError?: string;
}

function readFile (file: File): Promise<string | ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const reader: FileReader = new FileReader();
    reader.onabort = () => reject("file reading was aborted");
    reader.onerror = () => reject("file reading has failed");
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file, "utf8");
  });
}

const FIFTEEN_MINUTES: number = 15 * 60 * 1000;
export const ONE_WEEK: number = 7 * 24 * 60 * 60 * 1000;
export const SIX_MONTHS: number = (364 / 2) * 24 * 60 * 60 * 1000;
/** Dummy value to inject into the variables list. If the environment variable still has this value, don't pass it on */
const PREVIOUS_ENVIRONMENT_VARIABLE_VALUE = "Value Stored On Server";
const DAYS_ARRAY: string[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ALL_DAYS_NAME: string = "All";

export const StartTestForm = ({
  queueInitialProps,
  versionInitalProps,
  authPermissions,
  queryScheduleDate,
  previousTestData,
  error: propsError,
  editSchedule,
  ...storybookProps // Additional props that are StartTestPropsStorybook
}: StartTestProps) => {
  const authPermission: AuthPermission | undefined = authPermissions?.authPermission;
  const notAuthorizedMessage = notAuthorizedMessageOpenId(authPermissions?.userId);
  const readOnly: true | undefined = authPermission === AuthPermission.ReadOnly ? true : undefined;
  let doubleClickCheck: boolean = false;
  const defaultDate: Date = new Date(
    previousTestData?.scheduleDate
    || queryScheduleDate
    || Math.ceil(Date.now() / FIFTEEN_MINUTES) * FIFTEEN_MINUTES);
  // Check if we have a previous daysOfWeek and map to turn the ones on that need to be. Otherwise everything on.
  const defaultDaysOfWeek: DayValue[] = DAYS_ARRAY.map((name: string, index: number): DayValue =>
    ({ name, value: previousTestData?.daysOfWeek ? previousTestData.daysOfWeek.includes(index) : true }));
  const maxPewPewVersion: string = getMaxVersion(versionInitalProps.pewpewVersions);
  const recurringTest: boolean = (previousTestData?.daysOfWeek && previousTestData?.endDate) ? true : false;
  const defaultState: StartTestState = {
    yamlFile: previousTestData?.yamlFile || undefined,
    additionalFiles: previousTestData?.additionalFiles || [],
    scheduleTest: previousTestData?.scheduleDate || queryScheduleDate ? true : false,
    scheduleDate: defaultDate,
    recurringTest,
    endDate: new Date(previousTestData?.endDate || defaultDate.getTime() + ONE_WEEK), // Default the end date to one week later
    daysOfWeek: defaultDaysOfWeek,
    allDays: defaultDaysOfWeek.every((dayOfWeek: DayValue) => dayOfWeek.value),
    queueName: previousTestData?.queueName || queueInitialProps.queueName,
    pewpewVersion: previousTestData?.version || (recurringTest ? maxPewPewVersion : versionInitalProps.pewpewVersion),
    environmentVariables:  previousTestData?.environmentVariables
      ? Object.entries(previousTestData.environmentVariables).map(([variableName, variableValue]: [string, string | null], index: number) => ({
        // Map these to the placeholder values
        name: "previousVar" + index, // We can't use the date or we'll get constant redraws, use the index
        variableName,
        variableValue: variableValue === null ? PREVIOUS_ENVIRONMENT_VARIABLE_VALUE : variableValue,
        type: variableValue === null ? "password" : "text"
      }))
      : [],
    restartOnFailure: previousTestData?.restartOnFailure || false,
    bypassParser: previousTestData?.bypassParser || false,
    testId: previousTestData?.testId,
    s3Folder: previousTestData?.s3Folder,
    resultsFileLocation: previousTestData?.resultsFileLocation,
    startTime: previousTestData?.startTime,
    endTime: previousTestData?.endTime,
    testStatus: (previousTestData?.status) || TestStatus.Unknown,
    uploading: false,
    uploadProgress: 0,
    error: propsError,
    yamlFileExpand: false
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<StartTestState>) =>
    setFormData((oldState: StartTestState) => ({ ...oldState, ...newState}));
  const router = useRouter();

  const onDropFile = async (filelist: File[]) => {
    if (filelist && filelist.length > 0) {
      const newAdditionalFiles: File[] = [];
      for (const file of filelist) {
        // log("File Upload File", LogLevel.DEBUG, file);
        if (isYamlFile(file.name)) {
          // Replace it
          setState({ yamlFile: file, error: undefined });
        } else if (file.name.endsWith(".sh")) {
          try {
            const newEnvironmentVariables: EnvironmentVariablesState[] = [];
            const fileText: string | ArrayBuffer | null = await readFile(file);
            // log("filetext", LogLevel.DEBUG, fileText);
            if (typeof fileText !== "string") {
              throw new Error(`Could not parse file: ${file.name}, typeof file: ${typeof fileText}`);
            }
            const lines = fileText.replace(/\r/g, "").split("\n");
            for (let line of lines) {
              // Ignore commented lines
              line = line.split("#")[0];
              // Check if it's an export variable=value
              // Allow empty string, first character must be a letter per https://stackoverflow.com/questions/2821043/allowed-characters-in-linux-environment-variable-names
              const match: RegExpMatchArray | null = line.match(/(export )?([a-zA-Z_][_a-zA-z0-9]*)="?([^"]*)"?/);
              // log("line and match: ", LogLevel.DEBUG, { line, match });
              if (match) {
                const variableName: string = match[match.length - 2];
                const variableValue: string = match[match.length - 1] || "";
                const newEnvVarState: EnvironmentVariablesState = {
                  name: "" + Date.now() + Math.random(),
                  variableName,
                  variableValue,
                  type: variableName.toLocaleUpperCase().startsWith("PASS") || variableName.toLocaleUpperCase().startsWith("SESSION")
                    ? "password"
                    : "text"
                };
                // log("newEnvVarState", LogLevel.DEBUG, { newEnvVarState, newEnvironmentVariables });
                newEnvironmentVariables.push(newEnvVarState);
              }
            }
            // might have passwords
            if (newEnvironmentVariables.length > 0) {
              log("newEnvironmentVariables", LogLevel.DEBUG, newEnvironmentVariables.map((newEnv) => ({ ...newEnv, variableValue: "hidden" })));
              setFormData(({ environmentVariables, ...prevState }: StartTestState): StartTestState =>
                ({ ...prevState, environmentVariables: [...environmentVariables, ...newEnvironmentVariables] })
              );
            }
          } catch (error) {
            log(`Could not parse file: ${file.name}`, LogLevel.ERROR, error);
            setState({ error: `Could not parse file: ${file.name} - ${formatError(error)}` });
          }
        } else {
          const existingIndex = state.additionalFiles
          .findIndex((additionalFile: File | string) => typeof additionalFile === "string"
            ? additionalFile === file.name
            : additionalFile.name === file.name);
          if (existingIndex >= 0) {
            // We can't have two files with the same name even if their path's are different. They go in the same s3 folder
            // Replace the existing one, but don't worry about redraw
            state.additionalFiles[existingIndex] = file;
          } else {
            // New file
            newAdditionalFiles.push(file);
          }
        }
      }
      // We can't just assign the value in or it won't redraw the UI. You must call setState, but we have to copy in the old values
      if (newAdditionalFiles.length > 0) {
        log("newAdditionalFiles", LogLevel.DEBUG, newAdditionalFiles);
        setFormData(({ additionalFiles, ...prevState }: StartTestState): StartTestState =>
          ({ ...prevState, additionalFiles: [...additionalFiles, ...newAdditionalFiles] }));
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
    } else {
      // additional file
      setFormData((prevState: StartTestState) => {
        const additionalFiles = prevState.additionalFiles
        .filter((additionalFile: File | string) => typeof additionalFile === "string"
          ? additionalFile !== filename
          : additionalFile.name !== filename);
        return { ...prevState, additionalFiles };
      });
    }
  };

  const onChangeHandlerSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (event && event.target && event.target.name && event.target.value && event.target.value.length > 0) {
      setState({ [event.target.name]: event.target.value, error: undefined });
    }
  };

  const onChangeHandlerCheckbox = (event: React.MouseEvent<HTMLInputElement | HTMLLabelElement, MouseEvent>) => {
    log(`${event.currentTarget.id} clicked`, LogLevel.DEBUG);
    const id: string = event.currentTarget.id;
    setFormData(({ daysOfWeek, allDays, ...oldState }: StartTestState) => {
      if (id === ALL_DAYS_NAME) { // All Days button, toggle it
        allDays = !allDays;
        daysOfWeek.forEach((dayOfWeek: DayValue) => dayOfWeek.value = allDays);
      } else if ((oldState as any)[id] !== undefined) { // It's the restartOnFailure or bypass button
        setState({ [id]: !(oldState as any)[id] });
      } else { // It's a day of the week button
        const changedDay: DayValue | undefined = daysOfWeek
          .find((dayOfWeek: DayValue) => dayOfWeek.name === id);
        if (changedDay) {
          changedDay.value = !changedDay.value;
        }
        allDays = daysOfWeek.every((dayOfWeek: DayValue) => dayOfWeek.value);
      }
      return { ...oldState, daysOfWeek, allDays };
    });
  };

  const onAddOrUpdateEnv = (newEnvVar: EnvironmentVariablesUpdate) => {
    log(`onAddOrUpdateEnv ${newEnvVar.name}`, LogLevel.DEBUG, newEnvVar);
    setFormData(({ environmentVariables, ...oldState}: StartTestState) => {
      // Check if it exists and update or add new
      const foundVar: EnvironmentVariablesState | undefined = environmentVariables.find((envVar) => envVar.name === newEnvVar.name);
      if (foundVar) {
        // We don't know which of these was updated
        foundVar.variableName = newEnvVar.variableName !== undefined ? newEnvVar.variableName : foundVar.variableName;
        foundVar.variableValue = newEnvVar.variableValue !== undefined ? newEnvVar.variableValue : foundVar.variableValue;
        foundVar.type = newEnvVar.type !== undefined ? newEnvVar.type : foundVar.type;
      } else {
        // New var
        const newVar: EnvironmentVariablesState = {
          name: newEnvVar.name,
          variableName: newEnvVar.variableName || "",
          variableValue: newEnvVar.variableValue || "",
          type: newEnvVar.type || "text"
        };
        environmentVariables.push(newVar);
      }
      return ({ ...oldState, environmentVariables });
    });
  };

  const onRemoveEnv = (name: string) => {
    log(`onRemoveEnv ${name}`, LogLevel.DEBUG);
    setFormData(({ environmentVariables, ...oldState }: StartTestState) => {
      // Check if it exists and remove it
      // We could find and slice, but lets just filter and remove
      const filtered = environmentVariables
        .filter((envVar: EnvironmentVariablesState) => envVar.name !== name);
      return ({ ...oldState, environmentVariables: filtered });
    });
  };

  const onClickHandlerSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
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
      if (!state.yamlFile || !state.queueName) {
        setState({
          error: "You must provide 1 yaml file and 1 queueName"
        });
        return;
      }
      if (state.scheduleTest && state.scheduleDate.getTime() < Date.now()) {
        setState({
          error: "Scheduled Date must be in the future"
        });
        return;
      }
      if (state.scheduleTest && state.scheduleDate.getTime() > Date.now() + SIX_MONTHS) {
        setState({
          error: "Scheduled Date must be less than 6 months in the future"
        });
        return;
      }
      if (state.scheduleTest && state.recurringTest && state.endDate.getTime() <= state.scheduleDate.getTime()) {
        setState({
          error: "Recurring End Date must be after Schedule Date"
        });
        return;
      }
      if (state.scheduleTest && state.recurringTest && !state.daysOfWeek.some((dayOfWeek: DayValue) => dayOfWeek.value)) {
        setState({
          error: "At least one day of the week must be selected"
        });
        return;
      }
      const formData: FormData = new FormData();
      if (previousTestData?.testId) {
        formData.append("testId", previousTestData.testId);
      }
      // We need to add the old one even if it's a string so we can know whether to use the old value or new value
      formData.append("yamlFile", state.yamlFile);
      formData.append("queueName", state.queueName);
      if (state.scheduleTest) {
        formData.append("scheduleDate", "" + state.scheduleDate.getTime());
        // Check for recurring
        if (state.recurringTest) {
          formData.append("endDate", "" + state.endDate.getTime());
          const daysOfWeek: number[] = [];
          for (let i = 0; i < state.daysOfWeek.length; i++) {
            if (state.daysOfWeek[i].value) {
              daysOfWeek.push(i);
            }
          }
          // Arrays don't work currently with Formidible. Stringify it like the additionalFiles
          formData.append("daysOfWeek", JSON.stringify(daysOfWeek));
        }
      }
      if (state.additionalFiles.length > 0) {
        // Even though the docs say that you can have multiple fields, https://github.com/node-formidable/formidable/pull/340
        // was closed and is not in the IncomingForm we have access to. We have to JSON.stringify it from the client and parse it here
        // The new canary builds of https://github.com/node-formidable/formidable/ support it but they don't have the @types for it yet
        // Store the strings into an array and add them as a single JSON.stringified field
        const additionalFilesStrings: string[] = [];
        for (const additionalFile of state.additionalFiles) {
          // We need to add the old one even if it's a string so we can know whether to use the old value or new value
          if (typeof additionalFile === "string") {
            additionalFilesStrings.push(additionalFile);
          } else {
            formData.append("additionalFiles", additionalFile);
          }
        }
        if (additionalFilesStrings.length > 0) {
          // If there's only one, just stick it on, if more, stringify it
          formData.append("additionalFiles", additionalFilesStrings.length > 1 ? JSON.stringify(additionalFilesStrings) : additionalFilesStrings[0]);
        }
      }
      if (state.environmentVariables && state.environmentVariables.length > 0) {
        const environmentVariables: EnvironmentVariablesFile = {};
        for (const envVarState of state.environmentVariables) {
          // Don't add the old values in. We'll just overwrite the server versions with new ones
          if (envVarState.variableName && envVarState.variableName.length > 0
            && envVarState.variableValue !== PREVIOUS_ENVIRONMENT_VARIABLE_VALUE) {
            environmentVariables[envVarState.variableName] = {
              value: envVarState.variableValue,
              hidden: envVarState.type === "password"
            };
          }
        }
        formData.append("environmentVariables", JSON.stringify(environmentVariables));
        // log("environmentVariables", LogLevel.DEBUG, environmentVariables)
      }
      if (state.restartOnFailure) {
        formData.append("restartOnFailure", "true");
      }
      if (state.bypassParser) {
        formData.append("bypassParser", "true");
      }
      if (state.pewpewVersion) {
        formData.append("version", state.pewpewVersion);
      }
      // log("StartNewTest formData:", LogLevel.DEBUG);
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
      const response: AxiosResponse = state.scheduleTest && editSchedule
        ? await axios.put(formatPageHref(API_SCHEDULE), formData, config)
        : await axios.post(formatPageHref(API_TEST), formData, config);
      // log("StartNewTest post response", LogLevel.DEBUG, response);
      if (!isTestData(response.data)) {
        const errorString = (editSchedule ? API_SCHEDULE : API_TEST) + " did not return a TestData object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const responseData: TestData = response.data;
      log("StartNewTest post response json", LogLevel.DEBUG, responseData);
      if (state.scheduleTest) {
        const calendarUrl = PAGE_CALENDAR + "?defaultDate=" + responseData.startTime;
        await router.push(calendarUrl, formatPageHref(calendarUrl));
      } else {
        const statusUrl = PAGE_TEST_HISTORY + "?testId=" + responseData.testId;
        await router.push(statusUrl, formatPageHref(statusUrl));
      }
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

  const setRecurring = () => {
    setFormData(({ pewpewVersion, ...oldState }: StartTestState) => {
      // We always set recurringTest to true, but if the pewpewVersion is latest we need to change it
      return ({
        ...oldState,
        recurringTest: true,
        pewpewVersion: pewpewVersion === latestPewPewVersion ? maxPewPewVersion : pewpewVersion
      });
    });
  };

  const onYamlExpand = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // const button: HTMLButtonElement = event.target as HTMLButtonElement;
    // Prevent us from clicking the load twice
    if (doubleClickCheck || previousTestData === undefined) {
      return;
    }
    try {
      doubleClickCheck = true;
      event.preventDefault();
      // Get the value before we toggle it so we know
      const yamlFileExpanding = !state.yamlFileExpand;
      setFormData(({ yamlFileExpand, ...oldState }: StartTestState) => ({ ...oldState, yamlFileExpand: !yamlFileExpand, yamlError: undefined, error: undefined }));
      if (yamlFileExpanding && !state.yamlFileContents) {
        setState({
          yamlFileLoading: true
        });
        // Download the yaml file
        const url = formatPageHref(API_YAML_FORMAT(previousTestData.s3Folder, previousTestData.yamlFile));
        log("yaml url: " + url, LogLevel.DEBUG);
        const response: AxiosResponse = await axios.get(url, { responseType: "text" });
        const yamlFileContents: string = response.data;
        log("Get Yaml file response text", LogLevel.DEBUG, yamlFileContents);
        setState({
          yamlFileContents
        });
      }
    } catch (error) {
      log("Error Downloading Yaml file", LogLevel.ERROR, error);
      setState({
        yamlError: formatError(error)
      });
    } finally {
      setState({
        yamlFileLoading: undefined
      });
      doubleClickCheck = false;
    }
  };

  // log("StartTestForm uploadProgress render", LogLevel.INFO, { storybookProps, stateUploadProgress: state.uploadProgress });
  const daysOfWeekButtons: JSX.Element[] = state.daysOfWeek.map((dayOfWeek: DayValue) =>
    <CheckboxButton key={dayOfWeek.name} id={dayOfWeek.name} value={dayOfWeek.value} onClick={onChangeHandlerCheckbox} />);
  daysOfWeekButtons.push(<CheckboxButton key={ALL_DAYS_NAME} id={ALL_DAYS_NAME} value={state.allDays} onClick={onChangeHandlerCheckbox} />);
  return (
    <Column>
      <H1>Run a new test</H1>
      <Row>
        {state.error && <Danger>Error: {state.error}</Danger>}
      </Row>
      <Row>
        <Column>
          <TestQueues name="queueName" {...queueInitialProps} queueName={state.queueName} onChange={onChangeHandlerSelect} />
          <CommonDiv>
            <LabelDiv><label> Restart on Failure (Crash) &nbsp;</label></LabelDiv>
            <ContentDiv><CheckboxButton
              id="restartOnFailure"
              value={state.restartOnFailure}
              text={state.restartOnFailure ? "Y" : "N"}
              onClick={onChangeHandlerCheckbox}
            /></ContentDiv>
          </CommonDiv>
          {(authPermission === undefined || authPermission === AuthPermission.Admin) ? <CommonDiv>
            <LabelDiv><label> Bypass Config Parser &nbsp;</label></LabelDiv>
            <ContentDiv><CheckboxButton
              id="bypassParser"
              value={state.bypassParser}
              text={state.bypassParser ? "Y" : "N"}
              onClick={onChangeHandlerCheckbox}
            /></ContentDiv>
          </CommonDiv> : undefined }
          <PewPewVersions name="pewpewVersion" {...versionInitalProps} pewpewVersion={state.pewpewVersion} onChange={onChangeHandlerSelect} />
          <CommonDiv>
            <label> Run Test
              <input type="radio" checked={!state.scheduleTest} onChange={() => setState({ scheduleTest: false })} />
              Now
              <input type="radio" checked={state.scheduleTest} onChange={() => setState({ scheduleTest: true })} />
              In the future
            </label>
          </CommonDiv>
          {state.scheduleTest && <>
            <CommonDiv>
              {(state.scheduleDate.getTime() - Date.now() > SIX_MONTHS) && <Warning>Warning: Files will be deleted from S3 after 6 months</Warning>}
            </CommonDiv>
            <CommonDiv>
              <LabelDiv>
                <label> Run Date </label>
              </LabelDiv>
              <ContentDiv><DatePicker
                selected={state.scheduleDate}
                onChange={(scheduleDate: Date) => setState({ scheduleDate })}
                showTimeSelect
                timeFormat="HH:mm"
                timeIntervals={15}
                timeCaption="time"
                dateFormat="MMMM d, yyyy h:mm aa"
              /></ContentDiv>
            </CommonDiv>
            <CommonDiv>
              <label> Recurring
                <input type="radio" checked={state.recurringTest} onChange={() => setRecurring()} />
                Yes
                <input type="radio" checked={!state.recurringTest} onChange={() => setState({ recurringTest: false })} />
                No
              </label>
            </CommonDiv>
            {state.recurringTest && <>
              <CommonDiv>
                {(state.endDate.getTime() - Date.now() > SIX_MONTHS) && <Warning>Warning: Files will be deleted from S3 after 6 months</Warning>}
              </CommonDiv>
              <CommonDiv>
                <LabelDiv><label> End Date </label></LabelDiv>
                <ContentDiv><DatePicker
                  selected={state.endDate}
                  onChange={(endDate: Date) => setState({ endDate })}
                  showTimeSelect
                  timeFormat="HH:mm"
                  timeIntervals={15}
                  timeCaption="time"
                  dateFormat="MMMM d, yyyy h:mm aa"
                /></ContentDiv>
              </CommonDiv>
              <CommonDiv>
                <LabelDiv><label> Days Of Week </label></LabelDiv>
                <ContentDiv><Row>{daysOfWeekButtons}</Row></ContentDiv>
              </CommonDiv>
            </>}
          </>}
          <FilesList files={[...(state.yamlFile ? [state.yamlFile] : []), ...state.additionalFiles]} onClick={onRemoveFile} />
          <DropFile onDropFile={onDropFile} />
          <ButtonDiv>
            {readOnly ? notAuthorizedMessage
              : state.uploading || (storybookProps as StartTestPropsStorybook).uploading // For storybook we need to override if either are true
              ? <Column>
                  <Line
                    percent={(storybookProps as StartTestPropsStorybook).uploadProgress || state.uploadProgress}
                    strokeWidth={10} // left side (finished) of the line. "percent"
                    strokeColor={"#5cf52d"}
                    trailWidth={6} // Right side (unfinished) of the line
                    strokeLinecap={"round"}
                  />
                  <Info>Files Uploading: {(storybookProps as StartTestPropsStorybook).uploadProgress || state.uploadProgress}%</Info>
                </Column>
              : <UploadTestButton type="submit" onClick={onClickHandlerSubmit} disabled={readOnly} >
                  Upload Files and {state.scheduleTest ? (editSchedule ? "Update Scheduled" : "Schedule") : "Run"} Test
                </UploadTestButton>
            }
          </ButtonDiv>
        </Column>
        <Column>
          <EnvironmentVariablesList environmentVariables={state.environmentVariables} onAddOrUpdate={onAddOrUpdateEnv} onRemove={onRemoveEnv} />
        </Column>
        {state.testId && <Column>
          <TestInfo testData={ {
            testId: state.testId,
            s3Folder: state.s3Folder || "",
            startTime: state.startTime!,
            endTime: state.endTime,
            resultsFileLocation: state.resultsFileLocation,
            status: state.testStatus,
            errors: previousTestData?.errors,
            hostname: previousTestData?.hostname,
            instanceId: previousTestData?.instanceId,
            ipAddress: previousTestData?.ipAddress,
            lastChecked: previousTestData?.lastChecked,
            lastUpdated: previousTestData?.lastUpdated
          } } />
          <LinkButton theme={{ buttonFontSize: "1.25rem", buttonWidth: "200px", buttonHeight: "50px" , buttonMargin: "10px"}}
                      href={PAGE_TEST_HISTORY + "?testId=" + state.testId}>Test Status</LinkButton>
        </Column>}
      </Row>
      {previousTestData && <Row>
        <Column>
          <Row style={{ textAlign: "left", justifyContent: "left" }}>
            <H3>
              View Prior Yaml File&nbsp;
              <button onClick={onYamlExpand}><H3>{state.yamlFileExpand ? <>&uArr;</> : <>&dArr;</>}</H3></button>
            </H3>
          </Row>
          {state.yamlFileExpand &&
            <Row><YamlViewer
            yamlFilename={previousTestData.yamlFile}
            yamlContents={state.yamlFileContents}
            loading={state.yamlFileLoading}
            error={state.yamlError}
            /></Row>
          }
        </Column>
      </Row>}
    </Column>
  );
};

export default StartTestForm;
