// Helper for detecting collector-only users.

/**
 * True when the user has ONLY the AGENT_PP module (no other modules).
 * Admin/Moderator never count as collector-only regardless of modules.
 */
export function isCollectorOnly(
  role: string | null | undefined,
  modules: string[] | null | undefined
): boolean {
  if (!role || !modules) return false;
  if (role === "ADMIN" || role === "MODERATOR") return false;
  return modules.length === 1 && modules[0] === "AGENT_PP";
}
