# BDOps Expansion Brief — Multi-Project + Fund Exchange System

## Context

BDOps (Next.js 14 + Prisma + PostgreSQL, deployed on Railway) currently manages Bright Data proxy earning operations — VMs, PayPal accounts, teams. This brief describes an expansion to support **multi-project architecture** with a **fund exchange workflow**.

---

## 1. Multi-Project Architecture

### Project Types
- **Full project**: Bright Data VMs + PayPal account management (current BDOps functionality)
- **PayPal-only project**: Only PayPal account & fund management — no VM or Bright Data involvement. Someone else operates the BD/VM side; this project manages from PayPal onward.

### Core Rules
- Every data table must have `projectId` foreign key for tenant isolation.
- **A PayPal account belongs to exactly 1 project. NEVER shared across projects.** Enforce with unique constraint on `(paypalEmail, projectId)` or a global unique on PayPal identifier.
- A user (team member) can be assigned to **multiple projects** with separate roles/permissions per project.
- Only **admin** can create projects.
- Permission system already exists (feature-toggle based: tick a function → user sees that function). Reuse this for project-level feature visibility.
- When project type = `paypal-only`, hide all VM/Bright Data UI modules. Same codebase, conditional rendering based on `project.type`.

### Suggested Schema Changes
```prisma
model Project {
  id          String        @id @default(cuid())
  name        String
  type        ProjectType   // FULL | PAYPAL_ONLY
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  
  members     ProjectMember[]
  paypalAccounts PaypalAccount[]
  vms         VM[]           // only used when type = FULL
  transactions FundTransaction[]
  exchangers  Exchanger[]
}

enum ProjectType {
  FULL
  PAYPAL_ONLY
}

model ProjectMember {
  id        String   @id @default(cuid())
  userId    String
  projectId String
  role      String   // admin, member, exchanger, etc.
  
  user      User     @relation(fields: [userId], references: [id])
  project   Project  @relation(fields: [projectId], references: [id])
  
  @@unique([userId, projectId])
}
```

---

## 2. Fund Exchange Workflow

### The Money Flow
```
Bright Data earnings
  → PayPal balance (staff notes amount manually)
    → Sell to Exchanger (from 1 or multiple PayPal accounts)
      → Deduct: PayPal fee + Exchanger fee (3% default, custom per exchanger)
        → Net USD received
          → Option A: Exchanger converts to VND and pays back
          → Option B: Self-sell USD to VND at own rate
            → Final VND amount
```

### Exchanger Management
An **Exchanger** is an external or internal user who buys PayPal funds.

```prisma
model Exchanger {
  id            String   @id @default(cuid())
  projectId     String
  name          String
  feePercent    Float    @default(3.0)  // custom fee per exchanger
  currentBalance Float   @default(0)    // USD balance they are currently holding
  notes         String?
  createdAt     DateTime @default(now())
  
  project       Project  @relation(fields: [projectId], references: [id])
  transactions  FundTransaction[]
}
```

### Fund Transaction (sell to exchanger)
Each transaction records a sale of PayPal fund to an exchanger.

```prisma
model FundTransaction {
  id              String    @id @default(cuid())
  projectId       String
  exchangerId     String
  
  // Source: which PayPal account(s)
  paypalAccountIds String[] // 1 or multiple accounts
  
  // Amounts
  grossAmount     Float     // total PayPal balance being sold
  paypalFee       Float     // PayPal transfer fee
  exchangerFee    Float     // exchanger's fee (calculated from feePercent)
  netAmountUsd    Float     // actual USD received after all fees
  
  // VND conversion (optional — may be done later or by exchanger)
  vndRate         Float?    // USD→VND rate (internal, exchanger doesn't see)
  vndAmount       Float?    // final VND received
  vndMethod       VndMethod? // who converts: EXCHANGER_SELLS or SELF_SELL
  
  status          TransactionStatus @default(PENDING)
  notes           String?
  createdBy       String    // userId of staff who created this
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  project         Project   @relation(fields: [projectId], references: [id])
  exchanger       Exchanger @relation(fields: [exchangerId], references: [id])
}

enum VndMethod {
  EXCHANGER_SELLS  // exchanger handles USD→VND conversion
  SELF_SELL        // we sell USD to VND ourselves
}

enum TransactionStatus {
  PENDING
  COMPLETED
  CANCELLED
}
```

### Key Business Logic
1. **Creating a transaction**: Staff selects 1 or N PayPal accounts → enters gross amount → system calculates fees using exchanger's `feePercent` → shows net USD → staff confirms.
2. **Fee formula**: `netAmountUsd = grossAmount - paypalFee - (grossAmount * exchangerFeePercent / 100)`
3. **Exchanger balance tracking**: When transaction is created, `exchanger.currentBalance += netAmountUsd`. When exchanger pays out (VND or USD), balance decreases.
4. **VND conversion is optional & manual**: Staff notes the rate and VND amount. Exchanger NEVER sees the VND rate — they only see USD amounts.
5. **Sell from multiple accounts**: Transaction stores an array of PayPal account IDs. The UI should allow multi-select.

---

## 3. What Already Exists (CLI)

The CLI already has:
- PayPal account CRUD (create, list, balance tracking, limit/suspended status)
- Strict PayPal ↔ Project isolation
- Permission/feature-toggle system for users
- Team management basics

The web app (BDOps) needs to mirror and extend these capabilities with a proper UI.

---

## 4. Implementation Priority

1. **Database**: Add `Project` model, `ProjectMember`, migrate existing data to default project.
2. **Project switcher UI**: User sees only projects they're assigned to. Admin sees all.
3. **Exchanger CRUD**: Add/edit exchangers per project with custom fee.
4. **Fund transaction flow**: Create transaction → auto-calculate fees → track status → optional VND conversion.
5. **Dashboard updates**: Per-project dashboards showing total balance, pending transactions, exchanger balances.
6. **CLI sync**: Ensure CLI and web app share the same database and models.

---

## 5. Architecture Principles

- **project_id on everything** — no query ever runs without project scope
- **PayPal account uniqueness** — globally unique, never cross-project
- **Exchanger is project-scoped** — same person can be exchanger in multiple projects with different fees
- **VND data is internal only** — never exposed to exchanger role
- **Existing workflows untouched** — this is additive, not a rewrite
