export type AgentQueueDescription = Record<string, string>;
export type EnvironmentVariables = Record<string, string>;

// Any new channges here must also update the PPaasTestMessage.getTestMessage function
export interface TestMessage {
  /** The testId for the new test */
  testId: string;
  s3Folder: string;
  yamlFile: string;
  additionalFiles?: string[];
  testRunTimeMn?: number;
  bucketSizeMs?: number;
  version: string;
  envVariables: EnvironmentVariables;
  // Needed for the Test Status
  userId?: string;
  restartOnFailure: boolean;
  bypassParser?: boolean;
}
