# Assignment Requirements Analysis

This file records the complete requirements extracted from the authoritative Day 4 homework document. It is an implementation checklist, not a substitute for the original assignment.

## People roles and access

- Svetlana de Monte Carlo is the manager. She can approve sales, correct commission splits before approval, and confirm or change expense allocations. Only she can make those decisions.
- Richard "Call Me Dick" Darling, Anastasia Ferrari, and Jean-Claude Bērziņš are salespeople. They can submit sales and proposed commission splits, but cannot approve or correct transactions.
- Kevin von Whatever is the expense reporter. He can submit expenses and proposed allocations, but cannot submit sales or make decisions.
- Salespeople and Kevin see only their own submissions and statuses. Svetlana sees all transactions and financial results.
- The website must have a `Demonstration role` selector containing all five fictional employees. Full authentication is not required.
- Hiding controls is insufficient: every action must be checked again in the processing/backend layer.
- Telegram identifies users by Telegram user ID. A manager setup screen controls employee links. Unlinked users cannot submit, and bot users cannot assign themselves roles.

## Transaction records

Every transaction has one globally unique reference, automatically recorded submission time, submitting employee, origin channel, and immutable identity. Required information cannot be missing. Amounts must be greater than zero and are stored/displayed as euros to two decimals, with no VAT or tax calculation.

Sales require the automatically identified salesperson, customer, Project A or B, description, amount, and proposed Richard/Anastasia/Jean-Claude percentages. Each percentage is 0% through 100%, and all three total exactly 100%.

Expenses require the automatically identified reporter, description, amount, category (`Materials`, `Travel`, or `Other`), and proposed allocation (`A`, `B`, or `Company overhead`).

The supplied S01-S05 and E01-E07 references must be accepted when not already used. Other references and amounts must also work dynamically.

For bot submissions, preserve the Telegram user ID and originating chat ID on the transaction. Later relinking must not change the submitter or notification destination. For website decisions, use the submitting employee's linked chat when available; otherwise record `No Telegram recipient linked`.

## Sales commissions and status

- A new sale is `Pending approval`, visible in records but excluded from approved income and commission totals.
- Svetlana approves the proposed split or changes it before approval. Approved sales and final commission amounts enter results together.
- The commission pool is 10% of the sale amount and is an expense of that sale's project. It must never be entered as a separate expense.
- Round the pool and individual commissions to cents. Any rounding difference goes to the largest percentage; ties go to Richard, then Anastasia, then Jean-Claude.
- Preserve proposed and final percentages, individual euro amounts, decision time, approving manager, and whether the split changed.
- Corrections happen before approval. Editing an approved sale is not required. A sale may remain pending.
- Repeating an approval must not duplicate records, commissions, totals, synchronization, or notifications.
- Tracking commission earned is required; tracking whether it has been paid is not required.

## Expenses allocation and status

- Every saved expense immediately reduces total company result because it has already been paid.
- Proposed company overhead is allocated automatically and needs no later allocation notification beyond the initial submission confirmation.
- Proposed A/B expenses are `Awaiting allocation` until Svetlana confirms the proposal or moves them to the other project or company overhead.
- While awaiting allocation, an expense reduces company result but neither project result.
- Allocation assigns an existing expense; it must not reduce company result a second time.
- Preserve proposed and final allocations, decision time, deciding manager, automatic/manager decision, and whether the allocation changed.
- Editing an allocated expense is not required. An expense may remain awaiting allocation.

## Dynamic financial calculations

- Project result = approved project sales - project sales commissions - expenses finally allocated to that project.
- Company result = all approved sales - all sales commissions - all recorded expenses.
- Show approved income, commission expense, allocated expenses, and result for Projects A and B.
- Show company overhead, expenses awaiting allocation, total company result, pending sales, pending expense allocations, and commission earned by each salesperson.
- Overhead and awaiting-allocation expenses explain the difference between combined project results and company result.
- All results come from stored transactions. Never hard-code test totals or automatically reset instructor changes.

## Telegram messages

- Confirm a successful submission only after Supabase saves it. Include reference, amount, project/proposed allocation, and current status.
- On failure, explain what must be corrected and do not claim the transaction was recorded.
- Sale decision messages include reference, sale amount, total commission, each final percentage and euro amount, and whether/change details for the split.
- Expense decision messages include reference, amount, description, final allocation, and highlight a changed proposal.
- Send bot-originated decisions to the original submitting chat. Website-originated decisions use the employee's linked chat if one exists.
- Each recipient must first start the bot. The three commission recipients do not all require notifications; notify the submitting salesperson.
- A failed notification does not undo the saved decision. Store a separate failed state and retry, and never label it sent before success.

## Google Sheets copy

- Supabase remains the source of truth. Spreadsheet edits do not update the application.
- Automatically maintain exactly two tabs, `Sales` and `Expenses`.
- Sales columns: reference, submission time, salesperson, customer, project, description, amount, three separate original percentages, three separate approved percentages, three individual commission amounts, and status.
- Expenses columns: reference, submission time, reporter, description, category, amount, proposed allocation, final allocation, and status.
- Pending sales have no approved split and zero earned commission. Proposed and final allocations stay separate.
- Synchronize both new submissions and decisions. Update/insert by transaction reference; approval and retry update the same row rather than appending duplicates.
- If saving succeeds but Sheets fails, show `Sync pending` or `Sync failed`, retain the transaction, store attempts/errors, and provide a retry with the same reference and unchanged totals.
- Use the Google Sheets API with a Google service account. Share the spreadsheet to that account as Editor and to the instructor as Viewer; do not use public editing.

