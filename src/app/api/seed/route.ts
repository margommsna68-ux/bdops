import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // ═══ 1. Create Admin User ═══
    const hashedPw = await bcrypt.hash("admin123", 10);
    const admin = await prisma.user.upsert({
      where: { email: "admin@bdops.com" },
      update: { username: "admin" },
      create: { email: "admin@bdops.com", username: "admin", name: "Admin", password: hashedPw },
    });

    // ═══ 2. Create Project ═══
    const project = await prisma.project.upsert({
      where: { code: "AE" },
      update: {},
      create: { name: "Bright Data AE", code: "AE", description: "Main AE team" },
    });

    // ═══ 3. Add Admin as member ═══
    await prisma.projectMember.upsert({
      where: { userId_projectId: { userId: admin.id, projectId: project.id } },
      update: { role: "ADMIN" },
      create: { userId: admin.id, projectId: project.id, role: "ADMIN", allowedModules: [] },
    });

    const pid = project.id;

    // ═══ 4. Create 3 Servers ═══
    const servers = [];
    const serverData = [
      { code: "S1", ipAddress: "107.172.249.42", provider: "ColoCrossing", cpu: "E3-1270v6 32GB", ram: "32 GB", status: "ACTIVE" as const },
      { code: "S2", ipAddress: "192.210.207.88", provider: "ColoCrossing", cpu: "E3-1270v6 64GB", ram: "64 GB", status: "ACTIVE" as const },
      { code: "S3", ipAddress: "23.94.137.201", provider: "ColoCrossing", cpu: "E5-2680v4 128GB", ram: "128 GB", status: "BUILDING" as const },
    ];

    for (const sd of serverData) {
      const s = await prisma.server.upsert({
        where: { code_projectId: { code: sd.code, projectId: pid } },
        update: {},
        create: {
          ...sd,
          projectId: pid,
          credentials: encrypt(JSON.stringify({
            users: [
              { username: "root", password: "R00t$ecure!", role: "root" },
              { username: "bdops", password: "Bd0ps@2026", role: "admin" },
            ],
          })),
          createdDate: new Date("2025-06-01"),
          expiryDate: new Date("2026-06-01"),
        },
      });
      servers.push(s);
    }

    // ═══ 5. Create PayPal accounts (10) ═══
    const paypals = [];
    const ppData = [
      { code: "PP-001", primaryEmail: "business01@outlook.com", role: "NORMAL" as const, status: "ACTIVE" as const },
      { code: "PP-002", primaryEmail: "business02@outlook.com", role: "NORMAL" as const, status: "ACTIVE" as const },
      { code: "PP-003", primaryEmail: "business03@outlook.com", role: "NORMAL" as const, status: "ACTIVE" as const },
      { code: "PP-004", primaryEmail: "business04@outlook.com", role: "NORMAL" as const, status: "LIMITED" as const, limitNote: "Need verify ID" },
      { code: "PP-005", primaryEmail: "business05@outlook.com", role: "NORMAL" as const, status: "ACTIVE" as const },
      { code: "PP-006", primaryEmail: "business06@outlook.com", role: "NORMAL" as const, status: "ACTIVE" as const },
      { code: "PP-007", primaryEmail: "business07@outlook.com", role: "NORMAL" as const, status: "SUSPENDED" as const },
      { code: "PP-008", primaryEmail: "master01@outlook.com", role: "MASTER" as const, status: "ACTIVE" as const },
      { code: "PP-009", primaryEmail: "master02@outlook.com", role: "MASTER" as const, status: "ACTIVE" as const },
      { code: "PP-010", primaryEmail: "usdt01@outlook.com", role: "USDT" as const, status: "ACTIVE" as const },
    ];

    for (const pp of ppData) {
      const p = await prisma.payPalAccount.upsert({
        where: { code_projectId: { code: pp.code, projectId: pid } },
        update: {},
        create: { ...pp, projectId: pid, company: "Bright Data Ltd." },
      });
      paypals.push(p);
    }

    // ═══ 6. Create Proxies (30 for S1, 20 for S2) ═══
    const proxies = [];
    const proxyBase = [
      // S1 proxies (30)
      ...Array.from({ length: 30 }, (_, i) => ({
        address: `23.142.16.${73 + i}:44998:kenan:h5c9v2p7q4g`,
        host: `23.142.16.${73 + i}`,
        port: 44998,
        subnet: "23.142.16.0/24",
      })),
      // S2 proxies (20)
      ...Array.from({ length: 20 }, (_, i) => ({
        address: `45.61.170.${10 + i}:55123:proxy:x8k2m4p9`,
        host: `45.61.170.${10 + i}`,
        port: 55123,
        subnet: "45.61.170.0/24",
      })),
    ];

    for (const px of proxyBase) {
      try {
        const p = await prisma.proxyIP.create({
          data: { ...px, status: "AVAILABLE", projectId: pid },
        });
        proxies.push(p);
      } catch {
        // Skip duplicates
        const p = await prisma.proxyIP.findFirst({
          where: { address: px.address, projectId: pid },
        });
        if (p) proxies.push(p);
      }
    }

    // ═══ 7. Create VMs for S1 (30) and S2 (20) ═══
    const allVms: any[] = [];
    const vmStatuses = ["OK", "OK", "OK", "OK", "OK", "OK", "SUSPENDED", "ERROR", "NOT_CONNECTED", "OK"] as const;

    for (let i = 1; i <= 30; i++) {
      const code = `M-${String(i).padStart(3, "0")}`;
      try {
        const vm = await prisma.virtualMachine.create({
          data: {
            code,
            serverId: servers[0].id,
            status: vmStatuses[i % vmStatuses.length],
            sdkId: i <= 20 ? `sdk_ae_s1_${String(i).padStart(3, "0")}` : null,
            earnTotal: Math.random() * 50,
            earn24h: Math.random() * 2,
            proxyId: proxies[i - 1]?.id ?? null,
          },
        });
        allVms.push(vm);
      } catch {
        const vm = await prisma.virtualMachine.findFirst({ where: { code, serverId: servers[0].id } });
        if (vm) allVms.push(vm);
      }
    }

    // Update used proxies to IN_USE
    for (let i = 0; i < 30; i++) {
      if (proxies[i]) {
        await prisma.proxyIP.update({ where: { id: proxies[i].id }, data: { status: "IN_USE" } }).catch(() => {});
      }
    }

    for (let i = 1; i <= 20; i++) {
      const code = `M-${String(i).padStart(3, "0")}`;
      try {
        const vm = await prisma.virtualMachine.create({
          data: {
            code,
            serverId: servers[1].id,
            status: vmStatuses[i % vmStatuses.length],
            sdkId: `sdk_ae_s2_${String(i).padStart(3, "0")}`,
            earnTotal: Math.random() * 30,
            earn24h: Math.random() * 1.5,
            proxyId: proxies[30 + i - 1]?.id ?? null,
          },
        });
        allVms.push(vm);
      } catch {
        const vm = await prisma.virtualMachine.findFirst({ where: { code, serverId: servers[1].id } });
        if (vm) allVms.push(vm);
      }
    }

    for (let i = 30; i < 50; i++) {
      if (proxies[i]) {
        await prisma.proxyIP.update({ where: { id: proxies[i].id }, data: { status: "IN_USE" } }).catch(() => {});
      }
    }

    // ═══ 8. Create Gmail accounts (30 for S1 VMs, 20 for S2 VMs) ═══
    const gmailDomains = ["gmail.com"];
    const gmailNames = [
      "nguyenvana", "tranthib", "levanc", "phamthid", "hoange",
      "dangvanf", "vuquangg", "buithih", "ngothii", "dothij",
      "luongvank", "trinhthil", "maivam", "phanthin", "caovano",
      "lydinhp", "haquangq", "sonvanr", "trangs", "viet",
      "hoangt", "minhu", "ducv", "namw", "tunx",
      "longy", "quanz", "binhaa", "tuanbb", "hungcc",
      "thanhdd", "phucee", "daiff", "songg", "lamhh",
      "khoaii", "binjj", "taikk", "huyll", "quymm",
      "annnn", "baooo", "congpp", "datqq", "emrr",
      "fangss", "giatt", "haiuu", "inhvv", "kimww",
    ];

    for (let i = 0; i < allVms.length && i < gmailNames.length; i++) {
      const email = `${gmailNames[i]}2025bd@${gmailDomains[0]}`;
      const ppIndex = i % paypals.length;
      try {
        const gmail = await prisma.gmailAccount.create({
          data: {
            email,
            password: encrypt("GmailP@ss2026!"),
            twoFaCurrent: encrypt("abcd efgh ijkl mnop"),
            recoveryEmail: `${gmailNames[i]}.recovery@yahoo.com`,
            status: i % 8 === 7 ? "NEEDS_2FA_UPDATE" : i % 12 === 11 ? "SUSPENDED" : "ACTIVE",
            paypalId: paypals[ppIndex].id,
            projectId: pid,
          },
        });
        await prisma.virtualMachine.update({
          where: { id: allVms[i].id },
          data: { gmailId: gmail.id },
        });
      } catch {
        // Skip duplicates
      }
    }

    // ═══ 9. Some unassigned gmails (pool) ═══
    for (let i = 0; i < 10; i++) {
      const email = `pool.account${i + 1}@gmail.com`;
      try {
        await prisma.gmailAccount.create({
          data: {
            email,
            password: encrypt("Pool$Pass2026"),
            recoveryEmail: `pool.recovery${i + 1}@yahoo.com`,
            status: "ACTIVE",
            projectId: pid,
          },
        });
      } catch {
        // Skip duplicates
      }
    }

    // ═══ 10. Some unassigned proxies (available pool) ═══
    for (let i = 0; i < 10; i++) {
      try {
        await prisma.proxyIP.create({
          data: {
            address: `198.23.145.${50 + i}:33080:spare:p4ssw0rd`,
            host: `198.23.145.${50 + i}`,
            port: 33080,
            subnet: "198.23.145.0/24",
            status: "AVAILABLE",
            projectId: pid,
          },
        });
      } catch {
        // Skip duplicates
      }
    }

    return NextResponse.json({
      success: true,
      message: "Demo data seeded!",
      stats: {
        admin: "admin@bdops.com / admin123",
        project: project.code,
        servers: servers.length,
        vms: allVms.length,
        proxies: proxies.length + 10,
        paypals: paypals.length,
        gmails: `${allVms.length} assigned + 10 pool`,
      },
    });
  } catch (error: any) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
