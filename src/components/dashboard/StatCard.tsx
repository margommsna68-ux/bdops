"use client";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatCard({ title, value, subtitle, trend, className = "" }: StatCardProps) {
  const trendIcon =
    trend === "up" ? (
      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ) : trend === "down" ? (
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ) : null;

  const subtitleColor =
    trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-gray-500";

  const indicatorColor =
    trend === "up" ? "bg-emerald-500" : trend === "down" ? "bg-red-500" : "bg-blue-500";

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 shadow-md p-5 flex flex-col gap-3 ${className}`}
      style={{ minHeight: 120 }}
    >
      {/* Header: indicator + label */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${indicatorColor} shrink-0`} />
        <span className="text-sm font-medium text-gray-500 truncate">{title}</span>
      </div>

      {/* Value */}
      <p className="text-2xl font-semibold text-gray-900 tracking-tight leading-none">{value}</p>

      {/* Subtitle */}
      {subtitle && (
        <div className="flex items-center gap-1">
          {trendIcon}
          <span className={`text-sm ${subtitleColor}`}>{subtitle}</span>
        </div>
      )}
    </div>
  );
}
