"use client";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useSettingsStore, TIMEZONE_OPTIONS, type AppTheme } from "@/lib/settings-store";
import { useT } from "@/lib/i18n";
import { useState } from "react";
import toast from "react-hot-toast";

const THEMES: { value: AppTheme; label: string; labelVi: string; desc: string; descVi: string; preview: { bg: string; card: string; accent: string; text: string; sidebar: string } }[] = [
  {
    value: "light",
    label: "Light",
    labelVi: "Sáng",
    desc: "Clean business interface",
    descVi: "Giao diện sạch, chuyên nghiệp",
    preview: { bg: "#f8fafc", card: "#ffffff", accent: "#3b82f6", text: "#0f172a", sidebar: "#0f172a" },
  },
  {
    value: "dark",
    label: "Dark",
    labelVi: "Tối",
    desc: "Modern developer dashboard",
    descVi: "Dashboard hiện đại, tối",
    preview: { bg: "#0f172a", card: "#111827", accent: "#3b82f6", text: "#f8fafc", sidebar: "#020617" },
  },
  {
    value: "golden",
    label: "Golden",
    labelVi: "Vàng kim",
    desc: "Premium SaaS with gold accents",
    descVi: "Cao cấp, điểm nhấn vàng kim",
    preview: { bg: "#0b0b0c", card: "#111111", accent: "#fbbf24", text: "#f5f5f5", sidebar: "#070707" },
  },
];

