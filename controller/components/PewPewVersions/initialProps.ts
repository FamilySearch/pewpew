import { LogLevel, log } from "@fs/ppaas-common";
import { getCurrentPewPewLatestVersion, getPewPewVersionsInS3 } from "../../pages/api/util/pewpew";
import { API_PEWPEW } from "../../types";
import { VersionInitalProps } from ".";
import { latestPewPewVersion } from "../../pages/api/util/clientutil";

export const getServerSideProps = async (): Promise<VersionInitalProps> => {
  try {
    const pewpewVersions: string[] = await getPewPewVersionsInS3();
    const currentPewPewLatestVersion: string | undefined = await getCurrentPewPewLatestVersion();
    log("getPewPewVersionsInS3", LogLevel.DEBUG, pewpewVersions);
    // Grab the response
    // console.log("PewPewVersions pewpewVersions: " + JSON.stringify(pewpewVersions), pewpewVersions);
    if (pewpewVersions.length === 0) {
      throw new Error(`No versions returned by ${API_PEWPEW}: ${JSON.stringify(pewpewVersions)}`);
    }
    return {
      pewpewVersion: latestPewPewVersion, // We always want to default to latest
      pewpewVersions,
      latestPewPewVersion: currentPewPewLatestVersion || "unknown",
      loading: false,
      error: false
    };
  } catch (error) {
    // We need this error on the client and the server
    log("Error loading pewpew versions", LogLevel.WARN, error);
    return {
      pewpewVersion: "",
      pewpewVersions: [],
      latestPewPewVersion: "unknown",
      loading: false,
      error: true
    };
  }
};

export default getServerSideProps;
