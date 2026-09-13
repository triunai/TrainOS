/**
 * PairedBars — M01-S01's "Proposals sent vs won".
 *
 * The interesting claims are the two the artboard makes silently: both series
 * share one scale, so the gap between the columns is a real comparison; and
 * every value is readable as text, because the columns themselves are marked
 * decorative and a chart nobody can read the numbers off is a picture.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PairedBars, type PairedBarsSeries } from "@/shared/components/kit/PairedBars";

const SERIES: [PairedBarsSeries, PairedBarsSeries] = [
  { label: "Sent", tone: "track" },
  { label: "Won", tone: "ink" },
];

const POINTS = [
  { key: "2026-10", label: "Oct", values: [41, 22] as [number, number] },
  { key: "2026-11", label: "Nov", values: [50, 17] as [number, number] },
];

function renderChart() {
  return render(<PairedBars label="Proposals sent versus won" series={SERIES} points={POINTS} />);
}

describe("PairedBars", () => {
  it("names the chart for a screen reader", () => {
    renderChart();
    expect(screen.getByRole("figure", { name: "Proposals sent versus won" })).toBeInTheDocument();
  });

  it("writes every value as text, not only as a column height", () => {
    renderChart();

    /* The default format is the number and the series word. A bare "41" beside
       a bar says nothing; "41 sent" is the reading. */
    for (const text of ["41 sent", "22 won", "50 sent", "17 won"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("labels each period once, visibly", () => {
    renderChart();
    expect(screen.getByText("Oct")).toBeInTheDocument();
    expect(screen.getByText("Nov")).toBeInTheDocument();
  });

  it("scales both series against one peak so the pair can be compared", () => {
    const { container } = renderChart();
    const columns = container.querySelectorAll("li > div > div");

    /* 50 is the peak across BOTH series, so it is the full column and every
       other height is a fraction of it. Scaling each series to its own maximum
       would draw 22 won and 50 sent at the same height. */
    const heights = [...columns].map((column) => (column as HTMLElement).style.height);
    expect(heights).toEqual(["82%", "44%", "100%", "34%"]);
  });

  it("marks the columns decorative, because the numbers are already text", () => {
    const { container } = renderChart();
    expect(container.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(4);
  });

  it("survives an all-zero series without dividing by zero", () => {
    const { container } = render(
      <PairedBars
        label="Nothing happened"
        series={SERIES}
        points={[{ key: "2026-11", label: "Nov", values: [0, 0] }]}
      />,
    );

    const heights = [...container.querySelectorAll("li > div > div")].map(
      (column) => (column as HTMLElement).style.height,
    );
    expect(heights).toEqual(["0%", "0%"]);
  });

  it("takes a custom value format", () => {
    render(
      <PairedBars
        label="Spend"
        series={SERIES}
        points={POINTS}
        formatValue={(value, series) => `RM ${value} ${series.label}`}
      />,
    );
    expect(screen.getByText("RM 41 Sent")).toBeInTheDocument();
  });

  it("puts the drill action at the end of the legend row", () => {
    const { container } = render(
      <PairedBars
        label="Proposals"
        series={SERIES}
        points={POINTS}
        action={<button type="button">Open filtered list ›</button>}
      />,
    );

    /* The legend and the link are one row — the artboard puts the drill at the
       foot of the thing it filters rather than up beside the caption. */
    const legend = container.querySelector("figure > div") as HTMLElement;
    expect(within(legend).getByText("Sent")).toBeInTheDocument();
    expect(within(legend).getByRole("button", { name: /Open filtered list/ })).toBeInTheDocument();
  });

  it("paints the quiet series on the track and the loud one in ink", () => {
    const { container } = renderChart();
    const columns = [...container.querySelectorAll("li > div > div")] as HTMLElement[];

    expect(columns[0]?.className).toContain("bg-divider");
    expect(columns[1]?.className).toContain("bg-ink");
  });
});
