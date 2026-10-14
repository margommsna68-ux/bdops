-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('FULL', 'PAYPAL_ONLY');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'MODERATOR', 'USER');

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('BUILDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "VMStatus" AS ENUM ('NEW', 'OK', 'ERROR', 'SUSPENDED', 'NOT_CONNECTED', 'NOT_AVC', 'BLOCKED');

-- CreateEnum
CREATE TYPE "EarnWithdrawalStatus" AS ENUM ('PENDING', 'WITHDRAWAL', 'PAID', 'SUSPEND', 'PP_LIMIT');

-- CreateEnum
CREATE TYPE "ProxyStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'BLOCKED', 'RESERVED');

-- CreateEnum
CREATE TYPE "GmailStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'NEEDS_RECOVERY', 'NEEDS_2FA_UPDATE', 'BLOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PayPalStatus" AS ENUM ('ACTIVE', 'LIMITED', 'SUSPENDED', 'CLOSED', 'PENDING_VERIFY');

-- CreateEnum
CREATE TYPE "PayPalRole" AS ENUM ('NORMAL', 'MASTER', 'USDT');

-- CreateEnum
CREATE TYPE "WithdrawalType" AS ENUM ('MIXING', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "VMTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeleteRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "password" TEXT,
    "pin" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "image" TEXT,
    "loginFailedCount" INTEGER NOT NULL DEFAULT 0,
    "loginLockedAt" TIMESTAMP(3),
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL DEFAULT 'FULL',
    "description" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'USER',
    "allowedModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canManageUsers" BOOLEAN NOT NULL DEFAULT false,
    "managerId" TEXT,
    "maxAutotypeDevices" INTEGER NOT NULL DEFAULT 2,
    "agentFeePercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ipAddress" TEXT,
    "netmask" TEXT,
    "gateway" TEXT,
    "allocation" TEXT,
    "provider" TEXT,
    "cpu" TEXT,
    "ram" TEXT,
    "status" "ServerStatus" NOT NULL DEFAULT 'BUILDING',
    "credentials" JSONB,
    "inventoryId" TEXT,
    "notes" TEXT,
    "gmailGroup" INTEGER NOT NULL DEFAULT 1,
    "monthlyCost" DECIMAL(12,2),
    "billingCycle" INTEGER DEFAULT 1,
    "createdDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "VMStatus" NOT NULL DEFAULT 'NEW',
    "sdkId" TEXT,
    "earnTotal" DECIMAL(12,4),
    "earn24h" DECIMAL(12,4),
    "uptime" TEXT,
    "notes" TEXT,
    "serverId" TEXT NOT NULL,
    "proxyId" TEXT,
    "gmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnWithdrawal" (
    "id" TEXT NOT NULL,
    "vmCodes" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "date" TIMESTAMP(3),
    "time" TEXT,
    "status" "EarnWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "round" INTEGER NOT NULL DEFAULT 1,
    "gmailId" TEXT NOT NULL,
    "paypalId" TEXT,
    "serverId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarnWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyIP" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "subnet" TEXT,
    "status" "ProxyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "outboundIP" TEXT,
    "blockReason" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyIP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyAssignmentHistory" (
    "id" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "reason" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "twoFaCurrent" TEXT,
    "twoFaOld" TEXT,
    "recoveryEmail" TEXT,
    "token" TEXT,
    "status" "GmailStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "paypalId" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPalAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "primaryEmail" TEXT NOT NULL,
    "secondaryEmail" TEXT,
    "password" TEXT,
    "twoFa" TEXT,
    "bankCode" TEXT,
    "hotmailToken" TEXT,
    "holder" TEXT,
    "vmppCode" TEXT,
    "status" "PayPalStatus" NOT NULL DEFAULT 'ACTIVE',
    "role" "PayPalRole" NOT NULL DEFAULT 'NORMAL',
    "limitNote" TEXT,
    "company" TEXT NOT NULL DEFAULT 'Bright Data Ltd.',
    "serverAssignment" TEXT,
    "notes" TEXT,
    "holderName" TEXT,
    "dateOfBirth" TEXT,
    "idNumber" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "docsLink" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "limitedAt" TIMESTAMP(3),
    "workflowStatus" TEXT,
    "caseHistory" JSONB,
    "tokenHealthStatus" TEXT,
    "tokenHealthCheckedAt" TIMESTAMP(3),
    "tokenHealthError" TEXT,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolderMergeTarget" (
    "id" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "paypalId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolderMergeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPalEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "twoFa" TEXT,
    "hotmailToken" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "paypalId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPalEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundTransaction" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionId" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "company" TEXT NOT NULL DEFAULT 'Bright Data Ltd.',
    "notes" TEXT,
    "paypalId" TEXT NOT NULL,
    "paypalEmailId" TEXT,
    "serverId" TEXT,
    "vmId" TEXT,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paypalFee" DECIMAL(12,2),
    "paypalFeeSetAt" TIMESTAMP(3),
    "collectorNote" TEXT,
    "paidToTeam" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "expenseId" TEXT,
    "transactionId" TEXT,
    "type" "WithdrawalType" NOT NULL,
    "agent" TEXT,
    "withdrawCode" TEXT,
    "ppReceived" TEXT,
    "mailConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sourcePaypalId" TEXT NOT NULL,
    "destPaypalId" TEXT,
    "agentUserId" TEXT,
    "agentEmailId" TEXT,
    "agentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "agentDisputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeNote" TEXT,
    "disputeResolved" BOOLEAN NOT NULL DEFAULT false,
    "disputeAction" TEXT,
    "adminResolveNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "serverCost" DECIMAL(12,2),
    "ipCost" DECIMAL(12,2),
    "extraCost" DECIMAL(12,2),
    "total" DECIMAL(12,2) NOT NULL,
    "isPrepaid" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "fundingSource" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSplit" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalWithdrawal" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "netProfit" DECIMAL(14,2) NOT NULL,
    "usdtRate" DECIMAL(10,4),
    "netProfitUsdt" DECIMAL(14,2),
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitAllocation" (
    "id" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountUsdt" DECIMAL(14,2),
    "note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "splitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMTask" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "VMTaskStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeleteRequest" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "reason" TEXT,
    "status" "DeleteRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPaypalEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPaypalEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSale" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "feePercent" DECIMAL(5,2),
    "paypalFee" DECIMAL(12,2),
    "netAmount" DECIMAL(12,2),
    "agentEarning" DECIMAL(12,2),
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    "transactionId" TEXT NOT NULL,
    "exchangeEmail" TEXT,
    "notes" TEXT,
    "agentUserId" TEXT NOT NULL,
    "agentEmailId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "referenceId" TEXT NOT NULL,
    "note" TEXT,
    "collectorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectorExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditHistory" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutotypeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutotypeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_userId_projectId_key" ON "ProjectMember"("userId", "projectId");

-- CreateIndex
CREATE INDEX "Server_projectId_idx" ON "Server"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Server_code_projectId_key" ON "Server"("code", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_proxyId_key" ON "VirtualMachine"("proxyId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_code_serverId_key" ON "VirtualMachine"("code", "serverId");

-- CreateIndex
CREATE INDEX "EarnWithdrawal_projectId_serverId_idx" ON "EarnWithdrawal"("projectId", "serverId");

-- CreateIndex
CREATE INDEX "EarnWithdrawal_gmailId_idx" ON "EarnWithdrawal"("gmailId");

-- CreateIndex
CREATE INDEX "ProxyIP_projectId_status_idx" ON "ProxyIP"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyIP_address_projectId_key" ON "ProxyIP"("address", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_email_key" ON "GmailAccount"("email");

-- CreateIndex
CREATE INDEX "GmailAccount_projectId_idx" ON "GmailAccount"("projectId");

-- CreateIndex
CREATE INDEX "PayPalAccount_projectId_status_idx" ON "PayPalAccount"("projectId", "status");

-- CreateIndex
CREATE INDEX "PayPalAccount_projectId_role_idx" ON "PayPalAccount"("projectId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalAccount_code_projectId_key" ON "PayPalAccount"("code", "projectId");

-- CreateIndex
CREATE INDEX "HolderMergeTarget_projectId_idx" ON "HolderMergeTarget"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "HolderMergeTarget_holder_projectId_key" ON "HolderMergeTarget"("holder", "projectId");

-- CreateIndex
CREATE INDEX "PayPalEmail_paypalId_idx" ON "PayPalEmail"("paypalId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalEmail_email_projectId_key" ON "PayPalEmail"("email", "projectId");

-- CreateIndex
CREATE INDEX "FundTransaction_projectId_date_idx" ON "FundTransaction"("projectId", "date");

-- CreateIndex
CREATE INDEX "FundTransaction_paypalId_idx" ON "FundTransaction"("paypalId");

-- CreateIndex
CREATE INDEX "FundTransaction_paypalEmailId_idx" ON "FundTransaction"("paypalEmailId");

-- CreateIndex
CREATE INDEX "FundTransaction_confirmed_idx" ON "FundTransaction"("confirmed");

-- CreateIndex
CREATE INDEX "FundTransaction_serverId_idx" ON "FundTransaction"("serverId");

-- CreateIndex
CREATE INDEX "FundTransaction_vmId_idx" ON "FundTransaction"("vmId");

-- CreateIndex
CREATE UNIQUE INDEX "FundTransaction_transactionId_projectId_key" ON "FundTransaction"("transactionId", "projectId");

-- CreateIndex
CREATE INDEX "Withdrawal_projectId_date_idx" ON "Withdrawal"("projectId", "date");

-- CreateIndex
CREATE INDEX "Withdrawal_projectId_type_idx" ON "Withdrawal"("projectId", "type");

-- CreateIndex
CREATE INDEX "Withdrawal_sourcePaypalId_idx" ON "Withdrawal"("sourcePaypalId");

-- CreateIndex
CREATE INDEX "Withdrawal_agentUserId_idx" ON "Withdrawal"("agentUserId");

-- CreateIndex
CREATE INDEX "CostRecord_projectId_date_idx" ON "CostRecord"("projectId", "date");

-- CreateIndex
CREATE INDEX "Partner_projectId_idx" ON "Partner"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_name_projectId_key" ON "Partner"("name", "projectId");

-- CreateIndex
CREATE INDEX "DeleteRequest_projectId_status_idx" ON "DeleteRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "DeleteRequest_entity_entityId_idx" ON "DeleteRequest"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");

-- CreateIndex
CREATE INDEX "AgentPaypalEmail_userId_idx" ON "AgentPaypalEmail"("userId");

-- CreateIndex
CREATE INDEX "AgentPaypalEmail_projectId_idx" ON "AgentPaypalEmail"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPaypalEmail_email_projectId_key" ON "AgentPaypalEmail"("email", "projectId");

-- CreateIndex
CREATE INDEX "AgentSale_agentUserId_idx" ON "AgentSale"("agentUserId");

-- CreateIndex
CREATE INDEX "AgentSale_agentEmailId_idx" ON "AgentSale"("agentEmailId");

-- CreateIndex
CREATE INDEX "AgentSale_projectId_idx" ON "AgentSale"("projectId");

-- CreateIndex
CREATE INDEX "CollectorExpense_collectorId_date_idx" ON "CollectorExpense"("collectorId", "date");

-- CreateIndex
CREATE INDEX "CollectorExpense_projectId_idx" ON "CollectorExpense"("projectId");

-- CreateIndex
CREATE INDEX "EditHistory_entityId_entity_idx" ON "EditHistory"("entityId", "entity");

-- CreateIndex
CREATE INDEX "EditHistory_projectId_createdAt_idx" ON "EditHistory"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EditHistory_userId_idx" ON "EditHistory"("userId");

-- CreateIndex
CREATE INDEX "AutotypeSession_userId_idx" ON "AutotypeSession"("userId");

-- CreateIndex
CREATE INDEX "AutotypeSession_lastActiveAt_idx" ON "AutotypeSession"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutotypeSession_userId_deviceId_key" ON "AutotypeSession"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "ProxyIP"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_gmailId_fkey" FOREIGN KEY ("gmailId") REFERENCES "GmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnWithdrawal" ADD CONSTRAINT "EarnWithdrawal_gmailId_fkey" FOREIGN KEY ("gmailId") REFERENCES "GmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnWithdrawal" ADD CONSTRAINT "EarnWithdrawal_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnWithdrawal" ADD CONSTRAINT "EarnWithdrawal_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnWithdrawal" ADD CONSTRAINT "EarnWithdrawal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyIP" ADD CONSTRAINT "ProxyIP_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAssignmentHistory" ADD CONSTRAINT "ProxyAssignmentHistory_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "ProxyIP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAssignmentHistory" ADD CONSTRAINT "ProxyAssignmentHistory_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyAssignmentHistory" ADD CONSTRAINT "ProxyAssignmentHistory_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalAccount" ADD CONSTRAINT "PayPalAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolderMergeTarget" ADD CONSTRAINT "HolderMergeTarget_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolderMergeTarget" ADD CONSTRAINT "HolderMergeTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalEmail" ADD CONSTRAINT "PayPalEmail_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalEmail" ADD CONSTRAINT "PayPalEmail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_paypalEmailId_fkey" FOREIGN KEY ("paypalEmailId") REFERENCES "PayPalEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "CollectorExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_sourcePaypalId_fkey" FOREIGN KEY ("sourcePaypalId") REFERENCES "PayPalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_destPaypalId_fkey" FOREIGN KEY ("destPaypalId") REFERENCES "PayPalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_agentEmailId_fkey" FOREIGN KEY ("agentEmailId") REFERENCES "AgentPaypalEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSplit" ADD CONSTRAINT "ProfitSplit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitAllocation" ADD CONSTRAINT "SplitAllocation_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "ProfitSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMTask" ADD CONSTRAINT "VMTask_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMTask" ADD CONSTRAINT "VMTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPaypalEmail" ADD CONSTRAINT "AgentPaypalEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPaypalEmail" ADD CONSTRAINT "AgentPaypalEmail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSale" ADD CONSTRAINT "AgentSale_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSale" ADD CONSTRAINT "AgentSale_agentEmailId_fkey" FOREIGN KEY ("agentEmailId") REFERENCES "AgentPaypalEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSale" ADD CONSTRAINT "AgentSale_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorExpense" ADD CONSTRAINT "CollectorExpense_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorExpense" ADD CONSTRAINT "CollectorExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
