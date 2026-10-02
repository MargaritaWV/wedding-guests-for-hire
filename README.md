# Friends Included Finance System

This repository contains the working Stage 2 website for the Day 4 managerial accounting homework. Supabase is the source of truth; Telegram and the website share one server-side transaction processor; Google Sheets will later become a synchronized readable copy.

## Current architecture

- **Next.js with TypeScript:** one Vercel-compatible application for the website, server routes, webhook, and background retry endpoints.
- **Supabase PostgreSQL:** authoritative employees, transactions, decisions, delivery state, and financial data.
- **Telegram Bot API:** direct server-side HTTPS calls, with the original bot chat retained on Telegram submissions.
- **Google Sheets API:** a server-only adapter will upsert one row per reference into `Sales` or `Expenses`.
- **Zod and pure domain functions:** shared validation, permissions, commission rounding, and financial calculations used by every entry channel.

Browser code will never receive the Supabase service-role key, Telegram bot token, or Google service-account private key. Database tables have row-level security enabled without browser policies; the server is the only intended data access path.

## Run locally

Requirements: Node.js 20.9 or newer and pnpm.

```text
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Choose a demonstration role to enter transactions or use Svetlana's manager and dashboard areas. The page verifies the Supabase connection, but does not claim Telegram or Google Sheets work before those services are genuinely configured.

Quality checks:

```text
pnpm check
pnpm build
```

## Important files

- `docs/ASSIGNMENT_REQUIREMENTS.md` — complete structured reading of the homework specification.
- `docs/IMPLEMENTATION_PLAN.md` — architecture decisions and the remaining large milestones.
- `supabase/migrations/202609270001_initial_finance_schema.sql` — proposed source-of-truth schema.
- `src/domain` — reusable validation, permissions, commission, and financial calculations.
- `src/application/transaction-processor.ts` — the common website and Telegram processing boundary.
- `src/integrations` — honest server-side integration boundaries and configuration checks.
- `.env.example` — placeholders only; never put real secrets in this file.

## Stage 2 progress

### Completed

- The website verifies and uses the real Supabase database through server-only code.
- The required five-person demonstration role selector is active.
- Salespeople can submit pending sales with proposed commission splits.
- Kevin can submit expenses; company overhead is automatic and project proposals await allocation.
- Svetlana can approve or correct splits and allocations without duplicating financial effects.
- Sales and expense records keep the original proposal separate from the final decision.
- The dashboard calculates project results, company results, overhead, awaiting expenses, and individual commissions from stored records.
- Shared validation, permissions, commission rounding, and calculations remain in the common transaction processor for the future website and Telegram channels.
- Unit tests use isolated data. A separate live smoke test verified write, reread, decision, persistence, and cleanup using only temporary `TMP_STAGE2` references.

### Database and schema

The existing initial migration already supports Stage 2. No additional migration, reset, table deletion, or schema recreation was needed. The live smoke-test records and related jobs were removed after verification.

### Remaining work

- Stage 3+: create and connect the real Telegram bot, employee linking, real notifications, and retry delivery.
- Stage 3+: connect a Google service account and spreadsheet, then implement reference-based row upserts and retries.
- Final stage: deploy to Vercel, complete the submission links/instructions, and run the official Telegram-dependent Test 1 and Test 2 demonstrations.

### Known bugs

None known at the Stage 2 checkpoint.

### Exact next step

From normal Windows PowerShell in this project folder, run `corepack pnpm dev`, open `http://localhost:3000`, and choose a demonstration role. Use non-official practice references if you want to explore before the instructor's Test 1 and Test 2 records are entered.

## External setup state

Supabase is connected and verified. The real Telegram bot token is verified, but the webhook is not active until a public Vercel URL exists. Google Sheets remains intentionally unconfigured.

## Stage 3 progress

### Completed Telegram work

- Added a secure Telegram webhook route that validates Telegram's secret-token header.
- Added `/start`, `/help`, `/sale`, and `/expense` using a simple stateless message format suitable for Vercel.
- Telegram users are resolved only through manager-controlled Supabase links and cannot assign their own fictional role.
- Telegram sales and expenses call the same `TransactionProcessor` used by the website.
- Original employee, Telegram user ID, and original chat ID are stored on each Telegram transaction.
- Added Svetlana's website screen for viewing, creating, and changing Telegram employee links.
- Submission confirmations and manager-decision messages are generated dynamically and sent only after data is saved.
- Telegram delivery has separate `PENDING`, `SENT`, `FAILED`, and `NOT_REQUIRED` states with manager retry controls.
- Telegram-submitted decisions use the original transaction chat; website decisions use the employee's currently linked private chat.
- Google Sheets placeholder values are now reported honestly as not configured.

### Verification completed

- The real bot token was verified for `@FriendsIncludedHomeworkBot`.
- The webhook route accepts the correct secret and rejects an incorrect one locally.
- A temporary live Supabase link/relink test passed and cleaned up.
- A temporary live notification failure/retry test passed without changing financial totals and cleaned up.
- ESLint, TypeScript, 34 regular tests, and the production build pass.
- The Stage 2 sale form, expense form, manager area, records, and dashboard still load successfully.
- The real Telegram account reached `/start`, was refused while unlinked, and was then linked to Richard only through Svetlana's live manager screen.
- Real Telegram sale `TGTEST-SALE-1` reached Supabase with Richard, the original Telegram identity/chat, €100.00, Project A, 40/30/30, and Pending Approval preserved.
- The real sale confirmation notification was delivered once, and a fresh website load shows the same pending record while approved income and commission remain zero.
- Real zero-amount and 60/30/20 Telegram sale attempts were refused and created no Supabase records.
- Svetlana's live manager screen relinked the same Telegram account to Kevin; the earlier sale still stores Richard and its original chat independently of the current link.

### Public deployment and webhook state

- GitHub repository: created, audited, and pushed to `MargaritaWV/wedding-guests-for-hire` on `main`.
- Vercel repository access: authorized only for the homework repository, which is now visible in the import screen.
- Vercel project: created and connected to the homework repository with server-only environment values stored as protected settings.
- Public Vercel deployment: live at `https://wedding-guests-for-hire-three.vercel.app`.
- Telegram webhook: active at the authenticated public webhook route with no reported delivery error.
- Real Telegram account transaction: verified for the temporary sale submission and confirmation.
- Real Telegram manager-decision notification: not performed yet.

### Remaining Stage 3 work

1. Submit the real temporary Kevin expense and verify its confirmation, stored reporter/chat, status, and financial treatment.
2. Complete both manager decisions and verify the real Telegram notifications and safe retry behavior.
3. Remove the temporary `TGTEST` records while keeping the useful real employee link.

### Known errors

No local code, database, test, or runtime errors are known. Vercel's first install stopped because pnpm required an explicit decision for `unrs-resolver`; the project now records `false`, so the script remains blocked and the corrected deployment succeeds. The rotated Telegram and Supabase credentials and fresh webhook secret are active without being committed or exposed to client code.

### Exact next action

From the relinked Kevin account, send `/start` and the documented `TGTEST-EXP-1` expense command, then confirm the bot recorded the expense.
