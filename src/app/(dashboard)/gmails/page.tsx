"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GmailAssignDialog } from "@/components/forms/GmailAssignDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEEDS_RECOVERY: "bg-orange-100 text-orange-800",
  NEEDS_2FA_UPDATE: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-100 text-red-800",
  DISABLED: "bg-gray-100 text-gray-800",
};

function isNew(createdAt: string | Date) {
  const created = new Date(createdAt);
  const now = new Date();
  return now.getTime() - created.getTime() < 24 * 60 * 60 * 1000;
}

export default function GmailsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; total: number; skipped: { email: string; reason: string }[] } | null>(null);

  const bulkImport = trpc.gmail.bulkImport.useMutation();

  const { data, isLoading, refetch } = trpc.gmail.list.useQuery(
    {
      projectId: projectId!,
      page,
      search: search || undefined,
      status: statusFilter || undefined,
      unassigned: showUnassigned || undefined,
    },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    {
      key: "email",
      header: "Email",
      render: (item) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.email}</span>
          {isNew(item.createdAt) && (
            <Badge className="text-[10px] px-1.5 py-0 bg-blue-500 text-white">NEW</Badge>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item) => <Badge className={`text-xs ${statusColors[item.status] ?? ""}`}>{item.status}</Badge>,
    },
    {
      key: "vm",
      header: "VM",
      render: (item) => item.vm?.code ? (
        <span className="font-mono text-sm">{item.vm.code}</span>
      ) : (
        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">Unassigned</Badge>
      ),
    },
    {
      key: "server",
      header: "Server",
      render: (item) => item.vm?.server?.code ?? "—",
    },
    {
      key: "paypal",
      header: "PayPal",
      render: (item) =>
        item.paypal ? (
          <Badge variant="outline" className="text-xs">
            {item.paypal.code} ({item.paypal.status})
          </Badge>
        ) : (
          "—"
        ),
    },
    { key: "recoveryEmail", header: "Recovery", render: (item) => item.recoveryEmail ?? "—" },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gmail Accounts</h1>
          <p className="text-gray-500">
            {data ? (
              <>
                {data.total} gmail
                {data.unassignedCount > 0 && (
                  <span className="text-orange-600 ml-2">
                    ({data.unassignedCount} chưa sử dụng)
                  </span>
                )}
              </>
            ) : (
              "Manage Gmail accounts linked to VMs and PayPal"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>Paste Import</Button>
          <Button onClick={() => setShowAssignDialog(true)}>Assign Gmail to VM</Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Tìm email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-md px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant={statusFilter === "" && !showUnassigned ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(""); setShowUnassigned(false); setPage(1); }}
          >
            All
          </Button>
          <Button
            variant={showUnassigned ? "default" : "outline"}
            size="sm"
            onClick={() => { setShowUnassigned(!showUnassigned); setStatusFilter(""); setPage(1); }}
            className={showUnassigned ? "bg-orange-600 hover:bg-orange-700" : ""}
          >
            Chưa sử dụng {data?.unassignedCount ? `(${data.unassignedCount})` : ""}
          </Button>
          {Object.keys(statusColors).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => { setStatusFilter(s); setShowUnassigned(false); setPage(1); }}
            >
              {s.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage={search ? `Không tìm thấy "${search}"` : showUnassigned ? "Tất cả Gmail đã được gán VM." : "Chưa có Gmail nào."}
      />

      <Dialog open={showImport} onOpenChange={(v) => { if (!v) { setShowImport(false); setPasteText(""); setImportResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste Gmail Data</DialogTitle>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
                  <span className="text-green-700 font-semibold text-lg">{importResult.imported}</span>
                  <span className="text-green-600 text-sm ml-1">thêm mới</span>
                </div>
                {importResult.skipped.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                    <span className="text-yellow-700 font-semibold text-lg">{importResult.skipped.length}</span>
                    <span className="text-yellow-600 text-sm ml-1">bị trùng</span>
                  </div>
                )}
              </div>

              {importResult.skipped.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <div className="bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-800">
                    Gmail đã tồn tại (bỏ qua):
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y">
                    {importResult.skipped.map((s, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span className="font-mono">{s.email}</span>
                        <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-300">{s.reason}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={() => { setShowImport(false); setPasteText(""); setImportResult(null); }}>
                  Đóng
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Mỗi dòng 1 Gmail. Các trường cách nhau bằng <code className="bg-gray-100 px-1 rounded">|</code> hoặc <code className="bg-gray-100 px-1 rounded">Tab</code>
              </p>
              <p className="text-xs text-gray-400">
                Format: <code className="bg-gray-100 px-1 rounded">email | password | recovery_email | 2fa_codes</code>
              </p>
              <textarea
                className="w-full h-48 border rounded-md p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={"test@gmail.com|mypassword|recovery@hotmail.com|2fa_code\ntest2@gmail.com|pass2|rec2@mail.com|code2"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              {pasteText.trim() && (
                <p className="text-xs text-gray-500">
                  {pasteText.trim().split("\n").filter(Boolean).length} dòng detected
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowImport(false); setPasteText(""); }}>
                  Cancel
                </Button>
                <Button
                  disabled={!pasteText.trim() || importing}
                  onClick={async () => {
                    setImporting(true);
                    try {
                      const lines = pasteText.trim().split("\n").filter(Boolean);
                      const gmails = lines.map((line) => {
                        const parts = line.includes("|")
                          ? line.split("|").map((s) => s.trim())
                          : line.split("\t").map((s) => s.trim());
                        return {
                          email: parts[0] || "",
                          password: parts[1] || undefined,
                          recoveryEmail: parts[2] || undefined,
                          twoFaCurrent: parts[3] || undefined,
                        };
                      });
                      const valid = gmails.filter((g) => g.email && g.email.includes("@"));
                      if (valid.length === 0) {
                        alert("Không tìm thấy email hợp lệ.");
                        return;
                      }
                      console.log("Sending to bulkImport:", { projectId, gmails: valid });
                      const result = await bulkImport.mutateAsync({ projectId: projectId!, gmails: valid });
                      console.log("Import result:", result);
                      setImportResult(result);
                      refetch();
                    } catch (err: any) {
                      console.error("Import error:", err);
                      const msg = err?.data?.zodError
                        ? "Dữ liệu không hợp lệ: " + JSON.stringify(err.data.zodError)
                        : err?.message || "Unknown error";
                      alert("Import failed: " + msg);
                    } finally {
                      setImporting(false);
                    }
                  }}
                >
                  {importing ? "Importing..." : "Import"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <GmailAssignDialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
