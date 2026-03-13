import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import XLSX from "xlsx";
import path from "path";

const prisma = new PrismaClient();

// Excel serial date to JS Date
function excelDate(serial: number): Date {
  if (typeof serial !== "number" || serial < 40000) return new Date();
  return new Date((serial - 25569) * 86400 * 1000);
}

// Safe string extraction
function str(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  return String(val).trim();
}

// Safe number extraction
function num(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// Map Excel status string to VMStatus enum
function mapVMStatus(s: string): "OK" | "ERROR" | "NEW" | "NOT_CONNECTED" | "NOT_AVC" | "BLOCKED" | "SUSPENDED" {
  const upper = s.toUpperCase().trim();
  if (upper === "OK") return "OK";
  if (upper === "ERROR") return "ERROR";
  if (upper === "NOT_CONNECTED" || upper === "NOT CONNECTED") return "NOT_CONNECTED";
  if (upper === "NOT_AVC" || upper === "NOT AVC") return "NOT_AVC";
  if (upper === "BLOCKED") return "BLOCKED";
  if (upper === "SUSPENDED") return "SUSPENDED";
  return "NEW";
}

async function main() {
  console.log("Seeding database with ~3% real data from Excel...");

  const xlsxPath = path.resolve(__dirname, "../../Bright data AE 18+.xlsx");
  console.log(`Reading Excel file: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);

  // ═══════════════════════════════════════
  // 1. ADMIN USER
  // ═══════════════════════════════════════
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@bdops.com" },
    update: { password: hashedPassword },
    create: {
      email: "admin@bdops.com",
      name: "Admin",
      password: hashedPassword,
    },
  });
  console.log(`  Admin user: ${admin.email}`);

  // ═══════════════════════════════════════
  // 2. PROJECT
  // ═══════════════════════════════════════
  const projectAE = await prisma.project.upsert({
    where: { code: "AE" },
    update: {},
    create: {
      name: "Bright Data AE 18+",
      code: "AE",
      description: "Main team - AE project with 838+ VMs, 700+ PayPals",
    },
  });

  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: projectAE.id } },
    update: {},
    create: {
      userId: admin.id,
      projectId: projectAE.id,
      role: "ADMIN",
    },
  });
  console.log(`  Project: ${projectAE.name} (${projectAE.code})`);

  // ═══════════════════════════════════════
  // 3. VPS SHEET → Server (first 1 server)
  // ═══════════════════════════════════════
  const vpsSheet = XLSX.utils.sheet_to_json(wb.Sheets["VPS"], { header: 1, defval: "" }) as unknown[][];
  // Row 2 has the first server data: C3=server info (parse IP, name), C8=code, C6=cpu, C7=ram
  const vpsRow = vpsSheet[2];
  const serverCode = str(vpsRow[8]) || "SERVER-01";
  const serverInfo = str(vpsRow[3]);

  // Parse IP from server info text
  let serverIP = "";
  const ipMatch = serverInfo.match(/Server IP:\s*([\d.]+)/i);
  if (ipMatch) serverIP = ipMatch[1];

  // Parse inventory ID
  let inventoryId = "";
  const invMatch = serverInfo.match(/Inventory ID:\s*(\S+)/i);
  if (invMatch) inventoryId = invMatch[1];

  const server = await prisma.server.upsert({
    where: { code_projectId: { code: serverCode, projectId: projectAE.id } },
    update: {},
    create: {
      code: serverCode,
      ipAddress: serverIP || null,
      provider: "ColoCrossing",
      cpu: str(vpsRow[6]) || null,
      ram: str(vpsRow[7]) || null,
      status: "ACTIVE",
      inventoryId: inventoryId || null,
      notes: serverInfo.substring(0, 500) || null,
      projectId: projectAE.id,
    },
  });
  console.log(`  Server: ${server.code} (IP: ${server.ipAddress})`);

  // ═══════════════════════════════════════
  // 4. PP SHEET → PayPalAccount (first ~22 rows)
  // ═══════════════════════════════════════
  const ppSheet = XLSX.utils.sheet_to_json(wb.Sheets["PP"], { header: 1, defval: "" }) as unknown[][];
  // Data starts at row 3 (row 0=header group, row 1=column headers, row 2=summary)
  const ppDataRows = ppSheet.slice(3, 25); // 22 rows
  const paypalMap: Record<string, string> = {}; // code -> id

  let ppCount = 0;
  for (let i = 0; i < ppDataRows.length; i++) {
    const row = ppDataRows[i];
    const code = str(row[1]);
    if (!code) {
      console.warn(`  [PP] Skipping row ${i + 3}: no code`);
      continue;
    }

    const primaryEmail = str(row[3]);
    if (!primaryEmail) {
      console.warn(`  [PP] Skipping row ${i + 3} (${code}): no email`);
      continue;
    }

    // Determine role
    let role: "USDT" | "MASTER" | "NORMAL" = "NORMAL";
    if (code.startsWith("USDT")) {
      role = "USDT";
    } else if (i <= 1) {
      // First two data rows (USDT-01, PP_VietPhe) are special - but USDT already handled
      // PP_VietPhe is row index 1 → treat as MASTER
      role = "MASTER";
    }

    const pp = await prisma.payPalAccount.upsert({
      where: { code_projectId: { code, projectId: projectAE.id } },
      update: {},
      create: {
        code,
        primaryEmail: primaryEmail.split("\n")[0].trim(),
        secondaryEmail: primaryEmail.includes("\n") ? primaryEmail.split("\n")[1]?.trim() || null : null,
        bankCode: str(row[4]) || null,
        hotmailToken: str(row[5]) || null,
        company: str(row[7]) || "Bright Data Ltd.",
        serverAssignment: str(row[2]) || null,
        status: "ACTIVE",
        role,
        projectId: projectAE.id,
      },
    });
    paypalMap[code] = pp.id;
    ppCount++;
  }
  console.log(`  PayPal accounts: ${ppCount}`);

  // ═══════════════════════════════════════
  // 5. S1 SHEET → VirtualMachine + ProxyIP + GmailAccount (first ~25 rows)
  // ═══════════════════════════════════════
  const s1Sheet = XLSX.utils.sheet_to_json(wb.Sheets["S1"], { header: 1, defval: "" }) as unknown[][];
  // Row 0 = sheet title, Row 1 = headers, Data starts at row 2
  const s1DataRows = s1Sheet.slice(2, 27); // 25 rows

  let vmCount = 0;
  let proxyCount = 0;
  let gmailCount = 0;

  for (let i = 0; i < s1DataRows.length; i++) {
    const row = s1DataRows[i];
    const proxyAddress = str(row[1]);
    const vmCode = str(row[2]);
    const statusStr = str(row[3]);
    const sdkId = str(row[5]) || null;
    const gmailEmail = str(row[7]);
    const gmailPassword = str(row[8]);
    const recoveryEmail = str(row[9]);

    if (!vmCode) {
      console.warn(`  [S1] Skipping row ${i + 2}: no VM code`);
      continue;
    }

    // Create ProxyIP if address exists
    let proxyId: string | null = null;
    if (proxyAddress) {
      const parts = proxyAddress.split(":");
      const host = parts[0] || "";
      const port = parseInt(parts[1] || "0", 10);

      try {
        const proxy = await prisma.proxyIP.upsert({
          where: { address_projectId: { address: proxyAddress, projectId: projectAE.id } },
          update: {},
          create: {
            address: proxyAddress,
            host,
            port: port || null,
            status: "IN_USE",
            projectId: projectAE.id,
          },
        });
        proxyId = proxy.id;
        proxyCount++;
      } catch (err) {
        console.warn(`  [S1] Failed to create proxy for row ${i + 2}: ${err}`);
      }
    }

    // Create VM
    try {
      const vm = await prisma.virtualMachine.upsert({
        where: { code_serverId: { code: vmCode, serverId: server.id } },
        update: {},
        create: {
          code: vmCode,
          status: mapVMStatus(statusStr),
          sdkId,
          serverId: server.id,
          proxyId,
        },
      });
      vmCount++;

      // Create GmailAccount if email exists
      if (gmailEmail && gmailEmail.includes("@")) {
        try {
          const gmail = await prisma.gmailAccount.upsert({
            where: { email: gmailEmail },
            update: {},
            create: {
              email: gmailEmail,
              password: gmailPassword || null,
              recoveryEmail: recoveryEmail || null,
              status: "ACTIVE",
              projectId: projectAE.id,
            },
          });
          await prisma.virtualMachine.update({
            where: { id: vm.id },
            data: { gmailId: gmail.id },
          });
          gmailCount++;
        } catch (err) {
          console.warn(`  [S1] Failed to create gmail ${gmailEmail}: ${err}`);
        }
      }
    } catch (err) {
      console.warn(`  [S1] Failed to create VM ${vmCode}: ${err}`);
    }
  }
  console.log(`  VMs: ${vmCount}, Proxies: ${proxyCount}, Gmails: ${gmailCount}`);

  // ═══════════════════════════════════════
  // 6. FUND SHEET → FundTransaction (first ~54 rows)
  // ═══════════════════════════════════════
  const fundSheet = XLSX.utils.sheet_to_json(wb.Sheets["FUND"], { header: 1, defval: "" }) as unknown[][];
  // Row 0 = info, Row 1 = header group, Row 2 = column headers, Data starts at row 3
  const fundDataRows = fundSheet.slice(3, 57); // ~54 rows

  let fundCount = 0;
  for (let i = 0; i < fundDataRows.length; i++) {
    const row = fundDataRows[i];
    const dateSerial = num(row[0]);
    const ppCode = str(row[1]);
    const transactionId = str(row[8]);
    const amount = num(row[9]);
    const confirmed = row[11] === true || str(row[11]).toLowerCase() === "true";
    const company = str(row[7]) || "Bright Data Ltd.";

    if (!transactionId || amount <= 0) {
      console.warn(`  [FUND] Skipping row ${i + 3}: no txId or amount=0`);
      continue;
    }

    // Find the PayPal account
    let paypalId = paypalMap[ppCode];
    if (!paypalId) {
      // PayPal not in our imported set - create a minimal one
      try {
        const pp = await prisma.payPalAccount.upsert({
          where: { code_projectId: { code: ppCode, projectId: projectAE.id } },
          update: {},
          create: {
            code: ppCode,
            primaryEmail: `${ppCode.toLowerCase()}@unknown.com`,
            status: "ACTIVE",
            role: ppCode.startsWith("USDT") ? "USDT" : "NORMAL",
            company,
            projectId: projectAE.id,
          },
        });
        paypalId = pp.id;
        paypalMap[ppCode] = pp.id;
      } catch (err) {
        console.warn(`  [FUND] Failed to create PayPal ${ppCode}: ${err}`);
        continue;
      }
    }

    try {
      await prisma.fundTransaction.upsert({
        where: {
          transactionId_projectId: { transactionId, projectId: projectAE.id },
        },
        update: {},
        create: {
          date: excelDate(dateSerial),
          amount,
          transactionId,
          confirmed,
          company,
          paypalId,
          projectId: projectAE.id,
        },
      });
      fundCount++;
    } catch (err) {
      console.warn(`  [FUND] Failed to create fund tx ${transactionId}: ${err}`);
    }
  }
  console.log(`  Fund transactions: ${fundCount}`);

  // ═══════════════════════════════════════
  // 7. Rut PP SHEET → Withdrawal (first ~57 rows)
  // ═══════════════════════════════════════
  const rutSheet = XLSX.utils.sheet_to_json(wb.Sheets["Rút PP"], { header: 1, defval: "" }) as unknown[][];
  // Row 0 = links, Row 1 = header group, Row 2 = column headers, Data starts at row 3
  const rutDataRows = rutSheet.slice(3, 60); // ~57 rows

  let wdCount = 0;
  for (let i = 0; i < rutDataRows.length; i++) {
    const row = rutDataRows[i];
    const dateSerial = num(row[0]);
    const ppCode = str(row[1]);
    const transactionId = str(row[6]);
    const amount = num(row[7]);
    const ppReceivedCode = str(row[8]);
    const agent = str(row[10]);
    const withdrawCode = str(row[11]);

    if (!ppCode || amount <= 0) {
      console.warn(`  [Rut PP] Skipping row ${i + 3}: no code or amount=0`);
      continue;
    }

    // Determine type
    const type = agent.toUpperCase().includes("MIXING") ? "MIXING" : "EXCHANGE";

    // Find source PayPal
    let sourcePaypalId = paypalMap[ppCode];
    if (!sourcePaypalId) {
      try {
        const pp = await prisma.payPalAccount.upsert({
          where: { code_projectId: { code: ppCode, projectId: projectAE.id } },
          update: {},
          create: {
            code: ppCode,
            primaryEmail: `${ppCode.toLowerCase()}@unknown.com`,
            status: "ACTIVE",
            role: "NORMAL",
            company: "Bright Data Ltd.",
            projectId: projectAE.id,
          },
        });
        sourcePaypalId = pp.id;
        paypalMap[ppCode] = pp.id;
      } catch (err) {
        console.warn(`  [Rut PP] Failed to create PayPal ${ppCode}: ${err}`);
        continue;
      }
    }

    // Find dest PayPal if specified
    let destPaypalId: string | null = null;
    if (ppReceivedCode) {
      destPaypalId = paypalMap[ppReceivedCode] || null;
      if (!destPaypalId) {
        try {
          const destPP = await prisma.payPalAccount.upsert({
            where: { code_projectId: { code: ppReceivedCode, projectId: projectAE.id } },
            update: {},
            create: {
              code: ppReceivedCode,
              primaryEmail: `${ppReceivedCode.toLowerCase()}@unknown.com`,
              status: "ACTIVE",
              role: "NORMAL",
              company: "Bright Data Ltd.",
              projectId: projectAE.id,
            },
          });
          destPaypalId = destPP.id;
          paypalMap[ppReceivedCode] = destPP.id;
        } catch (err) {
          console.warn(`  [Rut PP] Failed to create dest PayPal ${ppReceivedCode}: ${err}`);
        }
      }
    }

    try {
      await prisma.withdrawal.create({
        data: {
          date: excelDate(dateSerial),
          amount,
          transactionId: transactionId || null,
          type,
          agent: agent || null,
          withdrawCode: withdrawCode || null,
          ppReceived: ppReceivedCode || null,
          sourcePaypalId,
          destPaypalId,
          projectId: projectAE.id,
        },
      });
      wdCount++;
    } catch (err) {
      console.warn(`  [Rut PP] Failed to create withdrawal row ${i + 3}: ${err}`);
    }
  }
  console.log(`  Withdrawals: ${wdCount}`);

  // ═══════════════════════════════════════
  // 8. Chi Phi SHEET → CostRecord (first ~3 rows)
  // ═══════════════════════════════════════
  const cpSheet = XLSX.utils.sheet_to_json(wb.Sheets["Chi Phí"], { header: 1, defval: "" }) as unknown[][];
  // Row 0 = headers, Data starts at row 1
  const cpDataRows = cpSheet.slice(1, 4); // 3 rows

  let costCount = 0;
  for (let i = 0; i < cpDataRows.length; i++) {
    const row = cpDataRows[i];
    const dateSerial = num(row[0]);
    const isPrepaid = row[1] === true || str(row[1]).toLowerCase() === "true";
    const serverCost = num(row[2]) || null;
    const ipCost = num(row[3]) || null;
    const extraCost = num(row[4]) || null;
    const total = num(row[5]);
    const note = str(row[6]) || null;

    if (total <= 0) {
      console.warn(`  [Chi Phi] Skipping row ${i + 1}: total=0`);
      continue;
    }

    try {
      await prisma.costRecord.create({
        data: {
          date: excelDate(dateSerial),
          serverCost,
          ipCost,
          extraCost,
          total,
          isPrepaid,
          note,
          projectId: projectAE.id,
        },
      });
      costCount++;
    } catch (err) {
      console.warn(`  [Chi Phi] Failed to create cost row ${i + 1}: ${err}`);
    }
  }
  console.log(`  Cost records: ${costCount}`);

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  console.log("\nSeed complete!");
  console.log(`  Project: AE (Bright Data AE 18+)`);
  console.log(`  Admin: admin@bdops.com / admin123`);
  console.log(`  Servers: 1`);
  console.log(`  PayPal accounts: ${Object.keys(paypalMap).length}`);
  console.log(`  VMs: ${vmCount}, Proxies: ${proxyCount}, Gmails: ${gmailCount}`);
  console.log(`  Fund transactions: ${fundCount}`);
  console.log(`  Withdrawals: ${wdCount}`);
  console.log(`  Cost records: ${costCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
