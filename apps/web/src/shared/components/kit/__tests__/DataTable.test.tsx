import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DataTable,
  BulkActionBar,
  type Column,
  type RowGroup,
} from "@/shared/components/kit/DataTable";

interface Row {
  id: string;
  name: string;
  hasMoney: boolean;
}

const columns: Column<Row>[] = [
  { key: "name", label: "Name", accessor: (row) => row.name, sortable: true },
];

const typographyColumns: Column<Row>[] = [
  { key: "ref", label: "Ref", variant: "code", accessor: (row) => row.id },
  { key: "value", label: "Value", align: "right", accessor: () => "RM 67,200" },
  { key: "name", label: "Last checked", accessor: (row) => row.name },
];

const rows: Row[] = [
  { id: "r1", name: "Alpha", hasMoney: false },
  { id: "r2", name: "Beta", hasMoney: true },
];

describe("DataTable", () => {
  it("renders a caption with the label as the table's accessible name, headers, and rows via accessor", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} label="Enquiries" />);
    expect(screen.getByRole("table", { name: "Enquiries" })).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders a sortable header as a button that calls onSort, and the sorted header carries aria-sort", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        label="Enquiries"
        sortKey="name"
        sortDirection="desc"
        onSort={onSort}
      />,
    );
    const button = screen.getByRole("button", { name: /Name/ });
    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("checking the header checkbox selects all selectable rows only, and a disabled row's checkbox has an accessible name equal to its reason", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        label="Enquiries"
        selectedKeys={new Set()}
        onSelectionChange={onSelectionChange}
        selectionDisabledReason={(row) => (row.hasMoney ? "Carries a monetary value" : undefined)}
      />,
    );

    const selectAll = screen.getByRole("checkbox", { name: "Select all rows" });
    fireEvent.click(selectAll);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(["r1"]));

    const disabledCheckbox = screen.getByRole("checkbox", { name: "Carries a monetary value" });
    expect(disabledCheckbox).toBeDisabled();
  });

  it("renders each group's caption as a row spanning the table", () => {
    const groups: RowGroup<Row>[] = [{ caption: "Breaching SLA", rows: [rows[0]] }];
    render(<DataTable columns={columns} groups={groups} rowKey={(r) => r.id} label="Enquiries" />);
    const captionCell = screen.getByText("Breaching SLA").closest("th");
    expect(captionCell).toHaveAttribute("colspan", "1");
  });

  /* Tightening brief §1 and §9. Both of these were defects found on real
     screens: every money column read in mono, and every heading read as a
     tracked uppercase mono eyebrow. The assertions are written as refusals so
     the old treatment cannot come back through a later edit. */
  it("sets a right-aligned numeric cell in the UI font with tabular numerals, never mono", () => {
    render(
      <DataTable columns={typographyColumns} rows={rows} rowKey={(r) => r.id} label="Enquiries" />,
    );

    const money = screen.getAllByText("RM 67,200")[0]?.closest("td");
    expect(money).toBeTruthy();
    expect(money?.className).toContain("tabular-nums");
    expect(money?.className).toContain("text-right");
    expect(money?.className).not.toContain("font-mono");
  });

  it("keeps mono only for a column that opts in with variant code", () => {
    render(
      <DataTable columns={typographyColumns} rows={rows} rowKey={(r) => r.id} label="Enquiries" />,
    );

    const ref = screen.getByText("r1").closest("td");
    expect(ref?.className).toContain("font-mono");

    /* And nothing else in the row borrowed it. */
    const plain = screen.getByText("Alpha").closest("td");
    expect(plain?.className).not.toContain("font-mono");
  });

  it("renders column headers in the UI font, sentence case and muted ink, with no letterspacing", () => {
    render(
      <DataTable columns={typographyColumns} rows={rows} rowKey={(r) => r.id} label="Enquiries" />,
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);

    for (const header of headers) {
      expect(header.className).toContain("font-sans");
      expect(header.className).toContain("text-[12px]");
      expect(header.className).toContain("text-ink-muted");
      expect(header.className).not.toContain("font-mono");
      expect(header.className).not.toContain("uppercase");
      expect(header.className).not.toContain("tracking-");
    }

    /* The label is the screen's words, rendered as given. */
    expect(screen.getByText("Last checked")).toBeInTheDocument();
  });

  it("gives a sortable header the same typography, with no uppercase on the button", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        label="Enquiries"
        sortKey="name"
        sortDirection="asc"
        onSort={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /Name/ });
    expect(button.className).not.toContain("uppercase");
    expect(button.className).not.toContain("tracking-");
    expect(button.className).not.toContain("font-mono");
  });

  it("gives a group caption the same header typography", () => {
    const groups: RowGroup<Row>[] = [{ caption: "Breaching SLA", rows: [rows[0]] }];
    render(<DataTable columns={columns} groups={groups} rowKey={(r) => r.id} label="Enquiries" />);

    const caption = screen.getByText("Breaching SLA").closest("th");
    expect(caption?.className).toContain("font-sans");
    expect(caption?.className).not.toContain("font-mono");
    expect(caption?.className).not.toContain("uppercase");
    expect(caption?.className).not.toContain("tracking-");
  });

  it("gives a suggested row the AI tint, and never a fill", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowSuggested={(r) => r.id === rows[1]?.id}
        label="Enquiries"
      />,
    );

    const marked = document.querySelectorAll("tbody tr[data-suggested]");
    expect(marked).toHaveLength(1);
    /* 6% tint, per CLAUDE.md. `bg-ai-tint-2` is the SELECTED surface and a
       suggested row must not borrow it, or a suggestion reads as a choice the
       user made. */
    expect(marked[0]?.className).toContain("bg-ai-tint");
    expect(marked[0]?.className).not.toContain("bg-ai-tint-2");
    expect(marked[0]?.className).not.toContain("bg-primary");
  });

  it("lets selection win over suggestion, and suggestion win over the zebra", () => {
    const second = rows[1];
    expect(second).toBeDefined();

    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowSuggested={() => true}
        selectedKeys={new Set([second?.id ?? ""])}
        onSelectionChange={vi.fn()}
        label="Enquiries"
      />,
    );

    const all = document.querySelectorAll("tbody tr");
    /* The selected row keeps the selection surface; the rest take the tint and
       none of them takes the stripe, because a tint under a tint is a third
       surface nobody asked for. */
    expect(all[1]?.className).toContain("bg-ai-tint-2");
    expect(all[0]?.className).toContain("bg-ai-tint");
    expect(all[0]?.className).not.toContain("bg-surface/60");
  });

  it("renders the empty state instead of a tbody when there are zero rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} label="Enquiries" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});

describe("BulkActionBar", () => {
  it("renders nothing at count 0", () => {
    const { container } = render(
      <BulkActionBar count={0} onClear={vi.fn()}>
        <button type="button">Assign</button>
      </BulkActionBar>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the count and a Clear button at count > 0", () => {
    const onClear = vi.fn();
    render(
      <BulkActionBar count={3} onClear={onClear}>
        <button type="button">Assign</button>
      </BulkActionBar>,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });
});
