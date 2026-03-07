import { describe, it, expect, vi } from "vitest";

describe("exportToExcel", () => {
  it("alerts and returns early on empty data", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);

    const { exportToExcel } = await import("@/lib/excel-export");
    exportToExcel([], "test");

    expect(alertMock).toHaveBeenCalledWith("No data to export.");
    vi.unstubAllGlobals();
  });
});
