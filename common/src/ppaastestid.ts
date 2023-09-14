import path from "path";

export interface MakeTestIdOptions {
  profile?: string;
  dateString?: string;
}

export class PpaasTestId {
  public readonly date: Date;
  public readonly dateString: string;
  public readonly yamlFile: string;
  public readonly testId: string;
  public readonly s3Folder: string;

  protected constructor (yamlFile: string, dateString: string) {
    if (!yamlFile || yamlFile.length === 0) {
      throw new Error("Invalid Yamlfile: " + yamlFile);
    }
    if (!dateString || !/^\d{8}T\d{9}$/.test(dateString)) {
      throw new Error("Invalid dateString does not match expected: " + dateString);
    }
    // 20190101T000000000 -> 2019-01-01T00:00:00.000Z
    const dateIsoString = `${dateString.slice(0,4)}-${dateString.slice(4,6)}-${dateString.slice(6,8)}T`
      + `${dateString.slice(9,11)}:${dateString.slice(11,13)}:${dateString.slice(13,15)}.${dateString.slice(15,18)}Z`;
    const date = new Date(dateIsoString);
    if (date.toISOString() !== dateIsoString) {
      throw new Error(`Could not parse ${dateString} to a date ISO string (${dateIsoString}) that would parse: ${date.toISOString()}`);
    }
    this.date = date;
    this.dateString = dateString;
    this.yamlFile = yamlFile;
    this.testId = yamlFile + dateString;
    this.s3Folder = yamlFile + "/" + dateString;
  }

  public static getDateString (date: Date = new Date()) {
    // eslint-disable-next-line no-useless-escape
    return date.toISOString().replace(/[-:\.Z]/g, "");
  }

  public static getFromTestId (testId: string): PpaasTestId {
    const match: RegExpMatchArray | null = testId.match(/^(.+)(\d{8}T\d{9})$/);
    if (match && match.length === 3) {
      const yamlname: string = match[1];
      const dateString = match[2];
      const newTestId: PpaasTestId = new PpaasTestId(yamlname, dateString);
      return newTestId;
    } else {
      throw new Error(`Could not parse ${testId} into a TestId`);
    }
  }

  public static getFromS3Folder (s3Folder: string): PpaasTestId {
    const match: RegExpMatchArray | null = s3Folder.match(/^(.+)\/(\d{8}T\d{9})$/);
    if (match && match.length === 3) {
      const yamlname: string = match[1];
      const dateString = match[2];
      const newTestId: PpaasTestId = new PpaasTestId(yamlname, dateString);
      return newTestId;
    } else {
      throw new Error(`Could not parse ${s3Folder} into a TestId`);
    }
  }

  public static makeTestId (yamlFile: string, options?: MakeTestIdOptions): PpaasTestId {
    const { profile, dateString } = options || {};
    // Sanitize the yamlFile name and make it lowercase
    const yamlname: string = (path.basename(yamlFile, path.extname(yamlFile)).toLocaleLowerCase()
    + (profile || "").toLocaleLowerCase())
    .replace(/[^a-z0-9]/g, "");
    if (yamlname === "pewpew") {
      throw new Error("Yaml File cannot be named PewPew");
    }
    const newTestId: PpaasTestId = new PpaasTestId(yamlname, dateString || this.getDateString());
    return newTestId;
  }
}

export default PpaasTestId;
