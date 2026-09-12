import { render, screen } from "@testing-library/react";
import userEventDefault from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useTheme } from "next-themes";
import { ThemeProvider } from "../ThemeProvider";

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme ?? "unset"}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        light
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("defaults to system", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(await screen.findByTestId("theme")).toHaveTextContent("system");
  });

  it("stamps data-theme on the root element so the token swap applies", async () => {
    const user = userEventDefault.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");

    await user.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
