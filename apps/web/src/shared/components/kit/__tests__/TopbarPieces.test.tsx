import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchTrigger, NotificationBell, Avatar } from "@/shared/components/kit/TopbarPieces";
import { initials } from "@/shared/components/kit/format";

describe("TopbarPieces", () => {
  it("SearchTrigger is a button showing the command-K hint and calls onOpen", () => {
    const onOpen = vi.fn();
    render(<SearchTrigger onOpen={onOpen} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("K");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("NotificationBell's accessible name includes the unread count when unread > 0", () => {
    render(<NotificationBell unread={3} />);
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("NotificationBell's accessible name does not include a count when unread is 0", () => {
    render(<NotificationBell unread={0} />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("Avatar renders initials with an accessible name of the full name", () => {
    render(<Avatar name="Amirah Yusof" />);
    const avatar = screen.getByRole("img", { name: "Amirah Yusof" });
    expect(avatar).toHaveTextContent("AY");
  });

  it("the exported `initials` helper computes initials directly", () => {
    expect(initials("Amirah Yusof")).toBe("AY");
    expect(initials("Kelvin")).toBe("K");
  });
});
