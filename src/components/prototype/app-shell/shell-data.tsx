"use client";

import { createContext, useContext } from "react";
import type { ShellData } from "./model";

const ShellDataContext = createContext<ShellData | null>(null);

export const ShellDataProvider = ShellDataContext.Provider;

export function useShellData() {
  const data = useContext(ShellDataContext);
  if (!data) throw new Error("useShellData needs a ShellDataProvider.");
  return data;
}
