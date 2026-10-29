"use client";

import { useSyncExternalStore } from "react";

const noChange = () => () => undefined;
const unknownOnServer = () => undefined;

/**
 * A value only the browser can tell, read once it hydrates and never
 * watched for changes: undefined during server rendering and hydration.
 */
export const useBrowserValue = <T>(read: () => T): T | undefined =>
  useSyncExternalStore(noChange, read, unknownOnServer);
