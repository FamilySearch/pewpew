vi.mock("@fs/ppaas-common", () => ({
  LogLevel: { ERROR: "error" },
  PpaasTestMessage: { getAvailableQueueMap: vi.fn() },
  log: vi.fn()
}));

import { PpaasTestMessage } from "@fs/ppaas-common";
import { getServerSideProps } from "./initialProps";

describe("TestQueues getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success path", () => {
    it("returns the first queue name when queues exist", () => {
      const queues = { "queue-a": "Queue A", "queue-b": "Queue B" };
      vi.mocked(PpaasTestMessage.getAvailableQueueMap).mockReturnValue(queues);
      const result = getServerSideProps();
      expect(result.queueName).toBe("queue-a");
      expect(result.testQueues).toEqual(queues);
      expect(result.loading).toBe(false);
      expect(result.error).toBe(false);
    });

    it("returns the queue name when only one queue exists", () => {
      const queues = { "only-queue": "Only Queue" };
      vi.mocked(PpaasTestMessage.getAvailableQueueMap).mockReturnValue(queues);
      const result = getServerSideProps();
      expect(result.queueName).toBe("only-queue");
      expect(result.error).toBe(false);
    });
  });

  describe("error path", () => {
    it("returns error state when no queues are returned", () => {
      vi.mocked(PpaasTestMessage.getAvailableQueueMap).mockReturnValue({});
      const result = getServerSideProps();
      expect(result.error).toBe(true);
      expect(result.queueName).toBe("");
      expect(result.testQueues).toEqual({});
      expect(result.loading).toBe(false);
    });

    it("returns error state when getAvailableQueueMap throws", () => {
      vi.mocked(PpaasTestMessage.getAvailableQueueMap).mockImplementation(() => {
        throw new Error("AWS connection error");
      });
      const result = getServerSideProps();
      expect(result.error).toBe(true);
      expect(result.queueName).toBe("");
      expect(result.loading).toBe(false);
    });
  });
});
