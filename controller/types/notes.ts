export interface NotesMetadata {
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  testOverview?: TestOverviewData;
  tags?: string[];
}

export interface TestOverviewData {
  testName: string;
  endpoints: string[];
  loadPatterns: LoadPatternSummary[];
  duration?: string;
  peakLoad?: string;
  providers?: string[];
  testStatus?: string;
  startTime?: number;
  endTime?: number;
  resultsFileLocation?: string[];
  pewpewVersion?: string;
}

export interface LoadPatternSummary {
  name?: string;
  type: string;
  from?: string;
  to?: string;
  duration?: string;
}

export interface StructuredNotesUpdate {
  section: "objectives" | "environment" | "findings" | "conclusion";
  content: string;
  append?: boolean;
}

export interface NotesExportOptions {
  format: "confluence" | "markdown";
  includeMetadata?: boolean;
}

export interface MonitoringConfig {
  platform: string;
  dashboardBaseUrl?: string;
  searchBaseUrl?: string;
  label: string;
}

export interface NotesSearchResult {
  yamlFile: string;
  dateString: string;
  s3Folder: string;
  metadata?: NotesMetadata;
}
