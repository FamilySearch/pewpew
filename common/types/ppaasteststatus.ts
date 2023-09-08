export enum TestStatus {
  Unknown = "Unknown",
  Created = "Created",
  Running = "Running",
  Failed = "Failed",
  Finished = "Finished",
  Scheduled = "Scheduled",
  Checking = "Checking..."
}

// Any new fields added here must be added to getTestStatusMessage and readStatus
export interface TestStatusMessage {
  instanceId?: string;
  hostname?: string;
  ipAddress?: string;
  startTime: number;
  endTime: number;
  resultsFilename: string[];
  status: TestStatus;
  errors?: string[];
  // These won't be there historically, but new ones should have it
  version?: string;
  queueName?: string;
  userId?: string;
}
