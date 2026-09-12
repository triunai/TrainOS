import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Skeleton,
  SkeletonText,
  SkeletonTable,
  SkeletonMetrics,
} from "@/shared/components/kit/Skeleton";

describe("Skeleton", () => {
  it("renders a single hidden bar", () => {
    const { container } = render(<Skeleton />);
    const bar = container.firstElementChild;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar?.className).toContain("animate-pulse");
  });

  it("renders the requested number of lines in SkeletonText, all hidden", () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5); // wrapper + 4 lines
    const lines = container.firstElementChild?.children;
    expect(lines).toHaveLength(4);
  });

  it("defaults SkeletonText to 3 lines", () => {
    const { container } = render(<SkeletonText />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it("renders a SkeletonTable with the requested rows and header columns", () => {
    const { container } = render(<SkeletonTable rows={2} columns={3} />);
    const root = container.firstElementChild as HTMLElement;
    // header row + 2 body rows
    expect(root.children).toHaveLength(3);
    expect(root.children[0].children).toHaveLength(3);
  });

  it("renders SkeletonMetrics as 4 label/value pairs, all decorative", () => {
    const { container } = render(<SkeletonMetrics />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.children).toHaveLength(4);
  });
});
