import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/encryption";

// --- Token helpers ---

function createToken(userId: string, projectIds: string[]): string {
  const payload = JSON.stringify({
    userId,
    projectIds,
    exp: Date.now() + 180 * 24 * 60 * 60 * 1000, // 6 months
  });
  const key = process.env.ENCRYPTION_KEY!;
  const hmac = crypto.createHmac("sha256", key).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64") + "." + hmac;
}

function verifyToken(
  token: string
): { userId: string; projectIds: string[] } | null {
  try {
    const [payloadB64, hmac] = token.split(".");
    const payload = Buffer.from(payloadB64, "base64").toString();
    const key = process.env.ENCRYPTION_KEY!;
    const expected = crypto
      .createHmac("sha256", key)
      .update(payload)
      .digest("hex");
    if (hmac !== expected) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// --- Helpers ---

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

// --- POST handler ---

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    // =====================
    // ACTION: login
    // =====================
    if (action === "login") {
      const { username, password, pin, deviceId, deviceName } = body as {
        action: string;
        username: string;
        password: string;
        pin: string;
        deviceId?: string;
        deviceName?: string;
      };

      if (!username || !password || !pin) {
        return NextResponse.json(
          { error: "Missing username, password, or pin" },
          { status: 400 }
        );
      }

      // Find user by username or email
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: username },
            { email: username },
          ],
        },
      });

      if (!user || !user.password) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      // Verify password
      const passwordValid = await bcrypt.compare(password, user.password);
      if (!passwordValid) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      // Verify PIN
      if (!user.pin) {
        return NextResponse.json(
          { error: "User has no PIN configured" },
          { status: 403 }
        );
      }

      const pinValid = await bcrypt.compare(pin, user.pin);
      if (!pinValid) {
        return NextResponse.json(
          { error: "Invalid PIN" },
          { status: 401 }
        );
      }

      // Get project memberships — only projects where user has AUTOTYPE access (or ADMIN)
      const memberships = await prisma.projectMember.findMany({
        where: { userId: user.id },
        include: { project: { select: { id: true, name: true, code: true } } },
      });

      const allowed = memberships.filter((m) => {
        if (m.role === "ADMIN") return true;
        const modules: string[] = m.allowedModules || [];
        return modules.includes("AUTOTYPE");
      });

      if (allowed.length === 0) {
        return NextResponse.json(
          { error: "Khong co quyen AutoType. Lien he admin." },
          { status: 403 }
        );
      }

      // --- Device limit check ---
      const effectiveDeviceId = deviceId || `device_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Clean up expired sessions (inactive > 7 days)
      await prisma.autotypeSession.deleteMany({
        where: {
          userId: user.id,
          lastActiveAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });

      // Get max allowed devices (use the highest limit across all allowed projects)
      const maxDevices = Math.max(...allowed.map((m) => m.maxAutotypeDevices ?? 2));

      // Count active sessions (exclude current device)
      const activeSessions = await prisma.autotypeSession.findMany({
        where: { userId: user.id },
        orderBy: { lastActiveAt: "desc" },
      });

      const otherSessions = activeSessions.filter((s) => s.deviceId !== effectiveDeviceId);

      if (otherSessions.length >= maxDevices) {
        return NextResponse.json(
          {
            error: `Da dat gioi han ${maxDevices} thiet bi. Lien he admin de tang gioi han hoac cho session het han.`,
            activeDevices: otherSessions.length,
            maxDevices,
          },
          { status: 429 }
        );
      }

      // Upsert session for this device
      await prisma.autotypeSession.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId: effectiveDeviceId } },
        update: { lastActiveAt: new Date(), deviceName: deviceName || undefined },
        create: { userId: user.id, deviceId: effectiveDeviceId, deviceName: deviceName || null },
      });

      const projectIds = allowed.map((m) => m.projectId);
      const projects = allowed.map((m) => ({
        id: m.project.id,
        code: (m.project as any).code,
        name: m.project.name,
        role: m.role,
      }));

      const token = createToken(user.id, projectIds);

      return NextResponse.json({
        token,
        userId: user.id,
        name: user.name,
        projects,
        deviceId: effectiveDeviceId,
      });
    }

    // =====================
    // ACTION: credentials
    // =====================
    if (action === "credentials") {
      const { token, projectId, holder, vmppCode } = body as {
        action: string;
        token: string;
        projectId?: string;
        holder: string;
        vmppCode: string;
      };

      if (!token || !holder || !vmppCode) {
        return NextResponse.json(
          { error: "Missing token, holder, or vmppCode" },
          { status: 400 }
        );
      }

      // Verify token
      const tokenData = verifyToken(token);
      if (!tokenData) {
        return NextResponse.json(
          { error: "Invalid or expired token" },
          { status: 401 }
        );
      }

      // If projectId specified, check it's allowed
      if (projectId && !tokenData.projectIds.includes(projectId)) {
        return NextResponse.json(
          { error: "Access denied for this project" },
          { status: 403 }
        );
      }

      // Re-check user still exists
      const credUser = await prisma.user.findUnique({ where: { id: tokenData.userId } });
      if (!credUser) {
        return NextResponse.json({ error: "User deleted" }, { status: 401 });
      }

      // Determine which projects to search
      const searchProjectIds = projectId
        ? [projectId]
        : tokenData.projectIds;  // Search ALL user's projects

      // Verify user still has AUTOTYPE access in at least one project
      const credMemberships = await prisma.projectMember.findMany({
        where: { userId: tokenData.userId, projectId: { in: searchProjectIds } },
      });
      const allowedProjectIds = credMemberships
        .filter((m) => m.role === "ADMIN" || ((m.allowedModules || []) as string[]).includes("AUTOTYPE"))
        .map((m) => m.projectId);

      if (allowedProjectIds.length === 0) {
        return NextResponse.json({ error: "AUTOTYPE permission revoked" }, { status: 403 });
      }

      // Find PayPalAccount — search across ALL allowed projects
      let paypalAccount = await prisma.payPalAccount.findFirst({
        where: {
          projectId: { in: allowedProjectIds },
          holder: { equals: holder, mode: "insensitive" },
          vmppCode: { equals: vmppCode, mode: "insensitive" },
        },
        include: {
          emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      });

      // Fallback 1: vmppCode contains the search value
      if (!paypalAccount) {
        paypalAccount = await prisma.payPalAccount.findFirst({
          where: {
            projectId: { in: allowedProjectIds },
            holder: { equals: holder, mode: "insensitive" },
            vmppCode: { contains: vmppCode, mode: "insensitive" },
          },
          include: {
            emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          },
        });
      }

      // Fallback 2: search by vmppCode only (holder might be stored differently)
      if (!paypalAccount) {
        paypalAccount = await prisma.payPalAccount.findFirst({
          where: {
            projectId: { in: allowedProjectIds },
            vmppCode: { contains: vmppCode, mode: "insensitive" },
          },
          include: {
            emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          },
        });
      }

      if (!paypalAccount) {
        // Debug: count total PPs across all allowed projects
        const total = await prisma.payPalAccount.count({ where: { projectId: { in: allowedProjectIds } } });
        const samples = await prisma.payPalAccount.findMany({
          where: { projectId: { in: allowedProjectIds } },
          select: { holder: true, vmppCode: true, code: true },
          take: 5,
        });
        const sampleStr = samples.map((s) => `${s.code}:holder=${s.holder},vmpp=${s.vmppCode}`).join("; ");
        return NextResponse.json(
          { error: `Khong tim thay PP voi holder="${holder}" vmpp="${vmppCode}". Tong ${total} PP. VD: ${sampleStr}` },
          { status: 404 }
        );
      }

      // Try to get credentials from PayPalEmail first (primary, or first available)
      const primaryEmail = paypalAccount.emails.find((e) => e.isPrimary);
      const firstEmail = paypalAccount.emails[0];
      const emailRecord = primaryEmail || firstEmail;

      let email: string | null = null;
      let password: string | null = null;
      let twoFa: string | null = null;
      let hotmailToken: string | null = null;

      if (emailRecord) {
        email = emailRecord.email;
        password = safeDecrypt(emailRecord.password);
        twoFa = safeDecrypt(emailRecord.twoFa);
        hotmailToken = safeDecrypt(emailRecord.hotmailToken);
      }

      // Fall back to legacy PayPalAccount fields if PayPalEmail has no credentials
      if (!email) {
        email = paypalAccount.primaryEmail;
      }
      if (!password) {
        password = safeDecrypt(paypalAccount.password);
      }
      if (!twoFa) {
        twoFa = safeDecrypt(paypalAccount.twoFa);
      }
      if (!hotmailToken) {
        hotmailToken = safeDecrypt(paypalAccount.hotmailToken);
      }

      // Lookup merge target (mail gộp) for this holder — search across allowed projects
      let mergeEmail: string | null = null;
      if (holder) {
        const mergeTarget = await prisma.holderMergeTarget.findFirst({
          where: {
            holder: holder.toLowerCase(),
            projectId: { in: allowedProjectIds },
          },
          include: { paypal: { select: { primaryEmail: true } } },
        });
        if (mergeTarget) {
          mergeEmail = mergeTarget.paypal.primaryEmail;
        }
      }

      return NextResponse.json({
        email,
        password,
        twoFa,
        hotmailToken,
        mergeEmail,
      });
    }

    // =====================
    // ACTION: validate — check if token still valid + user still has access
    // =====================
    if (action === "validate") {
      const { token, projectId, deviceId: valDeviceId } = body as { action: string; token: string; projectId: string; deviceId?: string };
      if (!token || !projectId) {
        return NextResponse.json({ error: "Missing token or projectId" }, { status: 400 });
      }
      const tokenData = verifyToken(token);
      if (!tokenData) {
        return NextResponse.json({ error: "Token expired" }, { status: 401 });
      }
      // Re-check user still has AUTOTYPE access
      const membership = await prisma.projectMember.findFirst({
        where: { userId: tokenData.userId, projectId },
      });
      if (!membership) {
        return NextResponse.json({ error: "Access revoked" }, { status: 403 });
      }
      if (membership.role !== "ADMIN") {
        const modules: string[] = membership.allowedModules || [];
        if (!modules.includes("AUTOTYPE")) {
          return NextResponse.json({ error: "AUTOTYPE permission revoked" }, { status: 403 });
        }
      }
      // Refresh session lastActiveAt
      if (valDeviceId) {
        await prisma.autotypeSession.updateMany({
          where: { userId: tokenData.userId, deviceId: valDeviceId },
          data: { lastActiveAt: new Date() },
        });
      }
      return NextResponse.json({ valid: true });
    }

    // =====================
    // ACTION: updatePassword — operator updates password from autotype app
    // =====================
    if (action === "updatePassword") {
      const { token, holder, vmppCode, newPassword, pin } = body as {
        action: string;
        token: string;
        holder: string;
        vmppCode: string;
        newPassword: string;
        pin: string;
      };

      if (!token || !holder || !vmppCode || !newPassword || !pin) {
        return NextResponse.json(
          { error: "Thieu thong tin (token, holder, vmppCode, newPassword, pin)" },
          { status: 400 }
        );
      }

      // Verify token
      const tokenData = verifyToken(token);
      if (!tokenData) {
        return NextResponse.json(
          { error: "Token het han, dang nhap lai" },
          { status: 401 }
        );
      }

      // Get user + verify PIN
      const updateUser = await prisma.user.findUnique({
        where: { id: tokenData.userId },
        select: { id: true, name: true, username: true, pin: true },
      });
      if (!updateUser) {
        return NextResponse.json({ error: "User deleted" }, { status: 401 });
      }
      if (!updateUser.pin) {
        return NextResponse.json({ error: "User chua co PIN" }, { status: 403 });
      }
      const pinValid = await bcrypt.compare(pin, updateUser.pin);
      if (!pinValid) {
        return NextResponse.json({ error: "Sai PIN" }, { status: 401 });
      }

      // Find PayPalAccount (same logic as credentials action)
      let paypal = await prisma.payPalAccount.findFirst({
        where: {
          projectId: { in: tokenData.projectIds },
          holder: { equals: holder, mode: "insensitive" },
          vmppCode: { equals: vmppCode, mode: "insensitive" },
        },
        include: {
          emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      });
      if (!paypal) {
        paypal = await prisma.payPalAccount.findFirst({
          where: {
            projectId: { in: tokenData.projectIds },
            holder: { equals: holder, mode: "insensitive" },
            vmppCode: { contains: vmppCode, mode: "insensitive" },
          },
          include: {
            emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          },
        });
      }
      if (!paypal) {
        paypal = await prisma.payPalAccount.findFirst({
          where: {
            projectId: { in: tokenData.projectIds },
            vmppCode: { contains: vmppCode, mode: "insensitive" },
          },
          include: {
            emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          },
        });
      }

      if (!paypal) {
        return NextResponse.json(
          { error: `Khong tim thay PP voi holder="${holder}" vmpp="${vmppCode}"` },
          { status: 404 }
        );
      }

      // Encrypt new password
      const encryptedPassword = encrypt(newPassword);

      // Update PayPalEmail (primary) if exists, otherwise update legacy PayPalAccount
      const primaryEmail = paypal.emails.find((e) => e.isPrimary);
      const firstEmail = paypal.emails[0];
      const emailRecord = primaryEmail || firstEmail;

      if (emailRecord) {
        await prisma.payPalEmail.update({
          where: { id: emailRecord.id },
          data: { password: encryptedPassword },
        });
      } else {
        // Legacy: update PayPalAccount.password directly
        await prisma.payPalAccount.update({
          where: { id: paypal.id },
          data: { password: encryptedPassword },
        });
      }

      return NextResponse.json({
        success: true,
        message: "Da cap nhat password",
      });
    }

    // =====================
    // ACTION: logout — remove device session
    // =====================
    if (action === "logout") {
      const { token, deviceId: logoutDeviceId } = body as { action: string; token: string; deviceId: string };
      if (!token || !logoutDeviceId) {
        return NextResponse.json({ error: "Missing token or deviceId" }, { status: 400 });
      }
      const tokenData = verifyToken(token);
      if (tokenData) {
        await prisma.autotypeSession.deleteMany({
          where: { userId: tokenData.userId, deviceId: logoutDeviceId },
        });
      }
      return NextResponse.json({ success: true });
    }

    // Unknown action
    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("[autotype] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
