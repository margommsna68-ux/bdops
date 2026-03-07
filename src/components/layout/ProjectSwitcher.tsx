"use client";

import { useEffect } from "react";
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
  const { data: projects } = trpc.project.list.useQuery();
  const { currentProjectId, setCurrentProject } = useProjectStore();

  // Auto-select first project if none selected
  useEffect(() => {
    if (!currentProjectId && projects && projects.length > 0) {
      setCurrentProject(projects[0].id, projects[0].code);
    }
  }, [currentProjectId, projects, setCurrentProject]);

  return (
    <Select
      value={currentProjectId ?? undefined}
      onValueChange={(val) => {
        const project = projects?.find((p) => p.id === val);
        if (project) setCurrentProject(project.id, project.code);
      }}
    >
      <SelectTrigger className="w-full bg-gray-800 border-gray-600 text-white">
        <SelectValue placeholder="Select project..." />
      </SelectTrigger>
      <SelectContent>
        {projects?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.code} — {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
