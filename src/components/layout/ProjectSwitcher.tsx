"use client";

import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectSwitcher() {
  const { data: session } = useSession();
  const { data: projects, refetch } = trpc.project.list.useQuery();
  const { currentProjectId, setCurrentProject, currentRole } = useProjectStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const memberships = (session?.user as any)?.memberships || [];
  const isAdmin = currentRole === "ADMIN";

  const createProject = trpc.project.create.useMutation({
    onSuccess: (newProject) => {
      refetch();
      setShowCreate(false);
      setNewName("");
      setNewCode("");
      setNewDesc("");
      // Auto-select the new project
      setCurrentProject(newProject.id, newProject.code, newProject.name, "ADMIN", []);
    },
  });

  const selectProject = (projectId: string) => {
    const project = projects?.find((p) => p.id === projectId);
    const membership = memberships.find((m: any) => m.projectId === projectId);
    if (project) {
      setCurrentProject(
        project.id,
        project.code,
        project.name,
        membership?.role || "USER",
        membership?.allowedModules || []
      );
    }
  };

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
                {p.code} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full text-xs text-gray-400 hover:text-white transition-colors py-1 flex items-center justify-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo dự án mới
          </button>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo dự án mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã dự án</label>
              <Input
                placeholder="VD: AE, DN, BD..."
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                maxLength={10}
              />
              <p className="text-xs text-gray-400 mt-0.5">Tối đa 10 ký tự, viết hoa</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên dự án</label>
              <Input
                placeholder="VD: Bright Data AE"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả (tùy chọn)</label>
              <Input
                placeholder="Mô tả ngắn về dự án"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
              <Button
                onClick={() => {
                  if (!newCode || !newName) return;
                  createProject.mutate({ name: newName, code: newCode, description: newDesc || undefined });
                }}
                disabled={!newCode || !newName || createProject.isLoading}
              >
                {createProject.isLoading ? "Đang tạo..." : "Tạo dự án"}
              </Button>
            </div>
            {createProject.error && (
              <p className="text-sm text-red-600">{createProject.error.message}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
