"use client";

import { createContext, useContext } from "react";

/** True inside the blue RecordHeader card: kit controls restyle for the accent ground. */
const OnAccentContext = createContext(false);
export const OnAccentProvider = OnAccentContext.Provider;
export function useOnAccent(): boolean {
  return useContext(OnAccentContext);
}
