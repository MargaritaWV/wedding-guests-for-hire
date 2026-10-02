"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  allocateExpenseAction,
  approveSaleAction,
  linkTelegramUserAction,
  retryGoogleSheetSyncAction,
  retryTelegramNotificationAction,
  submitExpenseAction,
  submitSaleAction,
} from "@/app/actions";
import { INITIAL_ACTION_STATE, type ActionState } from "@/src/application/action-state";
import type {
  ExpenseRecordView,
  FinanceSnapshot,
  SaleRecordView,
  TelegramLinkView,
} from "@/src/application/read-models";
import type { FinancialSummary } from "@/src/domain/calculations";
import { EMPLOYEES, getEmployeeDefinition, type EmployeeCode } from "@/src/domain/employees";
import { formatEuro } from "@/src/domain/money";
import type { AllocationTarget, CommissionSplit } from "@/src/domain/types";
import type { IntegrationReadiness } from "@/src/integrations/config";

function splitLabel(split: CommissionSplit | null): string {
  if (!split) return "—";
  return `Richard ${split.richard}% · Anastasia ${split.anastasia}% · Jean-Claude ${split.jeanClaude}%`;
}

function allocationLabel(allocation: AllocationTarget | null): string {
  if (!allocation) return "—";
  return allocation === "COMPANY_OVERHEAD" ? "Company overhead" : `Project ${allocation}`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function ActionMessage({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p className={`action-message ${state.status}`} role="status">
      {state.message}
    </p>
  );
}

function useRefreshOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state]);
}

function maskedTelegramId(value: string): string {
  return value.length <= 4 ? value : `••••${value.slice(-4)}`;
}

