"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MonthlyData {
  month: string;
  funds: number;
  costs: number;
  profit: number;
}

interface MonthlyPLChartProps {
  data: MonthlyData[];
}

export function MonthlyPLChart({ data }: MonthlyPLChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        No data available for chart.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly P&L</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={(v) => `$${v}`} />
          <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
          <Legend />
          <Bar dataKey="funds" fill="#22c55e" name="Funds Received" />
          <Bar dataKey="costs" fill="#ef4444" name="Costs" />
          <Bar dataKey="profit" fill="#3b82f6" name="Net Profit" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
