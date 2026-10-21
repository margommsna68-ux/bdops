"use client";
import { useSession } from "next-auth/react";
import { useProjectStore } from "./store";
// One way to make a project the current one (owner brief 22/10/2026): the SIGNED-IN user's own membership of that project (never the
// first member of the list, never a guessed ADMIN), with the Proxy / VM mode, the name and the rights. Every picker, the Dự án page and
// the user page use it; the layout then re-reads the membership from the server (project.myMembership).
export interface SelectableProject { id: string; code: string; name: string; type?: string | null; settings?: unknown }
export function useSelectProject() {
  const { data: session } = useSession();
  const set = useProjectStore((s) => s.setCurrentProject);
  return (p: SelectableProject) => {
    const memberships = ((session?.user as { memberships?: unknown[] } | undefined)?.memberships || []) as { projectId: string; id: string; role: string; allowedModules: string[]; canManageUsers?: boolean }[];
    const m = memberships.find((x) => x.projectId === p.id);
    const mode = (p.settings as { businessMode?: string } | null | undefined)?.businessMode ?? null;
    set(p.id, p.code, p.name, p.type || "FULL", m?.role || "VIEWER", m?.allowedModules || [], !!m?.canManageUsers, m?.id, mode);
  };
}
