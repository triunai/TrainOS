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

// Radix positions floating surfaces (popovers, tooltips, selects, dropdowns)
// through floating-ui, which observes the trigger with a ResizeObserver. jsdom
// implements neither, and several Radix code paths call the constructor
// directly, so the stub exists to keep those paths from throwing.
//
// It is deliberately INERT. A stub that delivers an entry on observe was tried
// and measured: it made a popover-heavy file 2.4x SLOWER (22s -> 54s), because
// each delivered entry triggers another position pass. Do not "improve" it into
// firing without measuring first.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

window.ResizeObserver = ResizeObserverStub as unknown as typeof window.ResizeObserver;
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;

// Radix's popper also reads DOMRect. jsdom returns an all-zero rect and does
// not implement these two at all; several Radix code paths call them directly.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
