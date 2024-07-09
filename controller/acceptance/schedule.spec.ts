import {
  API_SCHEDULE,
  API_SEARCH,
  FormDataPost,
  TestData,
  TestManagerError
} from "../types";
import { BASIC_FILEPATH, getScheduledTestData, unsetScheduledTestData } from "./test.spec";
import { LogLevel, TestStatus, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { EventInput } from "@fullcalendar/core";
import { expect } from "chai";
import { getQueueNames } from "./queues.spec";
import { integrationUrl } from "./util";
import path from "path";

async function fetch (
  url: string,
  config?: AxiosRequestConfig
): Promise<Response> {
  try {
    const response: Response = await _axios({
      method: config?.method || "get",
      url,
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // Resolve only if the status code is less than 500
      ...(config || {})
    });
    return response;
  } catch (error) {
    throw error;
  }
}

describe("Schedule API Integration", () => {
  let url: string;
  let scheduledTestData: TestData | undefined;
  let recurringTestData: TestData | undefined;
  let deletedTestData: TestData | undefined;

  before(() => {
    url = integrationUrl + API_SCHEDULE;
    log("smoke tests url=" + url, LogLevel.DEBUG);
  });

  after(async () => {
    try {
      expect(scheduledTestData, "scheduledTestData").to.not.equal(undefined);
      expect(recurringTestData, "recurringTestData").to.not.equal(undefined);
      expect(deletedTestData, "deletedTestData").to.not.equal(undefined);
      const res = await fetch(url);
      log("GET /schedule response", LogLevel.DEBUG, res);
      // const bodyText = await res.text();
      expect(res.status, JSON.stringify(res.data)).to.equal(200);
      log("schedule: " + res.data, LogLevel.DEBUG, res.data);
      expect(res.data, "data").to.not.equal(undefined);
      const schedule: EventInput[] = res.data;
      expect(schedule, "schedule").to.not.equal(undefined);
      expect(Array.isArray(schedule), "isArray(schedule)").to.equal(true);
      expect(schedule.length).to.be.greaterThan(0);
      const scheduledEvent: EventInput | undefined = schedule.find((value: EventInput) => value.id === scheduledTestData!.testId);
      const recurringEvent: EventInput | undefined = schedule.find((value: EventInput) => value.id === recurringTestData!.testId);
      const deletedEvent: EventInput | undefined = schedule.find((value: EventInput) => value.id === deletedTestData!.testId);
      expect(scheduledEvent, "scheduledEvent").to.not.equal(undefined);
      expect(recurringEvent, "recurringEvent").to.not.equal(undefined);
      expect(deletedEvent, "deletedEvent").to.equal(undefined);
      expect(scheduledEvent!.start, "scheduledEvent!.start").to.equal(scheduledTestData!.startTime);
      expect(recurringEvent!.startRecur, "recurringEvent!.startRecur").to.equal(recurringTestData!.startTime);
    } catch (error) {
      log("Schedule API Integration after error", LogLevel.ERROR, error);
      throw error;
    }
  });

  describe("GET /schedule", () => {
    before(async () => scheduledTestData = await getScheduledTestData());

    it("GET /schedule should respond 200 OK", (done: Mocha.Done) => {
      expect(scheduledTestData).to.not.equal(undefined);
      fetch(url).then((res) => {
        log("GET /schedule response", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        const body = res.data;
          log("schedule: " + body, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          const schedule: EventInput[] = body;
          expect(schedule).to.not.equal(undefined);
          expect(Array.isArray(schedule)).to.equal(true);
          expect(schedule.length).to.be.greaterThan(0);
          expect(schedule.some((value: EventInput) => value.id === scheduledTestData!.testId)).to.equal(true);
          done();
      }).catch((error) => done(error));
    });
  });

  describe("PUT /schedule", () => {
    let queueName: string;
    before(async () => {
      try {
        const queueNames: string[] = await getQueueNames();
        expect(queueNames).to.not.equal(undefined);
        expect(queueNames.length).to.be.greaterThan(0);
        queueName = queueNames[0];
        scheduledTestData = await getScheduledTestData();
        unsetScheduledTestData();
        recurringTestData = await getScheduledTestData();
        unsetScheduledTestData();
      } catch (error) {
        log("PUT /schedule before error", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("PUT /schedule new date should respond 200 OK", (done: Mocha.Done) => {
      expect(scheduledTestData, "scheduledTestData").to.not.equal(undefined);
      const scheduleDate: number = Date.now() + 600000;
      const formData: FormDataPost = {
        yamlFile: path.basename(BASIC_FILEPATH),
        testId: scheduledTestData!.testId,
        queueName,
        scheduleDate
      };
      log("formData schedule new date", LogLevel.DEBUG, formData);
      fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        data: formData
      }).then((res: Response) => {
        log("PUT /schedule new date response", LogLevel.DEBUG, res);
        const body = res.data;
        expect(res.status, JSON.stringify(body)).to.equal(200);
        log("schedule: " + body, LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        const testData: TestData = body;
        expect(testData, "testData").to.not.equal(undefined);
        expect(testData.testId, "testId").to.equal(scheduledTestData!.testId);
        expect(testData.s3Folder, "s3Folder").to.equal(scheduledTestData!.s3Folder);
        expect(testData.status, "status").to.equal(TestStatus.Scheduled);
        expect(testData.startTime, "startTime").to.equal(scheduleDate);
        scheduledTestData = testData;
        done();
      }).catch((error) => done(error));
    });

    it("PUT /schedule recurring should respond 200 OK", (done: Mocha.Done) => {
      expect(recurringTestData, "recurringTestData").to.not.equal(undefined);
      const scheduleDate: number = Date.now() + 600000;
      const endDate: number = scheduleDate + (7 * 24 * 60 * 60000);
      const formData: FormDataPost = {
        yamlFile: path.basename(BASIC_FILEPATH),
        testId: recurringTestData!.testId,
        queueName,
        scheduleDate,
        endDate,
        daysOfWeek: JSON.stringify([1,3,5])
      };
      log("formData schedule recurring", LogLevel.DEBUG, formData);
      fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        data: formData
      }).then((res: Response) => {
        log("PUT /schedule recurring response", LogLevel.DEBUG, res);
        const body = res.data;
        expect(res.status, JSON.stringify(body)).to.equal(200);
        log("schedule: " + body, LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        const testData: TestData = body;
        expect(testData, "testData").to.not.equal(undefined);
        expect(testData.testId, "testId").to.equal(recurringTestData!.testId);
        expect(testData.s3Folder, "s3Folder").to.equal(recurringTestData!.s3Folder);
        expect(testData.status, "status").to.equal(TestStatus.Scheduled);
        expect(testData.startTime, "startTime").to.equal(scheduleDate);
        recurringTestData = testData;
        done();
      }).catch((error) => done(error));
    });
  });

  describe("DELETE /schedule", () => {
    before(async () => {
      deletedTestData = await getScheduledTestData();
      unsetScheduledTestData();
    });

    it("DELETE /schedule?testId=validTestId should respond 200 OK", (done: Mocha.Done) => {
      expect(deletedTestData).to.not.equal(undefined);
      const scheduledTestId: string = deletedTestData!.testId;
      const s3Folder = deletedTestData!.s3Folder;
      log("scheduled testId: " + scheduledTestId, LogLevel.DEBUG, scheduledTestId);
      fetch(url + "?testId=" + scheduledTestId, { method: "DELETE" }).then((res) => {
        log("DELETE /schedule response", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        const body = res.data;
        log("delete: " + body, LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        const result: TestManagerError = body;
        expect(result.message, "result.message").to.not.equal(undefined);
        expect(typeof result.message, "typeof result.message").to.equal("string");
        expect(result.message, "result.message").to.include(scheduledTestId);
        // TODO: Verify that the s3 files are gone
        log("search deleted s3Folder: " + s3Folder, LogLevel.DEBUG, s3Folder);
        fetch(integrationUrl + API_SEARCH + "?s3Folder=" + s3Folder).then((searchResponse: Response) => {
          log ("search deleted response", LogLevel.DEBUG, searchResponse);
          expect(searchResponse.status, JSON.stringify(searchResponse.data)).to.equal(204);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("DELETE /schedule?testId=invalid should respond 404 Not Found", (done: Mocha.Done) => {
      fetch(url + "?testId=invalid", { method: "DELETE" }).then((res) => {
        expect(res.status).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    it("DELETE /schedule no testId should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url, { method: "DELETE" }).then((res) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });
  });
});
