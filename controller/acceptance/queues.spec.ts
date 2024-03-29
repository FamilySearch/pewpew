import {
  API_QUEUES,
  API_QUEUE_NAMES
} from "../types";
import { AgentQueueDescription, LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosResponse as Response } from "axios";
import { expect } from "chai";

const fetch = _axios.get;

// Beanstalk <SYSTEM_NAME>_<SERVICE_NAME>_URL
const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8081"}`);

let sharedQueueNames: string[] | undefined;

export async function getQueueNames (): Promise<string[]> {
  if (sharedQueueNames) { return sharedQueueNames; }
  await initSharedQueueNames();
  return sharedQueueNames!;
}

async function initSharedQueueNames (): Promise<void> {
  if (sharedQueueNames) { return; }
  const url: string = integrationUrl + API_QUEUE_NAMES;
  log("smoke tests url=" + url, LogLevel.DEBUG);
  try {
    const res: Response = await fetch(url);
    const body = res.data;
    expect(res.status, JSON.stringify(body)).to.equal(200);
    log("queuenames: " + body, LogLevel.DEBUG, body);
    expect(body).to.not.equal(undefined);
    expect(body.queueNames).to.not.equal(undefined);
    expect(Array.isArray(body.queueNames)).to.equal(true);
    expect(body.queueNames.length).to.be.greaterThan(0);
    expect(typeof body.queueNames[0]).to.equal("string");
    sharedQueueNames = body.queueNames as string[];
  } catch (error) {
    log("Could not load queuenames", LogLevel.ERROR, error);
    throw error;
  }
}

describe("Queues API Integration", () => {
  let url: string;

  before(() => {
    url = integrationUrl + API_QUEUE_NAMES;
    log("smoke tests url=" + url, LogLevel.DEBUG);
    return getQueueNames();
  });

  describe("GET /queuenames", () => {
    it("GET /queuenames should respond 200 OK", (done: Mocha.Done) => {
      fetch(integrationUrl + API_QUEUE_NAMES).then((res: Response) => {
        const body = res.data;
        expect(res.status, JSON.stringify(body)).to.equal(200);
        log("queuenames: " + body, LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.queueNames).to.not.equal(undefined);
        expect(Array.isArray(body.queueNames)).to.equal(true);
        expect(body.queueNames.length).to.be.greaterThan(0);
        sharedQueueNames = body.queueNames;
        done();
      }).catch((error) => done(error));
    });
  });

  describe("GET /queues", () => {
    it("GET /queues should respond 200 OK", (done: Mocha.Done) => {
      fetch(integrationUrl + API_QUEUES).then((res: Response) => {
        expect(res.status).to.equal(200);
        const queues = res.data;
        log("queues: " + queues, LogLevel.DEBUG, queues);
        expect(queues, "queues").to.not.equal(undefined);
        const entries = Object.entries(queues);
        expect(entries.length, "entries.length").to.be.greaterThan(0);
        if (sharedQueueNames && sharedQueueNames.length > 0) {
          expect(Object.keys(queues), "keys").to.include(sharedQueueNames[0]);
        }
        for (const [queueName, queueValue] of entries) {
          expect(typeof queueValue, `typeof queues[${queueName}]`).to.equal("string");
        }
        const queuesType: AgentQueueDescription = queues;
        log("queuesType", LogLevel.DEBUG, queuesType);
        done();
      }).catch((error) => done(error));
    });
  });
});
