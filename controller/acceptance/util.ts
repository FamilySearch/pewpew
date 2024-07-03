// Shared functions for Acceptance Tests

export const ACCEPTANCE_AWS_PERMISSIONS: boolean = process.env.ACCEPTANCE_AWS_PERMISSIONS?.toLowerCase() === "true";

// Beanstalk <SYSTEM_NAME>_<SERVICE_NAME>_URL
export const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8081"}`);
