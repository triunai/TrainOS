/**
 * Locale plumbing: the switch is real even though the screens are not
 * translated yet, and these pin the parts that would rot silently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { en } from "../en";
import { ms } from "../ms";
import { I18nProvider, useI18n } from "../I18nProvider";

const meLocale = { current: "en-MY" };

vi.mock("@/shared/hooks/useMe", () => ({
  useMe: () => ({
    me: { id: "USR-0001", name: "Amirah Yusof", role: "SALES", locale: meLocale.current },
    setRole: vi.fn(),
  }),
}));

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="help">{t("shell.help")}</span>
      <button type="button" onClick={() => setLocale("ms-MY")}>
        to BM
      </button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  meLocale.current = "en-MY";
  document.documentElement.removeAttribute("lang");
});

describe("the shell catalogues", () => {
  it("covers every English key in Bahasa Malaysia", () => {
    /* `ms` is typed as `Messages`, so this is belt and braces — but a type can
       be satisfied by an empty string and a reader cannot. */
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(ms[key], `missing or empty: ${key}`).toBeTruthy();
    }
    expect(Object.keys(ms)).toHaveLength(Object.keys(en).length);
  });

  it("actually translates rather than echoing English", () => {
    const same = (Object.keys(en) as (keyof typeof en)[]).filter((key) => ms[key] === en[key]);
    /* The catalogue is allowed to keep a term that is English in the market —
       none currently — but not to be a copy. */
    expect(same).toEqual([]);
  });
});

describe("I18nProvider", () => {
  it("starts from the principal's locale", () => {
    meLocale.current = "ms-MY";
    renderProbe();
    expect(screen.getByTestId("locale")).toHaveTextContent("ms-MY");
    expect(screen.getByTestId("help")).toHaveTextContent(ms["shell.help"]);
  });

  it("falls back to English for a locale the catalogue does not carry", () => {
    meLocale.current = "fr-FR";
    renderProbe();
    expect(screen.getByTestId("locale")).toHaveTextContent("en-MY");
  });

  it("lets a stored choice override the account's", () => {
    window.localStorage.setItem("trainos.locale", "ms-MY");
    meLocale.current = "en-MY";
    renderProbe();
    expect(screen.getByTestId("locale")).toHaveTextContent("ms-MY");
  });

  it("ignores a stored value that is not a locale we ship", () => {
    window.localStorage.setItem("trainos.locale", "klingon");
    renderProbe();
    expect(screen.getByTestId("locale")).toHaveTextContent("en-MY");
  });

  it("switches, persists, and tells the document what language it is in", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(document.documentElement.lang).toBe("en-MY");

    await user.click(screen.getByRole("button", { name: "to BM" }));

    expect(screen.getByTestId("help")).toHaveTextContent(ms["shell.help"]);
    expect(document.documentElement.lang).toBe("ms-MY");
    expect(window.localStorage.getItem("trainos.locale")).toBe("ms-MY");
  });
});
