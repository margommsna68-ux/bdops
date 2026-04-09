// Badge shown when a PP field is missing data.
// variant="required" → red NODATA badge (field is required for completeness)
// variant="optional" → gray N/A text (field is optional, just not filled)

export function NoDataBadge({
  variant = "optional",
  label,
}: {
  variant?: "required" | "optional";
  label?: string;
}) {
  if (variant === "required") {
    return (
      <span
        className="inline-block px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded border border-red-300 uppercase tracking-wide"
        title={label || "Field is required but missing"}
      >
        NODATA
      </span>
    );
  }
  return <span className="text-xs text-gray-400 italic">N/A</span>;
}