export default function SettingsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const currentModules = useProjectStore((s) => s.currentModules);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const currentProjectCode = useProjectStore((s) => s.currentProjectCode);
  const t = useT();

  const { language, timezone, theme, setLanguage, setTimezone, setTheme } = useSettingsStore();

  const [editingName, setEditingName] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const isAdmin = currentRole === "ADMIN";
  const isAdminOrMod = currentRole === "ADMIN" || currentRole === "MODERATOR";

  // Password change
  const [curPassword, setCurPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // PIN change
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const updateProject = trpc.project.update.useMutation({
    onSuccess: (updated) => {
      toast.success(language === "vi" ? "Đã cập nhật tên dự án" : "Project name updated");
      setEditingName(false);
      refetch();
      if (projectId && currentProjectCode) {
        setCurrentProject(projectId, currentProjectCode, updated.name, currentRole || "USER", currentModules);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: project, isLoading, refetch } = trpc.project.getById.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const { data: pinStatus } = trpc.user.hasPin.useQuery();
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t("settings_password_updated"));
      setCurPassword(""); setNewPassword(""); setConfirmPassword("");
    },
    onError: (err) => toast.error(err.message),
  });
  const setPin = trpc.user.setPin.useMutation({
    onSuccess: () => {
      toast.success(t("settings_pin_updated"));
      setCurPin(""); setNewPin(""); setConfirmPin("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("settings_password_mismatch"));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(language === "vi" ? "Mật khẩu tối thiểu 6 ký tự" : "Password must be at least 6 characters");
      return;
    }
    changePassword.mutate({ currentPassword: curPassword, newPassword });
  };

  const handleChangePin = () => {
    if (newPin !== confirmPin) {
      toast.error(t("settings_pin_mismatch"));
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error(language === "vi" ? "PIN phải là 4-6 chữ số" : "PIN must be 4-6 digits");
      return;
    }
    setPin.mutate({ pin: newPin, currentPin: pinStatus?.hasPin ? curPin : undefined });
  };

  const roleColors: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-800",
    MANAGER: "bg-blue-100 text-blue-800",
    MODERATOR: "bg-yellow-100 text-yellow-800",
    OPERATOR: "bg-green-100 text-green-800",
    PARTNER: "bg-purple-100 text-purple-800",
    VIEWER: "bg-gray-100 text-gray-800",
    USER: "bg-green-100 text-green-800",
  };

  const moduleLabels: Record<string, string> = {
    FUNDS: language === "vi" ? "Quỹ" : "Funds",
    WITHDRAWALS: language === "vi" ? "Rút tiền" : "Withdrawals",
    PAYPALS: language === "vi" ? "PayPal" : "PayPals",
    INFRASTRUCTURE: language === "vi" ? "Hạ tầng" : "Infrastructure",
    COSTS: language === "vi" ? "Chi phí" : "Costs",
    PROFIT: language === "vi" ? "Lợi nhuận" : "Profit",
    AGENT_PP: language === "vi" ? "Đại lý PP" : "Agent PP",
  };

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;
  if (isLoading) return <p className="p-8">{t("loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("settings_title")}</h1>
        <p className="text-gray-500">{t("settings_subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Theme Selector ─── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {language === "vi" ? "Giao diện" : "Theme"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {THEMES.map((t) => {
              const isActive = theme === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={`group relative rounded-xl border-2 p-1 transition-all ${
                    isActive
                      ? "border-blue-500 ring-2 ring-blue-500/20"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                  style={isActive && t.value === "golden" ? { borderColor: "#fbbf24", boxShadow: "0 0 0 3px rgba(251,191,36,0.15)" } : undefined}
                >
                  <div className="rounded-lg overflow-hidden" style={{ backgroundColor: t.preview.bg }}>
                    <div className="flex h-24">
                      <div className="w-10 flex flex-col gap-1 p-1.5" style={{ backgroundColor: t.preview.sidebar }}>
                        <div className="w-full h-1.5 rounded" style={{ backgroundColor: t.preview.accent, opacity: 0.8 }} />
                        <div className="w-full h-1 rounded bg-gray-600 opacity-30" />
                        <div className="w-full h-1 rounded bg-gray-600 opacity-30" />
                        <div className="w-full h-1 rounded bg-gray-600 opacity-30" />
                        <div className="mt-auto w-full h-1 rounded bg-gray-600 opacity-20" />
                      </div>
                      <div className="flex-1 p-2 space-y-1.5">
                        <div className="h-2 w-16 rounded" style={{ backgroundColor: t.preview.text, opacity: 0.8 }} />
                        <div className="flex gap-1.5">
                          <div className="h-8 flex-1 rounded" style={{ backgroundColor: t.preview.card }} />
                          <div className="h-8 flex-1 rounded" style={{ backgroundColor: t.preview.card }} />
                        </div>
                        <div className="h-3 w-12 rounded" style={{ backgroundColor: t.preview.accent }} />
                      </div>
                    </div>
                  </div>
                  <div className="px-2 py-2.5 text-left">
                    <p className="text-sm font-semibold text-gray-900">{language === "vi" ? t.labelVi : t.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{language === "vi" ? t.descVi : t.desc}</p>
                  </div>
                  {isActive && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: t.value === "golden" ? "#fbbf24" : "#3b82f6" }}>
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Display Preferences ─── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("settings_display")}</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">{t("settings_language")}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setLanguage("vi")}
                  className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    language === "vi" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <div className="text-lg mb-1">VN</div>
                  <div>Tiếng Việt</div>
                </button>
                <button
                  onClick={() => setLanguage("en")}
                  className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    language === "en" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <div className="text-lg mb-1">EN</div>
                  <div>English</div>
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">{t("settings_timezone")}</label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">
                {language === "vi" ? "Thời gian hiển thị sẽ theo múi giờ đã chọn" : "All dates and times will display in this timezone"}
              </p>
            </div>
          </div>
        </div>

        {/* ─── Account: Password & PIN ─── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("settings_account")}</h2>

          {/* Your role & modules */}
          <div className="mb-5 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-gray-500">{t("settings_your_role")}:</span>
              <Badge className={`${roleColors[currentRole || ""] ?? ""} text-xs`}>{currentRole}</Badge>
            </div>
            {currentRole === "USER" && currentModules.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-gray-500">{t("settings_your_modules")}:</span>
                {currentModules.map((m) => (
                  <Badge key={m} variant="outline" className="text-xs">{moduleLabels[m] || m}</Badge>
                ))}
              </div>
            )}
            {isAdminOrMod && (
              <p className="text-xs text-gray-400 mt-1">
                {language === "vi" ? "Bạn có quyền truy cập tất cả module" : "You have access to all modules"}
              </p>
            )}
          </div>

          {/* Change Password */}
          <div className="space-y-3 mb-5">
            <h3 className="text-sm font-semibold text-gray-800">{t("settings_change_password")}</h3>
            <Input
              type="password" placeholder={t("settings_current_password")}
              value={curPassword} onChange={(e) => setCurPassword(e.target.value)}
              className="h-9 text-sm"
            />
            <Input
              type="password" placeholder={t("settings_new_password")}
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="h-9 text-sm"
            />
            <Input
              type="password" placeholder={t("settings_confirm_password")}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-9 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }}
            />
            <Button size="sm" onClick={handleChangePassword}
              disabled={!curPassword || !newPassword || !confirmPassword || changePassword.isLoading}>
              {changePassword.isLoading ? "..." : t("settings_change_password")}
            </Button>
          </div>

          {/* Change PIN */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">
              {pinStatus?.hasPin ? t("settings_change_pin") : t("settings_set_pin")}
            </h3>
            {!pinStatus?.hasPin && (
              <p className="text-xs text-amber-600">{t("settings_no_pin")}</p>
            )}
            {pinStatus?.hasPin && (
              <Input
                type="password" placeholder={t("settings_current_pin")} maxLength={6}
                value={curPin} onChange={(e) => setCurPin(e.target.value.replace(/\D/g, ""))}
                className="h-9 text-sm"
              />
            )}
            <Input
              type="password" placeholder={t("settings_new_pin")} maxLength={6}
              value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              className="h-9 text-sm"
            />
            <Input
              type="password" placeholder={t("settings_confirm_pin")} maxLength={6}
              value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              className="h-9 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handleChangePin(); }}
            />
            <Button size="sm" onClick={handleChangePin}
              disabled={!newPin || !confirmPin || (pinStatus?.hasPin && !curPin) || setPin.isLoading}>
              {setPin.isLoading ? "..." : pinStatus?.hasPin ? t("settings_change_pin") : t("settings_set_pin")}
            </Button>
          </div>
        </div>

        {/* ─── Project Info (Admin/Moderator only) ─── */}
        {isAdminOrMod && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("settings_project_info")}</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">{t("settings_name")}</dt>
                <dd className="font-medium flex items-center gap-2">
                  {editingName ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newProjectName.trim()) {
                            updateProject.mutate({ projectId: projectId!, name: newProjectName.trim() });
                          }
                          if (e.key === "Escape") setEditingName(false);
                        }}
                      />
                      <Button size="sm" className="h-8 px-3" onClick={() => {
                        if (newProjectName.trim()) updateProject.mutate({ projectId: projectId!, name: newProjectName.trim() });
                      }} disabled={!newProjectName.trim() || updateProject.isLoading}>
                        {updateProject.isLoading ? "..." : language === "vi" ? "Lưu" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingName(false)}>
                        {language === "vi" ? "Hủy" : "Cancel"}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {project?.name}
                      {isAdmin && (
                        <button onClick={() => { setNewProjectName(project?.name || ""); setEditingName(true); }}
                          className="text-gray-400 hover:text-blue-500 transition-colors"
                          title={language === "vi" ? "Sửa tên dự án" : "Edit project name"}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">{t("settings_code")}</dt>
                <dd className="font-medium">{project?.code}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t("settings_description")}</dt>
                <dd>{project?.description || "—"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <dt className="text-gray-500">{t("settings_servers")}</dt>
                  <dd className="text-xl font-bold">{project?._count.servers ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t("settings_paypal_accounts")}</dt>
                  <dd className="text-xl font-bold">{project?._count.paypalAccounts ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t("settings_fund_transactions")}</dt>
                  <dd className="text-xl font-bold">{project?._count.fundTransactions ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t("settings_withdrawals")}</dt>
                  <dd className="text-xl font-bold">{project?._count.withdrawals ?? 0}</dd>
                </div>
              </div>
            </dl>
          </div>
        )}

        {/* ─── Team Members (Admin/Moderator only) ─── */}
        {isAdminOrMod && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {t("settings_team_members")} ({project?.members.length ?? 0})
            </h2>
            <div className="space-y-2">
              {project?.members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                      {(m.user.name || m.user.username || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-900">{m.user.name || m.user.username || m.user.email}</p>
                      <p className="text-xs text-gray-500">@{m.user.username || m.user.email}</p>
                    </div>
                  </div>
                  <Badge className={`${roleColors[m.role] ?? ""} text-xs`}>{m.role}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