function TelegramSetup({
  links,
  botUsername,
}: {
  links: TelegramLinkView[];
  botUsername: string | null;
}) {
  const [state, action] = useActionState(linkTelegramUserAction, INITIAL_ACTION_STATE);
  useRefreshOnSuccess(state);
  return (
    <section aria-labelledby="telegram-setup-heading">
      <p className="eyebrow">Svetlana only</p>
      <h2 id="telegram-setup-heading">Telegram employee linking</h2>
      <p>
        Ask the user to open{" "}
        {botUsername ? (
          <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">
            @{botUsername}
          </a>
        ) : (
          "the Friends Included bot"
        )}
        , send <code>/start</code>, and copy the numeric user ID shown by the bot.
      </p>
      <form action={action} className="inline-form telegram-link-form">
        <input type="hidden" name="actorCode" value="svetlana" />
        <label>
          Telegram user ID
          <input name="telegramUserId" inputMode="numeric" placeholder="Numeric ID" required />
        </label>
        <label>
          Fictional employee
          <select name="employeeCode" defaultValue="" required>
            <option value="" disabled>Choose an employee</option>
            {EMPLOYEES.map((employee) => (
              <option value={employee.code} key={employee.code}>{employee.displayName}</option>
            ))}
          </select>
        </label>
        <button type="submit">Save or change link</button>
      </form>
      <ActionMessage state={state} />
      <h3 className="subheading">Current links</h3>
      {links.length ? (
        <div className="link-list">
          {links.map((link) => (
            <div key={link.telegramUserId}>
              <strong>{link.employeeName}</strong>
              <span>Telegram ID {maskedTelegramId(link.telegramUserId)}</span>
              <span>{link.hasPrivateChat ? "Private chat available" : "Waiting for a bot message"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">No Telegram accounts are linked yet.</p>
      )}
      <p className="muted">
        Only this manager screen can assign roles. Relinking affects future submissions only;
        earlier transactions retain their original employee and chat destination.
      </p>
    </section>
  );
}

function RetryNotification({
  transactionId,
  notificationKind,
}: {
  transactionId: string;
  notificationKind: NonNullable<SaleRecordView["notificationKind"]>;
}) {
  const [state, action] = useActionState(
    retryTelegramNotificationAction,
    INITIAL_ACTION_STATE,
  );
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="retry-form">
      <input type="hidden" name="actorCode" value="svetlana" />
      <input type="hidden" name="transactionId" value={transactionId} />
      <input type="hidden" name="notificationKind" value={notificationKind} />
      <button type="submit">Retry Telegram</button>
      <ActionMessage state={state} />
    </form>
  );
}

function RetrySheetSync({ transactionId }: { transactionId: string }) {
  const [state, action] = useActionState(
    retryGoogleSheetSyncAction,
    INITIAL_ACTION_STATE,
  );
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="retry-form">
      <input type="hidden" name="actorCode" value="svetlana" />
      <input type="hidden" name="transactionId" value={transactionId} />
      <button type="submit">Retry Sheets</button>
      <ActionMessage state={state} />
    </form>
  );
}

function SaleForm({ actorCode }: { actorCode: EmployeeCode }) {
  const [state, action] = useActionState(submitSaleAction, INITIAL_ACTION_STATE);
  useRefreshOnSuccess(state);
  return (
    <section aria-labelledby="sale-entry-heading">
      <p className="eyebrow">New transaction</p>
      <h2 id="sale-entry-heading">Sale entry</h2>
      <p className="muted">
        The salesperson is taken from the demonstration role and cannot be changed here.
      </p>
      <form action={action} className="form-grid">
        <input type="hidden" name="actorCode" value={actorCode} />
        <label>
          Unique reference
          <input name="reference" placeholder="e.g. SALE-REF" required />
        </label>
        <label>
          Salesperson
          <input value={getEmployeeDefinition(actorCode).displayName} disabled />
        </label>
        <label>
          Customer
          <input name="customer" required />
        </label>
        <label>
          Project
          <select name="project" required defaultValue="">
            <option value="" disabled>Choose a project</option>
            <option value="A">Project A</option>
            <option value="B">Project B</option>
          </select>
        </label>
        <label className="wide">
          Description
          <textarea name="description" rows={3} required />
        </label>
        <label>
          Amount in euros
          <input name="amount" inputMode="decimal" placeholder="e.g. 125.50" required />
        </label>
        <fieldset className="wide split-fields">
          <legend>Proposed commission split (must total 100%)</legend>
          <label>
            Richard %
            <input name="richardPercent" type="number" min="0" max="100" placeholder="e.g. 40" required />
          </label>
          <label>
            Anastasia %
            <input name="anastasiaPercent" type="number" min="0" max="100" placeholder="e.g. 30" required />
          </label>
          <label>
            Jean-Claude %
            <input name="jeanClaudePercent" type="number" min="0" max="100" placeholder="e.g. 30" required />
          </label>
        </fieldset>
        <div className="form-actions wide">
          <button type="submit">Save pending sale</button>
        </div>
      </form>
      <ActionMessage state={state} />
    </section>
  );
}

function ExpenseForm({ actorCode }: { actorCode: EmployeeCode }) {
  const [state, action] = useActionState(submitExpenseAction, INITIAL_ACTION_STATE);
  useRefreshOnSuccess(state);
  return (
    <section aria-labelledby="expense-entry-heading">
      <p className="eyebrow">New transaction</p>
      <h2 id="expense-entry-heading">Expense entry</h2>
      <p className="muted">
        The reporter is taken from the demonstration role and cannot be changed here.
      </p>
      <form action={action} className="form-grid">
        <input type="hidden" name="actorCode" value={actorCode} />
        <label>
          Unique reference
          <input name="reference" placeholder="e.g. EXPENSE-REF" required />
        </label>
        <label>
          Reporter
          <input value={getEmployeeDefinition(actorCode).displayName} disabled />
        </label>
        <label className="wide">
          Description
          <textarea name="description" rows={3} required />
        </label>
        <label>
          Amount in euros
          <input name="amount" inputMode="decimal" placeholder="e.g. 45.75" required />
        </label>
        <label>
          Category
          <select name="category" required defaultValue="">
            <option value="" disabled>Choose a category</option>
            <option>Materials</option>
            <option>Travel</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Proposed allocation
          <select name="proposedAllocation" required defaultValue="">
            <option value="" disabled>Choose an allocation</option>
            <option value="A">Project A</option>
            <option value="B">Project B</option>
            <option value="COMPANY_OVERHEAD">Company overhead</option>
          </select>
        </label>
        <div className="form-actions wide">
          <button type="submit">Save expense</button>
        </div>
      </form>
      <ActionMessage state={state} />
    </section>
  );
}

function SaleApprovalCard({ sale }: { sale: SaleRecordView }) {
  const [state, action] = useActionState(approveSaleAction, INITIAL_ACTION_STATE);
  useRefreshOnSuccess(state);
  return (
    <article className="decision-card">
      <h3>
        {sale.reference} · {formatEuro(sale.amountCents)}
      </h3>
      <p>
        {sale.submitterName} · {sale.customer} · Project {sale.project}
      </p>
      <p>{sale.description}</p>
      <p>
        <strong>Original proposal:</strong> {splitLabel(sale.proposedSplit)}
      </p>
      <form action={action} className="split-fields compact">
        <input type="hidden" name="actorCode" value="svetlana" />
        <input type="hidden" name="transactionId" value={sale.transactionId} />
        <label>
          Richard %
          <input name="richardPercent" type="number" min="0" max="100" defaultValue={sale.proposedSplit.richard} required />
        </label>
        <label>
          Anastasia %
          <input name="anastasiaPercent" type="number" min="0" max="100" defaultValue={sale.proposedSplit.anastasia} required />
        </label>
        <label>
          Jean-Claude %
          <input name="jeanClaudePercent" type="number" min="0" max="100" defaultValue={sale.proposedSplit.jeanClaude} required />
        </label>
        <div className="form-actions">
          <button type="submit">Approve final split</button>
        </div>
      </form>
      <ActionMessage state={state} />
    </article>
  );
}

function ExpenseAllocationCard({ expense }: { expense: ExpenseRecordView }) {
  const [state, action] = useActionState(allocateExpenseAction, INITIAL_ACTION_STATE);
  useRefreshOnSuccess(state);
  return (
    <article className="decision-card">
      <h3>
        {expense.reference} · {formatEuro(expense.amountCents)}
      </h3>
      <p>
        {expense.submitterName} · {expense.category}
      </p>
      <p>{expense.description}</p>
      <p>
        <strong>Original proposal:</strong> {allocationLabel(expense.proposedAllocation)}
      </p>
      <form action={action} className="inline-form">
        <input type="hidden" name="actorCode" value="svetlana" />
        <input type="hidden" name="transactionId" value={expense.transactionId} />
        <label>
          Final allocation
          <select name="finalAllocation" defaultValue={expense.proposedAllocation}>
            <option value="A">Project A</option>
            <option value="B">Project B</option>
            <option value="COMPANY_OVERHEAD">Company overhead</option>
          </select>
        </label>
        <button type="submit">Confirm allocation</button>
      </form>
      <ActionMessage state={state} />
    </article>
  );
}

function ManagerArea({ snapshot }: { snapshot: FinanceSnapshot }) {
  const pending = snapshot.sales.filter((sale) => sale.status === "PENDING_APPROVAL");
  const awaiting = snapshot.expenses.filter((expense) => expense.status === "AWAITING_ALLOCATION");
  return (
    <section aria-labelledby="manager-heading">
      <p className="eyebrow">Svetlana only</p>
      <h2 id="manager-heading">Manager approval area</h2>
      <h3>Pending sales</h3>
      <div className="decision-list">
        {pending.length ? (
          pending.map((sale) => <SaleApprovalCard key={sale.transactionId} sale={sale} />)
        ) : (
          <p className="empty">No sales are waiting for approval.</p>
        )}
      </div>
      <h3 className="subheading">Expenses awaiting allocation</h3>
      <div className="decision-list">
        {awaiting.length ? (
          awaiting.map((expense) => (
            <ExpenseAllocationCard key={expense.transactionId} expense={expense} />
          ))
        ) : (
          <p className="empty">No expenses are waiting for allocation.</p>
        )}
      </div>
    </section>
  );
}

function Dashboard({ summary }: { summary: FinancialSummary }) {
  return (
    <section aria-labelledby="dashboard-heading">
      <p className="eyebrow">Approved and recorded data</p>
      <h2 id="dashboard-heading">Financial dashboard</h2>
      <div className="metric-grid">
        {(["A", "B"] as const).map((projectCode) => {
          const project = summary.projects[projectCode];
          return (
            <article className="metric-card" key={projectCode}>
              <h3>Project {projectCode}</h3>
              <dl>
                <div><dt>Approved income</dt><dd>{formatEuro(project.approvedIncomeCents)}</dd></div>
                <div><dt>Commission expense</dt><dd>{formatEuro(project.commissionExpenseCents)}</dd></div>
                <div><dt>Allocated expenses</dt><dd>{formatEuro(project.allocatedExpenseCents)}</dd></div>
                <div className="total"><dt>Project result</dt><dd>{formatEuro(project.resultCents)}</dd></div>
              </dl>
            </article>
          );
        })}
        <article className="metric-card company">
          <h3>Company totals</h3>
          <dl>
            <div><dt>Approved sales</dt><dd>{formatEuro(summary.approvedSalesCents)}</dd></div>
            <div><dt>Total commission expense</dt><dd>{formatEuro(summary.totalCommissionExpenseCents)}</dd></div>
            <div><dt>All recorded expenses</dt><dd>{formatEuro(summary.allRecordedExpensesCents)}</dd></div>
            <div><dt>Company overhead</dt><dd>{formatEuro(summary.companyOverheadCents)}</dd></div>
            <div><dt>Awaiting allocation</dt><dd>{formatEuro(summary.awaitingAllocationCents)}</dd></div>
            <div className="total"><dt>Total company result</dt><dd>{formatEuro(summary.totalCompanyResultCents)}</dd></div>
          </dl>
        </article>
      </div>
      <h3 className="subheading">Cumulative commission earned</h3>
      <div className="commission-row">
        <span>Richard <strong>{formatEuro(summary.individualCommissionCents.richard)}</strong></span>
        <span>Anastasia <strong>{formatEuro(summary.individualCommissionCents.anastasia)}</strong></span>
        <span>Jean-Claude <strong>{formatEuro(summary.individualCommissionCents.jeanClaude)}</strong></span>
      </div>
      <p className="muted dashboard-note">
        Company overhead and expenses awaiting allocation explain the difference between the two
        project results combined and the total company result.
      </p>
    </section>
  );
}

function SalesTable({ sales, canRetry }: { sales: SaleRecordView[]; canRetry: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Reference / time</th><th>Salesperson / customer</th><th>Project / description</th><th>Amount</th><th>Original split</th><th>Final split / earned</th><th>Status</th></tr></thead>
        <tbody>
          {sales.map((sale) => (
            <tr key={sale.transactionId}>
              <td><strong>{sale.reference}</strong><br /><small>{dateLabel(sale.submittedAt)}</small></td>
              <td>{sale.submitterName}<br /><small>{sale.customer}</small></td>
              <td>Project {sale.project}<br /><small>{sale.description}</small></td>
              <td>{formatEuro(sale.amountCents)}</td>
              <td>{splitLabel(sale.proposedSplit)}</td>
              <td>{sale.finalSplit ? <>{splitLabel(sale.finalSplit)}<br /><small>R {formatEuro(sale.commission?.richardCents ?? 0)} · A {formatEuro(sale.commission?.anastasiaCents ?? 0)} · J-C {formatEuro(sale.commission?.jeanClaudeCents ?? 0)}</small></> : "—"}</td>
              <td><span className="record-status">{statusLabel(sale.status)}</span><br /><small>{sale.sheetMessage}<br />{sale.notificationMessage}</small>{canRetry && (sale.sheetState === "FAILED" || sale.sheetState === "PENDING") && <RetrySheetSync transactionId={sale.transactionId} />}{canRetry && sale.notificationState === "FAILED" && sale.notificationKind && <RetryNotification transactionId={sale.transactionId} notificationKind={sale.notificationKind} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sales.length === 0 && <p className="empty table-empty">No sales records yet.</p>}
    </div>
  );
}

function ExpensesTable({ expenses, canRetry }: { expenses: ExpenseRecordView[]; canRetry: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Reference / time</th><th>Reporter</th><th>Description / category</th><th>Amount</th><th>Original allocation</th><th>Final allocation</th><th>Status</th></tr></thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.transactionId}>
              <td><strong>{expense.reference}</strong><br /><small>{dateLabel(expense.submittedAt)}</small></td>
              <td>{expense.submitterName}</td>
              <td>{expense.description}<br /><small>{expense.category}</small></td>
              <td>{formatEuro(expense.amountCents)}</td>
              <td>{allocationLabel(expense.proposedAllocation)}</td>
              <td>{allocationLabel(expense.finalAllocation)}{expense.allocationWasAutomatic && <><br /><small>Automatic overhead</small></>}</td>
              <td><span className="record-status">{statusLabel(expense.status)}</span><br /><small>{expense.sheetMessage}<br />{expense.notificationMessage}</small>{canRetry && (expense.sheetState === "FAILED" || expense.sheetState === "PENDING") && <RetrySheetSync transactionId={expense.transactionId} />}{canRetry && expense.notificationState === "FAILED" && expense.notificationKind && <RetryNotification transactionId={expense.transactionId} notificationKind={expense.notificationKind} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {expenses.length === 0 && <p className="empty table-empty">No expense records yet.</p>}
    </div>
  );
}

function Records({ snapshot, canRetry }: { snapshot: FinanceSnapshot; canRetry: boolean }) {
  return (
    <section aria-labelledby="records-heading">
      <p className="eyebrow">Saved in Supabase</p>
      <h2 id="records-heading">Records</h2>
      <h3>Sales</h3>
      <SalesTable sales={snapshot.sales} canRetry={canRetry} />
      <h3 className="subheading">Expenses</h3>
      <ExpensesTable expenses={snapshot.expenses} canRetry={canRetry} />
    </section>
  );
}

export function FinanceApp({
  selectedRole,
  snapshot,
  summary,
  telegramLinks,
  telegramBotUsername,
  readiness,
  databaseMessage,
}: {
  selectedRole: EmployeeCode | null;
  snapshot: FinanceSnapshot;
  summary: FinancialSummary;
  telegramLinks: TelegramLinkView[];
  telegramBotUsername: string | null;
  readiness: IntegrationReadiness[];
  databaseMessage: string | null;
}) {
  const router = useRouter();
  const definition = selectedRole ? getEmployeeDefinition(selectedRole) : null;
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Friends Included Ltd</p>
        <h1>Finance workspace</h1>
        <p>
          Enter transactions, make manager decisions, and see results calculated from the Supabase
          source of truth.
        </p>
      </header>
      {databaseMessage && <div className="connection-error" role="alert">{databaseMessage}</div>}
      <section aria-labelledby="role-heading">
        <div className="section-heading">
          <div><p className="eyebrow">Demonstration access</p><h2 id="role-heading">Demonstration role</h2></div>
          {definition && <span className="badge">{definition.roleLabel}</span>}
        </div>
        <label htmlFor="demo-role">Choose a fictional employee</label>
        <select
          id="demo-role"
          value={selectedRole ?? ""}
          onChange={(event) =>
            router.push(event.target.value ? `/?role=${encodeURIComponent(event.target.value)}` : "/")
          }
        >
          <option value="">Select an employee</option>
          {EMPLOYEES.map((employee) => (
            <option key={employee.code} value={employee.code}>
              {employee.displayName} — {employee.roleLabel}
            </option>
          ))}
        </select>
        <p className="muted">
          This selector is for the required classroom demonstration. Every action is still checked
          on the server.
        </p>
      </section>
      {selectedRole && !databaseMessage && (
        <>
          {definition?.role === "salesperson" && <SaleForm actorCode={selectedRole} />}
          {definition?.role === "expense_reporter" && <ExpenseForm actorCode={selectedRole} />}
          {definition?.role === "manager" && (
            <>
              <TelegramSetup links={telegramLinks} botUsername={telegramBotUsername} />
              <ManagerArea snapshot={snapshot} />
              <Dashboard summary={summary} />
            </>
          )}
          <Records snapshot={snapshot} canRetry={definition?.role === "manager"} />
        </>
      )}
      {!selectedRole && !databaseMessage && (
        <section className="welcome">
          <h2>Choose a role to begin</h2>
          <p>Salespeople can enter sales, Kevin can enter expenses, and Svetlana can make final decisions and view company results.</p>
        </section>
      )}
      <section aria-labelledby="readiness-heading">
        <p className="eyebrow">Honest connection state</p>
        <h2 id="readiness-heading">External services</h2>
        <div className="status-grid">
          {readiness.map((item) => (
            <article key={item.name} className="status-card">
              <h3>{item.name}</h3>
              <p className={`status ${item.state}`}>{item.label}</p>
              <p>{item.detail}</p>
              {item.href && (
                <p><a href={item.href} target="_blank" rel="noreferrer">Open Google Sheet</a></p>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
