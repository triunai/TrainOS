// jest-dom ships its matcher types as `declare module "vitest"`, which merged
// cleanly while vitest owned the `Assertion` interface. Vitest 3 re-exports
// `Assertion` from `@vitest/expect` instead, and an augmentation cannot merge
// into a re-exported interface: it silently declares a second, unrelated one,
// so every `toBeInTheDocument` lost its type while still working at runtime.
//
// Augment the interface where it is actually declared. Vitest itself extends
// `@vitest/expect` the same way for its snapshot matchers. Delete this file
// once jest-dom targets `@vitest/expect` directly.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "@vitest/expect" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
