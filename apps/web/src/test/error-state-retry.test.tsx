import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState } from "@/shared/components/states/ErrorState";
import { toApiError, transportError } from "@/shared/api";
import { ContractError } from "@trainos/fixtures";

/**
 * W-03 · R2's split, and the control that keeps it from being bypassed.
 *
 * `ErrorState` implements R2 correctly: a domain refusal is a FACT about the
 * request, so it gets no "Try again". But the check reads the `error` prop —
 *
 *   const refused = error !== undefined && isDomainError(error);
 *
 * — so a caller that passes only `description` makes `refused` false and
 * renders a retry button over a policy decision, which is the precise failure
 * R2 exists to prevent. Fourteen call sites did exactly that, each passing
 * `description={errorMessageOf(...)}` from a per-feature helper that flattened
 * a dropped connection and a FLOOR_PRICE_BREACH into the same bare string
 * before the component could tell them apart.
 *
 * Two tests, because neither is sufficient alone. The first is the behaviour:
 * given the error, the button is withheld. The second is the reach: no screen
 * in the app asks for a retry without handing over the error that decides
 * whether it may have one.
 *
 * The scan's limit, stated plainly: it reads the prop's PRESENCE, not its
 * value. A site passing `error={maybeUndefined}` satisfies it, which is
 * deliberate — the alternative is a type-checked union no call site could
 * express — and harmless, since an absent error means there is no refusal to
 * protect the reader from.
 */

const SRC = path.resolve(__dirname, "..");

describe("ErrorState · a refusal is never offered a retry", () => {
  it("withholds the retry when the failure is a domain refusal", () => {
    const refusal = toApiError(
      new ContractError("FLOOR_PRICE_BREACH", "That price is below the binding floor."),
    );

    render(<ErrorState title="Nope" error={refusal} onRetry={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("That price is below the binding floor.")).toBeTruthy();
    expect(screen.getByText("FLOOR_PRICE_BREACH")).toBeTruthy();
  });

  it("offers it when the failure is transport, which a retry can actually fix", () => {
    render(
      <ErrorState
        title="Nope"
        error={transportError("NETWORK", "socket hang up")}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("renders the retry when given only a description — the hole the scan closes", () => {
    /* Not a bug in `ErrorState`: with no error it cannot know, and guessing
       "refused" would hide the retry on every transport failure instead. The
       defect is at the CALL SITE, which is why the control below is a scan of
       call sites rather than an assertion about this component. */
    render(<ErrorState title="Nope" description="A flattened string" onRetry={() => undefined} />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

interface Site {
  file: string;
  line: number;
  block: string;
}

/** Every `<ErrorState … />` in the app. All of them are self-closing. */
function errorStateSites(): Site[] {
  const sites: Site[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      if (full.includes(`${path.sep}__tests__${path.sep}`)) continue;
      if (full.startsWith(path.join(SRC, "test"))) continue;

      const source = readFileSync(full, "utf8");
      const pattern = /<ErrorState\b[\s\S]*?\/>/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        sites.push({
          file: path.relative(SRC, full),
          line: source.slice(0, match.index).split("\n").length,
          block: match[0],
        });
      }
    }
  };

  walk(SRC);
  return sites;
}

describe("R11 · no screen asks for a retry without the error that decides it", () => {
  const sites = errorStateSites();

  it("finds the call sites, so a broken scan cannot pass vacuously", () => {
    expect(sites.length).toBeGreaterThanOrEqual(40);
  });

  it("leaves no site with onRetry and no error", () => {
    const bypassing = sites
      .filter((site) => site.block.includes("onRetry") && !/\berror[=:]/.test(site.block))
      .map((site) => `${site.file}:${site.line}`);

    expect(bypassing).toEqual([]);
  });
});
