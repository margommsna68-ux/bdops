import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@bdops.local" },
    update: {},
    create: {
      email: "admin@bdops.local",
      name: "Admin",
    },
  });

  // Create projects
  const projectAE = await prisma.project.upsert({
    where: { code: "AE" },
    update: {},
    create: {
      name: "Bright Data AE",
      code: "AE",
      description: "Main team - 838+ VMs, 400+ PayPals",
    },
  });

  const projectDN = await prisma.project.upsert({
    where: { code: "DN" },
    update: {},
    create: {
      name: "Bright Data Da Nang",
      code: "DN",
      description: "Da Nang team - 350+ VMs, 300+ PayPals",
    },
  });

  // Add admin to both projects
  for (const project of [projectAE, projectDN]) {
    await prisma.projectMember.upsert({
      where: { userId_projectId: { userId: admin.id, projectId: project.id } },
      update: {},
      create: {
        userId: admin.id,
        projectId: project.id,
        role: "ADMIN",
      },
    });
  }

  // === AE Project Sample Data (5%) ===

  // Servers (3 of 19)
  const servers = await Promise.all([
    prisma.server.upsert({
      where: { code_projectId: { code: "SERVER-01", projectId: projectAE.id } },
      update: {},
      create: {
        code: "SERVER-01",
        ipAddress: "192.168.1.10",
        provider: "ColoCrossing",
        cpu: "4 Cores - 8 Threads",
        ram: "32 GB",
        status: "ACTIVE",
        projectId: projectAE.id,
      },
    }),
    prisma.server.upsert({
      where: { code_projectId: { code: "SERVER-02", projectId: projectAE.id } },
      update: {},
      create: {
        code: "SERVER-02",
        ipAddress: "192.168.1.11",
        provider: "ColoCrossing",
        cpu: "8 Cores - 16 Threads",
        ram: "64 GB",
        status: "ACTIVE",
        projectId: projectAE.id,
      },
    }),
    prisma.server.upsert({
      where: { code_projectId: { code: "SERVER-03", projectId: projectAE.id } },
      update: {},
      create: {
        code: "SERVER-03",
        ipAddress: "192.168.1.12",
        provider: "Google Cloud",
        cpu: "4 Cores",
        ram: "16 GB",
        status: "MAINTENANCE",
        projectId: projectAE.id,
      },
    }),
  ]);

  // VMs (20 of 838)
  const vms = [];
  for (let i = 1; i <= 20; i++) {
    const serverIdx = i <= 8 ? 0 : i <= 15 ? 1 : 2;
    const statuses = ["OK", "OK", "OK", "OK", "ERROR", "NOT_CONNECTED", "BLOCKED"] as const;
    const vm = await prisma.virtualMachine.upsert({
      where: {
        code_serverId: { code: `M-${String(i).padStart(3, "0")}`, serverId: servers[serverIdx].id },
      },
      update: {},
      create: {
        code: `M-${String(i).padStart(3, "0")}`,
        status: statuses[i % statuses.length],
        sdkId: `sdk-win-${Math.random().toString(36).slice(2, 18)}`,
        earnTotal: parseFloat((Math.random() * 100 + 10).toFixed(4)),
        earn24h: parseFloat((Math.random() * 5).toFixed(4)),
        uptime: `${Math.floor(Math.random() * 24)}h ${Math.floor(Math.random() * 60)}m`,
        serverId: servers[serverIdx].id,
      },
    });
    vms.push(vm);
  }

  // Proxy IPs (20 of 5000)
  for (let i = 0; i < 20; i++) {
    const host = `23.142.${16 + Math.floor(i / 5)}.${70 + i}`;
    const port = 40100 + i;
    const proxy = await prisma.proxyIP.upsert({
      where: {
        address_projectId: {
          address: `${host}:${port}:kenan:${Math.random().toString(36).slice(2, 12)}`,
          projectId: projectAE.id,
        },
      },
      update: {},
      create: {
        address: `${host}:${port}:kenan:${Math.random().toString(36).slice(2, 12)}`,
        host,
        port,
        subnet: `Subnet ${String(Math.floor(i / 5) + 1).padStart(2, "0")}`,
        status: i < 20 ? "IN_USE" : "AVAILABLE",
        projectId: projectAE.id,
      },
    });

    // Assign proxy to VM
    if (i < vms.length) {
      await prisma.virtualMachine.update({
        where: { id: vms[i].id },
        data: { proxyId: proxy.id },
      });
    }
  }

  // PayPal Accounts (20 of 400)
  const paypals = [];
  for (let i = 1; i <= 20; i++) {
    const statuses = ["ACTIVE", "ACTIVE", "ACTIVE", "LIMITED", "SUSPENDED"] as const;
    const roles = i <= 2 ? "MASTER" as const : "NORMAL" as const;
    const pp = await prisma.payPalAccount.upsert({
      where: {
        code_projectId: { code: `AE-${String(i).padStart(3, "0")}`, projectId: projectAE.id },
      },
      update: {},
      create: {
        code: `AE-${String(i).padStart(3, "0")}`,
        primaryEmail: `ae.account${i}@gmail.com`,
        secondaryEmail: i % 3 === 0 ? `ae.backup${i}@hotmail.com` : null,
        bankCode: `PP-VN${100 + i}`,
        status: statuses[i % statuses.length],
        role: roles,
        limitNote: statuses[i % statuses.length] === "LIMITED"
          ? `limit (${Math.floor(Math.random() * 30)}/1) - ~$${Math.floor(Math.random() * 200)} - 180 days`
          : null,
        company: "Bright Data Ltd.",
        serverAssignment: `Server${(i % 3) + 1}`,
        projectId: projectAE.id,
      },
    });
    paypals.push(pp);
  }

  // Fund Transactions (50 of ~1000)
  for (let i = 0; i < 50; i++) {
    const pp = paypals[i % paypals.length];
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const amount = parseFloat((Math.random() * 20 + 5).toFixed(2));

    await prisma.fundTransaction.upsert({
      where: {
        transactionId_projectId: {
          transactionId: `TX-AE-${String(i + 1).padStart(5, "0")}`,
          projectId: projectAE.id,
        },
      },
      update: {},
      create: {
        date,
        amount,
        transactionId: `TX-AE-${String(i + 1).padStart(5, "0")}`,
        confirmed: Math.random() > 0.2,
        company: "Bright Data Ltd.",
        paypalId: pp.id,
        projectId: projectAE.id,
      },
    });
  }

  // Withdrawals (15 sample) - skip if already seeded
  const existingWithdrawals = await prisma.withdrawal.count({ where: { projectId: projectAE.id } });
  if (existingWithdrawals === 0) {
    for (let i = 0; i < 15; i++) {
      const isMixing = i < 10;
      const sourcePP = isMixing ? paypals[i + 2] : paypals[0]; // normal PPs for mixing, master for exchange
      const daysAgo = Math.floor(Math.random() * 30);
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);

      await prisma.withdrawal.create({
        data: {
          date,
          amount: parseFloat((Math.random() * 50 + 10).toFixed(2)),
          type: isMixing ? "MIXING" : "EXCHANGE",
          agent: !isMixing ? ["PP_VP", "ACE", "Marua", "Direct"][i % 4] : null,
          withdrawCode: isMixing
            ? `MIXING-${String(i).padStart(3, "0")}U`
            : `ACE-${String(i).padStart(3, "0")}N`,
          mailConfirmed: Math.random() > 0.3,
          sourcePaypalId: sourcePP.id,
          destPaypalId: isMixing ? paypals[0].id : null, // master PP
          projectId: projectAE.id,
        },
      });
    }
  } else {
    console.log(`  Skipping withdrawals (${existingWithdrawals} already exist)`);
  }

  // Cost Records (3 months) - skip if already seeded
  const existingCosts = await prisma.costRecord.count({ where: { projectId: projectAE.id } });
  if (existingCosts === 0) {
    for (let m = 0; m < 3; m++) {
      const date = new Date();
      date.setMonth(date.getMonth() - m);
      date.setDate(1);

      await prisma.costRecord.create({
        data: {
          date,
          serverCost: 2470,
          ipCost: 1250,
          extraCost: parseFloat((Math.random() * 500).toFixed(2)),
          total: parseFloat((2470 + 1250 + Math.random() * 500).toFixed(2)),
          isPrepaid: m === 0,
          note: m === 0 ? "Prepaid for current month" : null,
          fundingSource: "Marua withdrawal",
          projectId: projectAE.id,
        },
      });
    }
  } else {
    console.log(`  Skipping costs (${existingCosts} already exist)`);
  }

  // === DN Project Sample Data (smaller) ===
  const serverDN = await prisma.server.upsert({
    where: { code_projectId: { code: "SV-01", projectId: projectDN.id } },
    update: {},
    create: {
      code: "SV-01",
      ipAddress: "10.0.1.10",
      provider: "ColoCrossing",
      cpu: "4 Cores",
      ram: "32 GB",
      status: "ACTIVE",
      projectId: projectDN.id,
    },
  });

  // 5 PPs for DN
  const ppsDN = [];
  for (let i = 1; i <= 5; i++) {
    const pp = await prisma.payPalAccount.upsert({
      where: { code_projectId: { code: `PP-${String(i).padStart(3, "0")}`, projectId: projectDN.id } },
      update: {},
      create: {
        code: `PP-${String(i).padStart(3, "0")}`,
        primaryEmail: `dn.account${i}@gmail.com`,
        status: i === 4 ? "LIMITED" : "ACTIVE",
        role: i === 1 ? "MASTER" : "NORMAL",
        company: "Bright Data Ltd.",
        projectId: projectDN.id,
      },
    });
    ppsDN.push(pp);
  }

  // 10 Funds for DN
  for (let i = 0; i < 10; i++) {
    const pp = ppsDN[i % ppsDN.length];
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30));
    await prisma.fundTransaction.upsert({
      where: {
        transactionId_projectId: {
          transactionId: `TX-DN-${String(i + 1).padStart(5, "0")}`,
          projectId: projectDN.id,
        },
      },
      update: {},
      create: {
        date,
        amount: parseFloat((Math.random() * 15 + 5).toFixed(2)),
        transactionId: `TX-DN-${String(i + 1).padStart(5, "0")}`,
        confirmed: Math.random() > 0.3,
        company: "Bright Data Ltd.",
        paypalId: pp.id,
        projectId: projectDN.id,
      },
    });
  }

  console.log("Seed complete!");
  console.log(`  Projects: AE, DN`);
  console.log(`  Admin user: admin@bdops.local`);
  console.log(`  AE: 3 servers, 20 VMs, 20 proxies, 20 PPs, 50 funds, 15 withdrawals, 3 costs`);
  console.log(`  DN: 1 server, 5 PPs, 10 funds`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
