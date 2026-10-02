# Architecture and Implementation Plan

## Architecture decision

Use one Next.js TypeScript application deployed to Vercel. Website forms and the Telegram webhook will resolve an employee identity and call the same `TransactionProcessor`. That processor owns validation, role checks, commission calculations, and decision rules. A Supabase repository will perform atomic writes. Google Sheets and Telegram delivery are separate retryable jobs, so an external failure never reverses a saved transaction or manager decision.

All money is stored as integer euro cents. Percentages are stored as whole percentage points. Financial results are calculated dynamically from transaction records; Test 1 and Test 2 totals are test expectations only.

## Data and request flow

1. A website route resolves the selected demonstration employee, or the Telegram webhook resolves a linked Telegram user.
2. The channel adapter converts input to the shared command shape.
3. `TransactionProcessor` enforces permissions, required fields, amount rules, and commission rules.
4. The Supabase repository creates or conditionally updates the authoritative record in one atomic database operation.
5. The saved transaction queues a Sheets upsert and, where required, a Telegram notification.
6. Delivery workers mark success only after the external API confirms it. Failures remain visible and retry the same transaction/reference.
7. Dashboard calculations read Supabase records. Pending sales contribute no income or commission; all recorded expenses reduce company result immediately.

## Remaining large milestones

### Milestone 2  Supabase transaction processing

Create a Supabase project, run the migration, add atomic database functions/repository methods, and connect website forms. Implement demonstration-role resolution, own-record visibility, manager views, automatic overhead allocation, idempotent approval/allocation, and dynamic dashboard queries. Complete processing-layer tests before styling.

### Milestone 3  Google Sheets synchronization

Create the service account and two-tab spreadsheet. Implement the authenticated adapter, exact readable columns, reference-based row upsert, resynchronization after decisions, visible pending/failed states, and safe retries. Test an interrupted update without creating duplicate rows or changing totals.

### Milestone 4  Real Telegram workflow

Create the bot and webhook. Build manager-only linking, reject unlinked users, collect S01/E01 through the real bot, confirm only after saving, retain original chat IDs, send decision messages, and expose failed-notification retries without undoing approvals.

### Milestone 5  Full interface and assignment verification

Finish the role-specific forms, manager controls, financial dashboard, links, and brief instructions. Run Test 1 from a clean transaction set, keep it for Test 2, then run permission, validation, idempotency, failure, persistence, and reconciliation checks. Do not seed or force the expected final totals.

### Milestone 6  Secure publication and submission

Create the GitHub repository, review it for secrets, connect it to Vercel, add server-side environment variables, and verify the production bot, spreadsheet, dashboard, and links. Give the instructor required Viewer/repository access and enter only the working Vercel URL in the student's own course-spreadsheet row.

## Boundaries for this first stage

This stage does not claim any external connection, create practice/Test transactions, implement the final forms, register a Telegram webhook, access Google Sheets, deploy to Vercel, or publish to GitHub. The integration modules fail clearly when unavailable rather than returning simulated success.
