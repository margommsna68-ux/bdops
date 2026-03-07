import { describe, it, expect } from "vitest";

/**
 * Tests for critical business logic patterns used across routers.
 * These test pure logic functions extracted from the router patterns.
 */

// Profit split calculation logic (mirrors profitSplit router)
function calculateProfitSplit(
  totalWithdrawal: number,
  totalCost: number,
  partners: { name: string; percentage: number }[]
) {
  const totalPct = partners.reduce((s, p) => s + p.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    throw new Error("Partner percentages must sum to 100%");
  }

  const netProfit = totalWithdrawal - totalCost;

  return {
    totalWithdrawal,
    totalCost,
    netProfit,
    allocations: partners.map((p) => ({
      partnerName: p.name,
      percentage: p.percentage,
      amount: parseFloat(((netProfit * p.percentage) / 100).toFixed(2)),
    })),
  };
}

// Cost auto-calculation logic (mirrors cost router)
function calculateCostTotal(input: {
  serverCost?: number;
  ipCost?: number;
  extraCost?: number;
  total: number;
}) {
  const calculatedTotal =
    (input.serverCost ?? 0) + (input.ipCost ?? 0) + (input.extraCost ?? 0);
  return calculatedTotal > 0 ? calculatedTotal : input.total;
}

// Mixing status logic (mirrors withdrawal router)
function calculateMixingStatus(
  totalReceived: number,
  totalMixed: number
) {
  const unmixedBalance = totalReceived - totalMixed;
  return {
    totalReceived,
    totalMixed,
    unmixedBalance,
    isMixed: unmixedBalance <= 0,
  };
}

// Duplicate detection date range logic
function getDayRange(dateStr: string) {
  const inputDate = new Date(dateStr);
  const dayStart = new Date(inputDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(inputDate);
  dayEnd.setHours(23, 59, 59, 999);
  return { dayStart, dayEnd };
}

describe("Profit Split Calculation", () => {
  it("calculates net profit correctly", () => {
    const result = calculateProfitSplit(10000, 3000, [
      { name: "A", percentage: 60 },
      { name: "B", percentage: 40 },
    ]);
    expect(result.netProfit).toBe(7000);
    expect(result.allocations[0].amount).toBe(4200);
    expect(result.allocations[1].amount).toBe(2800);
  });

  it("handles negative profit (cost > withdrawal)", () => {
    const result = calculateProfitSplit(1000, 5000, [
      { name: "A", percentage: 50 },
      { name: "B", percentage: 50 },
    ]);
    expect(result.netProfit).toBe(-4000);
    expect(result.allocations[0].amount).toBe(-2000);
    expect(result.allocations[1].amount).toBe(-2000);
  });

  it("handles zero profit", () => {
    const result = calculateProfitSplit(5000, 5000, [
      { name: "A", percentage: 50 },
      { name: "B", percentage: 50 },
    ]);
    expect(result.netProfit).toBe(0);
    expect(result.allocations[0].amount).toBe(0);
  });

  it("throws when percentages don't sum to 100", () => {
    expect(() =>
      calculateProfitSplit(10000, 3000, [
        { name: "A", percentage: 60 },
        { name: "B", percentage: 30 },
      ])
    ).toThrow("must sum to 100%");
  });

  it("accepts percentages with decimal precision (99.99 + 0.01)", () => {
    const result = calculateProfitSplit(10000, 0, [
      { name: "A", percentage: 99.99 },
      { name: "B", percentage: 0.01 },
    ]);
    expect(result.allocations[0].amount).toBe(9999);
    expect(result.allocations[1].amount).toBe(1);
  });

  it("rounds allocation amounts to 2 decimal places", () => {
    const result = calculateProfitSplit(10000, 0, [
      { name: "A", percentage: 33.33 },
      { name: "B", percentage: 33.33 },
      { name: "C", percentage: 33.34 },
    ]);
    // Sum of allocations should be very close to total
    const totalAllocated = result.allocations.reduce((s, a) => s + a.amount, 0);
    expect(Math.abs(totalAllocated - 10000)).toBeLessThan(1);
  });
});

describe("Cost Total Calculation", () => {
  it("auto-calculates from components when present", () => {
    expect(
      calculateCostTotal({
        serverCost: 100,
        ipCost: 50,
        extraCost: 30,
        total: 999,
      })
    ).toBe(180);
  });

  it("falls back to manual total when no components", () => {
    expect(calculateCostTotal({ total: 500 })).toBe(500);
  });

  it("falls back to manual total when components are all zero", () => {
    expect(
      calculateCostTotal({
        serverCost: 0,
        ipCost: 0,
        extraCost: 0,
        total: 250,
      })
    ).toBe(250);
  });

  it("handles partial components", () => {
    expect(
      calculateCostTotal({
        serverCost: 100,
        total: 200,
      })
    ).toBe(100);
  });
});

describe("Mixing Status", () => {
  it("marks as mixed when all funds have been mixed", () => {
    const status = calculateMixingStatus(1000, 1000);
    expect(status.isMixed).toBe(true);
    expect(status.unmixedBalance).toBe(0);
  });

  it("marks as mixed when over-mixed", () => {
    const status = calculateMixingStatus(1000, 1200);
    expect(status.isMixed).toBe(true);
    expect(status.unmixedBalance).toBe(-200);
  });

  it("marks as unmixed when balance remains", () => {
    const status = calculateMixingStatus(1000, 500);
    expect(status.isMixed).toBe(false);
    expect(status.unmixedBalance).toBe(500);
  });

  it("marks as unmixed when nothing mixed", () => {
    const status = calculateMixingStatus(1000, 0);
    expect(status.isMixed).toBe(false);
    expect(status.unmixedBalance).toBe(1000);
  });
});

describe("Duplicate Detection Date Range", () => {
  it("creates correct day range", () => {
    const { dayStart, dayEnd } = getDayRange("2024-06-15T14:30:00Z");
    expect(dayStart.getHours()).toBe(0);
    expect(dayStart.getMinutes()).toBe(0);
    expect(dayEnd.getHours()).toBe(23);
    expect(dayEnd.getMinutes()).toBe(59);
    expect(dayEnd.getSeconds()).toBe(59);
  });

  it("dayStart is before dayEnd", () => {
    const { dayStart, dayEnd } = getDayRange("2024-01-01");
    expect(dayStart.getTime()).toBeLessThan(dayEnd.getTime());
  });

  it("both dates are on the same calendar day", () => {
    const { dayStart, dayEnd } = getDayRange("2024-12-25");
    expect(dayStart.getDate()).toBe(dayEnd.getDate());
    expect(dayStart.getMonth()).toBe(dayEnd.getMonth());
    expect(dayStart.getFullYear()).toBe(dayEnd.getFullYear());
  });
});
