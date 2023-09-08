export enum MessageType {
  StopTest = "StopTest",
  KillTest = "KillTest",
  TestStatus = "TestStatus",
  TestError = "TestError",
  TestFailed = "TestFailed",
  TestFinished = "TestFinished",
  UnitTest = "UnitTest",
  UpdateYaml = "UpdateYaml"
}

// Due to issues with visibility 0 and multiple lockouts, The communications queue is only for talking to the controller
export interface CommunicationsMessage {
  testId: string;
  messageType: MessageType;
  messageData: any;
}
