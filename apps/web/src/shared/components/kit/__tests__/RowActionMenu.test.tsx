import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RowActionMenu } from "@/shared/components/kit/RowActionMenu";

/* Opened from the KEYBOARD. `userEvent.click` deadlocks against the
   `pointer-events: none` Radix puts on the body while a menu is open, and
   jsdom has no `PointerEvent`, so the pointer path Radix listens on cannot be
   synthesised faithfully either. Enter on the trigger is a real way a person
   opens this menu and it exercises the same open path. */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/* Rendered inside a real row: the trigger's reveal is driven by `tr:hover`, so
   a bare div would not be the element the component is built for. */
function Row(props: React.ComponentProps<typeof RowActionMenu>) {
  return (
    <table>
      <tbody>
        <tr>
          <td>
            <RowActionMenu {...props} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

describe("RowActionMenu", () => {
  it("names the row it acts on, so six rows are not six identical buttons", () => {
    render(<Row label="Circular 04/2026" actions={[{ label: "Check", onSelect: () => {} }]} />);
    expect(
      screen.getByRole("button", { name: "More actions for Circular 04/2026" }),
    ).toBeInTheDocument();
  });

  it("stays in the DOM while hidden, so the keyboard can still reach it", () => {
    render(<Row label="Circular 04/2026" actions={[{ label: "Check", onSelect: () => {} }]} />);
    const trigger = screen.getByRole("button", { name: /More actions/ });
    /* Hidden by opacity, never by `display: none` or by being absent — either
       of those would take it out of the tab order and out of the a11y tree. */
    expect(trigger.className).toContain("opacity-0");
    expect(trigger.className).toContain("focus-visible:opacity-100");
    expect(trigger).toBeVisible();
  });

  it("runs the action the reader chose", async () => {
    const check = vi.fn();
    const reingest = vi.fn();
    render(
      <Row
        label="Circular 04/2026"
        actions={[
          { label: "Check", onSelect: check },
          { label: "Re-ingest", onSelect: reingest },
        ]}
      />,
    );

    openMenu(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Re-ingest" }));

    expect(reingest).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
  });

  it("does not open the row underneath when the overflow is clicked", () => {
    const openRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={openRow}>
            <td>
              <RowActionMenu
                label="Circular 04/2026"
                actions={[{ label: "Check", onSelect: () => {} }]}
              />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    /* The row itself opens the record. A click on the overflow must not also
       be a request to open it. */
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(openRow).not.toHaveBeenCalled();
  });

  it("renders nothing at all when a row has no actions", () => {
    const { container } = render(<Row label="Circular 04/2026" actions={[]} />);
    expect(container.querySelector("button")).toBeNull();
  });
});
