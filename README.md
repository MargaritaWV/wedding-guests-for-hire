# Wedding Guests for Hire

This is Margarita Posti's completed Friends Included finance system for the Day 4 managerial accounting homework. The live application is available at [wedding-guests-for-hire-three.vercel.app](https://wedding-guests-for-hire-three.vercel.app).

## How the system works

- **Supabase is the source of truth** for employees, sales, expenses, manager decisions, delivery status, and financial records.
- **The website and Telegram bot use the same server-side business logic** for validation, permissions, transaction processing, commissions, allocations, and financial calculations.
- **Google Sheets is an automatically synchronized readable copy** of the Supabase records. It is not the primary database.
- The website's **Demonstration role** selector lets the instructor test the five fictional employees without a separate login system.
- Richard, Anastasia, and Jean-Claude submit sales. Kevin submits expenses. Svetlana is the manager who approves or corrects commission splits and expense allocations.
- The real Telegram bot accepts authorized submissions and sends confirmations and manager-decision notifications.

Choose a salesperson in the Demonstration role selector to enter a sale, choose Kevin to enter an expense, or choose Svetlana to review records, make manager decisions, and view the financial dashboard. The live Vercel page also contains the required Telegram, Google Sheets, and GitHub links.

## Final homework status

Official Test 1 and Test 2 are complete and passed. The Stage 5 permission, validation, duplicate-protection, failed-synchronization, and failed-notification retry tests also passed.

- S05 intentionally remains **Pending Approval**.
- E07 intentionally remains **Awaiting Allocation**.
- The final cumulative company result is **€3,930**.

All results are calculated dynamically from the saved Supabase records; no official test totals are hard-coded.

## Security

Secrets are server-side environment variables and are not stored in the repository or exposed to browser code. `.env.example` contains placeholders only, while local environment and credential files are excluded by `.gitignore`.
