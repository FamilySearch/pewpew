import { LogLevel, log } from "@fs/ppaas-common";
import { API_PEWPEW } from "../../types";
import { VersionInitalProps } from ".";
import { getPewPewVersionInFile, getPewPewVersionsInS3 } from "../../pages/api/util/pewpew";
import { latestPewPewVersion } from "../../pages/api/util/clientutil";

export const getServerSideProps = async (): Promise<VersionInitalProps> => {
  try {
    const pewpewVersions: string[] = await getPewPewVersionsInS3();
    const latestPewpewInFile: string = getPewPewVersionInFile();
    log("getPewPewVersionsInS3", LogLevel.DEBUG, pewpewVersions);
    // Grab the response
    // console.log("PewPewVersions pewpewVersions: " + JSON.stringify(pewpewVersions), pewpewVersions);
    if (pewpewVersions.length === 0) {
      throw new Error(`No versions returned by ${API_PEWPEW}: ${JSON.stringify(pewpewVersions)}`);
    }
    return {
      pewpewVersion: latestPewPewVersion, // We always want to default to latest
      pewpewVersions,
      latestInFile: latestPewpewInFile,
      loading: false,
      error: false
    };
  } catch (error) {
    // We need this error on the client and the server
    log("Error loading pewpew versions", LogLevel.ERROR, error);
    return {
      pewpewVersion: "",
      pewpewVersions: [],
      latestInFile: "",
      loading: false,
      error: true
    };
  }
};

export default getServerSideProps;
