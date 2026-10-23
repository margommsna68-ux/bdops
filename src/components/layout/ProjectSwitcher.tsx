"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useProjectStore } from "@/lib/store";
import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ProjectSwitcher() {
  const { data: session } = useSession();
  const { data: projects } = trpc.project.list.useQuery();
  const { currentProjectId, currentProjectName, setCurrentProject } = useProjectStore();

  const memberships = (session?.user as any)?.memberships || [];

  const selectProject = (projectId: string) => {
    const project = projects?.find((p) => p.id === projectId);
    const membership = memberships.find((m: any) => m.projectId === projectId);
    if (project) {
      setCurrentProject(
        project.id,
        project.code,
        project.name,
        (project as any).type || "FULL",
        membership?.role || "USER",
        membership?.allowedModules || [],
        membership?.canManageUsers || false,
        membership?.id,
        (project.settings as {businessMode?:string}|null)?.businessMode||null
      );
    }
  };

  // A renamed project (owner request 23/10/2026: "GROUP MOON") shows its current name everywhere without re-picking it: the
  // stored name follows the server's list.
  useEffect(() => {
    const p = projects?.find((x) => x.id === currentProjectId);
    if (p && p.name !== currentProjectName) selectProject(p.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, currentProjectId, currentProjectName]);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!currentProjectId && projects && projects.length > 0) {
      selectProject(projects[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, projects?.length]);

  return (
    <>
      <div className="space-y-2">
        <Select
          value={currentProjectId ?? undefined}
          onValueChange={selectProject}
        >
          <SelectTrigger className="w-full bg-gray-800 border-gray-600 text-white">
            <SelectValue placeholder="Chọn dự án..." />
          </SelectTrigger>
          <SelectContent>
            {projects?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

    </>
  );
}
