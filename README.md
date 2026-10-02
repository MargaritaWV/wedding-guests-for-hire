# Friends Included Finance System

This repository contains the working Stage 3 website and Telegram integration for the Day 4 managerial accounting homework. Supabase is the source of truth; Telegram and the website share one server-side transaction processor; Google Sheets will later become a synchronized readable copy.

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

### Work completed in later stages

- Stage 3: the real Telegram bot, employee linking, real notifications, retry delivery, GitHub repository, and Vercel deployment are complete.
- Stage 4: connect a Google service account and spreadsheet, then implement reference-based row upserts and retries.
- Final stage: complete the submission links/instructions and run the official Telegram-dependent Test 1 and Test 2 demonstrations.

### Known bugs

None known at the Stage 2 checkpoint.

### Exact next step

From normal Windows PowerShell in this project folder, run `corepack pnpm dev`, open `http://localhost:3000`, and choose a demonstration role. Use non-official practice references if you want to explore before the instructor's Test 1 and Test 2 records are entered.

## External setup state

Supabase is connected and verified. The real Telegram bot and authenticated public webhook are active. Google Sheets remains intentionally unconfigured.

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
- Real Telegram expense `TGTEST-EXP-1` reached Supabase as Kevin's €25.00 Travel expense, proposed for Project B and initially awaiting allocation; its confirmation was delivered to the original chat.
- While awaiting allocation, the live dashboard counted the expense in the company result but excluded it from both projects.
- Svetlana changed the sale split from 40/30/30 to 50/25/25 and changed the expense allocation from Project B to Project A. Both original proposals and final decisions remain separately stored.
- The final dynamic results are €100 approved income, €10 commission, €25 Project A expense, and €65 company/Project A result. Both decision notification jobs report one successful delivery to each transaction's original chat.
- Both real manager-decision messages were visibly received in the student's Telegram chat.
- The live link/relink and notification failure/retry safeguards were rerun successfully with the rotated credentials.
- The final ESLint, TypeScript, 34 regular tests, two gated live tests, and production build all pass.
- All `TGTEST` and live-test transaction data was removed after verification. The useful real Telegram employee link remains, currently assigned to Kevin.

### Public deployment and webhook state

- GitHub repository: created, audited, and pushed to `MargaritaWV/wedding-guests-for-hire` on `main`.
- Vercel repository access: authorized only for the homework repository, which is now visible in the import screen.
- Vercel project: created and connected to the homework repository with server-only environment values stored as protected settings.
- Public Vercel deployment: live at `https://wedding-guests-for-hire-three.vercel.app`.
- Telegram webhook: active at the authenticated public webhook route with no reported delivery error.
- Real Telegram account transactions: verified for sale and expense submission, refusal rules, confirmations, manager corrections, and persistence before the temporary records were removed.
- Real Telegram manager-decision notifications: both were recorded as sent and personally confirmed as received.

### Stage 3 status

Stage 3 is complete. No temporary Telegram transaction, manager-decision, notification, or synchronization test data remains. The real employee link and authenticated webhook remain active for later official tests.

### Known errors

No local code, database, test, or runtime errors are known. Vercel's first install stopped because pnpm required an explicit decision for `unrs-resolver`; the project now records `false`, so the script remains blocked and the corrected deployment succeeds. The rotated Telegram and Supabase credentials and fresh webhook secret are active without being committed or exposed to client code.

### Exact next action

Begin Stage 4 by creating or choosing a Google Cloud project, enabling the Google Sheets API, creating a service account, and creating the homework spreadsheet with `Sales` and `Expenses` tabs. Share that spreadsheet with the service account email. Keep the service-account credentials private and out of GitHub and chat; they will be stored only in protected local and Vercel environment settings when Stage 4 begins.

## Stage 4 progress

### Completed locally

- Reread the complete authoritative homework specification and confirmed Supabase remains the source of truth.
- Identified the single downloaded service-account JSON by its project-related filename without inspecting unrelated Downloads files.
- Verified the replacement credential structure and authenticated it with Google without printing or copying any credential value.
- Stored the service-account email and private key only in the ignored `.env.local`; the downloaded JSON remains unchanged in Downloads.
- Implemented direct server-side Google Sheets API access without adding a package.
- Added separate readable Sales and Expenses row serializers with the required columns.
- Added reference-based insert/update behavior, header creation, simple formatting, row-number tracking, honest failure state, and manager-only retry.
- Website and Telegram submissions continue through the shared transaction processor and therefore use the same synchronization path.
- Added regular tests for pending/approved sales, awaiting/allocated expenses, reference-based insert/update, placeholder configuration, and client-side secret exclusion.
- ESLint, TypeScript, all 40 regular tests, both live Google integration tests, and the production build pass at this checkpoint.

### Configuration state

- Replacement Supabase, Telegram, and Google credentials: verified through minimum authenticated actions.
- A fresh Telegram webhook secret: generated and stored privately.
- Local service-account variables: configured privately with the replacement key.
- Spreadsheet ID: configured locally from the user-provided URL.
- Real spreadsheet headers and live synchronization: verified successfully for Sales and Expenses.
- Vercel Google environment variables and deployment: not changed yet.

### Remaining Stage 4 work

1. Update the named protected values manually in the existing Vercel project without using import, pull, preview, or value-revealing diagnostics.
2. Push the already verified Stage 4 commit so the existing Vercel project deploys it.
3. Verify the public connected state, reset the Telegram webhook to the fresh secret, and rerun the public end-to-end checks.
4. Confirm final cleanup and remove the retired credentials only after the replacement deployment is verified.

### Exact next action

Update the existing Vercel project's named environment variables from the matching values in `.env.local`, without using the bulk import or revealing any saved value. Apply them to Production and Preview.

### Live verification completed before the security stop

- The real service account authenticated and accessed the shared spreadsheet.
- The required Sales and Expenses headers were written and formatted.
- A real temporary sale and expense synchronized successfully.
- Manager decisions updated the same rows without duplicates.
- A controlled Sheets failure was stored as failed, and retry restored the same row without changing financial totals.
- The two live Google integration tests passed and their cleanup hooks removed their temporary database records and spreadsheet rows.

### Security recovery

During an earlier Vercel environment-variable import preview, Vercel's settings interface unexpectedly rendered protected values in automation diagnostic output. No credential was committed, copied into source code, or exposed to browser application code. Replacement Supabase, Telegram, Google, and webhook credentials are now stored locally and verified. The repository secret scan passes. The existing Vercel project still requires a manual value update before deployment because the safe automation tools cannot transmit those values without returning them in diagnostic output.
