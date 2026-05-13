vi.mock("@fs/ppaas-common", () => ({
  LogLevel: { DEBUG: "debug", WARN: "warn" },
  log: vi.fn()
}));
vi.mock("../../src/pewpew", () => ({
  getCurrentPewPewLatestVersion: vi.fn(),
  getPewPewVersionsInS3: vi.fn()
}));

import { getCurrentPewPewLatestVersion, getPewPewVersionsInS3 } from "../../src/pewpew";
import { getServerSideProps } from "./initialProps";
import { latestPewPewVersion } from "../../src/clientutil";

describe("PewPewVersions getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success path", () => {
    it("returns pewpewVersions and latestPewPewVersion on success", async () => {
      vi.mocked(getPewPewVersionsInS3).mockResolvedValue(["latest", "0.5.8"]);
      vi.mocked(getCurrentPewPewLatestVersion).mockResolvedValue("0.5.8");
      const result = await getServerSideProps();
      expect(result.pewpewVersions).toEqual(["latest", "0.5.8"]);
      expect(result.latestPewPewVersion).toBe("0.5.8");
      expect(result.pewpewVersion).toBe(latestPewPewVersion);
      expect(result.loading).toBe(false);
      expect(result.error).toBe(false);
    });

    it("defaults latestPewPewVersion to 'unknown' when getCurrentPewPewLatestVersion returns undefined", async () => {
      vi.mocked(getPewPewVersionsInS3).mockResolvedValue(["0.5.8"]);
      vi.mocked(getCurrentPewPewLatestVersion).mockResolvedValue(undefined);
      const result = await getServerSideProps();
      expect(result.latestPewPewVersion).toBe("unknown");
      expect(result.error).toBe(false);
    });
  });

  describe("error path", () => {
    it("returns error state when no versions are returned", async () => {
      vi.mocked(getPewPewVersionsInS3).mockResolvedValue([]);
      vi.mocked(getCurrentPewPewLatestVersion).mockResolvedValue("0.5.8");
      const result = await getServerSideProps();
      expect(result.error).toBe(true);
      expect(result.pewpewVersions).toEqual([]);
      expect(result.pewpewVersion).toBe("");
      expect(result.latestPewPewVersion).toBe("unknown");
      expect(result.loading).toBe(false);
    });

    it("returns error state when getPewPewVersionsInS3 throws", async () => {
      vi.mocked(getPewPewVersionsInS3).mockRejectedValue(new Error("S3 error"));
      const result = await getServerSideProps();
      expect(result.error).toBe(true);
      expect(result.pewpewVersions).toEqual([]);
      expect(result.latestPewPewVersion).toBe("unknown");
      expect(result.loading).toBe(false);
    });
  });
});
