import { util } from "@fs/ppaas-common";

// It's application-system-service-last-3-octets
const PREFIX: string = `${util.APPLICATION_NAME.toLowerCase()}-${util.SYSTEM_NAME.toLowerCase()}-app-`;

export function getHostname (): string {
  const ipAddress = util.getLocalIpAddress();
  const split: string[] = ipAddress.split(".");
  if (split.length !== 4) {
    throw new Error("Could not get last 3 octets of IP address from: " + ipAddress);
  }
  const hostname = PREFIX + split.slice(1).join("-");
  return hostname;
}
