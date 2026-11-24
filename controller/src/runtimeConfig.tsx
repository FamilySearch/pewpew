import React, { createContext, useContext } from "react";

export interface RuntimeConfig {
  HIDE_ENVIRONMENT: string;
}

export const defaultRuntimeConfig: RuntimeConfig = {
  HIDE_ENVIRONMENT: ""
};

// Module-level singleton for non-React utility code (e.g. future additions to
// clientutil or authclient that need runtime values). Populated by
// RuntimeConfigProvider on every render, so utility functions called after
// initial render always receive the current runtime values.
// Server-side code reads process.env directly and never relies on this singleton.
let _config: RuntimeConfig = defaultRuntimeConfig;

export function setRuntimeConfig (config: RuntimeConfig): void {
  _config = config;
}

export function getRuntimeConfig (): RuntimeConfig {
  return _config;
}

const RuntimeConfigContext = createContext<RuntimeConfig>(defaultRuntimeConfig);

export function useRuntimeConfig (): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}

export function RuntimeConfigProvider ({
  config,
  children
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
}) {
  // Keep the singleton in sync so non-React utilities get the runtime values
  // without needing to be refactored into hooks.
  setRuntimeConfig(config);
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}
