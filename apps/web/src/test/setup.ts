// Global test setup. jest-dom matchers (toBeInTheDocument, etc.) plus a
// cleanup after every test so rendered trees do not leak between cases.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// next-themes reads window.matchMedia at mount to resolve the "system" theme.
// jsdom does not implement it, so the stub has to live in global setup rather
// than a per-test beforeAll.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