## Test 1 normal operation

Begin with no practice transactions. S01 and E01 must use the real Telegram bot. Remaining entries use the website role selector. Splits are always listed Richard/Anastasia/Jean-Claude.

- S01: Richard, Olivia Rose, Project A, `One proud uncle and an emotional grandmother`, €1,000, proposed 50/30/20.
- S02: Anastasia, Daniel King, Project B, `University friends, dancing, and the stripping performance`, €2,000, proposed 0/50/50.
- E01: Kevin, Materials, `Rented suit and fake pearl necklace for the relatives`, €120, proposed A.
- E02: Kevin, Travel, `Taxi for the grandmother; Kevin selected the wrong project`, €80, proposed B.
- E03: Kevin, Other, `Monthly company website subscription`, €100, company overhead.

Before decisions: sales pending; E01/E02 awaiting; E03 overhead; approved income and commission €0; both project results €0; company result -€300.

Manager: approve S01 unchanged; change S02 to 20/40/40 then approve; allocate E01 to A; change E02 from B to A. S01/E01 approval notifications must reach the original Telegram chat even after relinking that user from Richard to Kevin. S02/E02 use a linked chat when available or explicitly show no recipient.

Expected check values only: Project A income €1,000, commission €100, project expenses €200, result €700; Project B income €2,000, commission €200, expenses €0, result €1,800; company income €3,000, commission €300, project expenses €200, overhead €100, awaiting €0, result €2,400. Commission earned: Richard €90, Anastasia €110, Jean-Claude €100. Verify corrected Sheet rows and persistence after refresh.

## Test 2 cumulative operation

Keep Test 1 records and add all entries through appropriate website demonstration roles.

- S03: Jean-Claude, Emma Stonebridge, Project A, `Premium relatives, including an uncle presented as a surgeon`, €1,500, proposed 40/40/20.
- S04: Richard, Lucas Green, Project B, `Small group of loud university friends`, €800, proposed 25/25/50.
- S05: Richard, Mia Brooks, Project B, `Extra guests and an embarrassing speech`, €600, proposed 100/0/0.
- E04: Kevin, Materials, `Replacement costumes after an enthusiastic dance performance`, €250, proposed B.
- E05: Kevin, Travel, `Minibus for university friends; Kevin selected the wrong project again`, €90, proposed A.
- E06: Kevin, Other, `Company telephone subscription`, €60, company overhead.
- E07: Kevin, Materials, `Emergency replacement clothing; project allocation still needs checking`, €140, proposed A.

Manager: change S03 to 20/30/50 then approve; approve S04 unchanged; leave S05 pending; allocate E04 to B; change E05 from A to B; leave E07 awaiting. Link Jean-Claude before S03's decision and Kevin before E04/E05 decisions. S03 must show a €150 pool (€30/€45/€75) and a changed split. E05 must show €90 moved A to B. S05/E07 receive no approval message.

Expected cumulative check values only: Project A income €2,500, commission €250, expenses €200, result €2,050; Project B income €2,800, commission €280, expenses €340, result €2,180; company income €5,300, commission €530, project expenses €540, overhead €160, awaiting €140, result €3,930. Commission earned: Richard €140, Anastasia €175, Jean-Claude €215. S05 €600 remains excluded; E07 €140 remains included only in company expenses. Reconciliation: €2,050 + €2,180 - €160 - €140 = €3,930.

## Required denial failure and persistence tests

- Refuse 60/30/20 because the split is 110%.
- Deny a sale approval attempted as Richard.
- Deny a sale submission attempted as Kevin.
- Refuse an expense with missing or zero amount.
- Make a repeated approval a no-op with unchanged totals and no duplicate record/effect.
- Refuse a reused reference globally.
- All denied attempts leave control totals unchanged and are verified at the processing layer, not only the UI.
- Interrupt Sheets synchronization: retain the transaction, show incomplete status, and retry the same row/reference without changing totals.
- Simulate/observe Telegram delivery failure: keep the decision and never report the message as sent.

## Final website publication and submission

- Store code in a GitHub repository accessible to the instructor and deploy that repository to Vercel.
- Final Vercel page includes the student's name; working completed two-test results; demonstration role selector; sale/expense forms; manager controls; financial dashboard; Telegram bot, viewable Google Sheet, and GitHub links; and brief entry/approval instructions.
- S01 and E01 must have passed through the real bot with return decision notifications. A website-only simulation is insufficient.
- Give the instructor view access where required. Do not expose bot tokens, passwords, private keys, or service-role credentials in the website, spreadsheet, GitHub, or documentation.
- Submit only the working Vercel URL in the student's own row and Day 4 column of the course spreadsheet. Do not edit anyone else's name, link, or feedback.
- No separate report, presentation, assessment app, AI model, or paid AI API is required.
