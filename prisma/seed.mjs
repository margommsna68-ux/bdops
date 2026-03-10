import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

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

  console.log("Seed complete!");
  console.log("  Admin: admin@bdops.com / admin123");
  console.log("  Projects: AE, DN");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
