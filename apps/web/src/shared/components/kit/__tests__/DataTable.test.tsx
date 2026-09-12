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
