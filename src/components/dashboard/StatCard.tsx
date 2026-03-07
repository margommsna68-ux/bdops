"use client";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatCard({ title, value, subtitle, trend, className = "" }: StatCardProps) {
  const trendColor =
    trend === "up"
      ? "text-green-600"
      : trend === "down"
      ? "text-red-600"
      : "text-gray-500";

  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 md:p-6 ${className}`}>
      <p className="text-xs md:text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 md:mt-2 text-xl md:text-3xl font-bold text-gray-900">{value}</p>
      {subtitle && (
        <p className={`mt-1 text-sm ${trendColor}`}>{subtitle}</p>
      )}
    </div>
  );
}
