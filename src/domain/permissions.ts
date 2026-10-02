import { DomainError } from "./errors";
import type { EmployeeRole } from "./employees";

export type ProtectedAction =
  | "submit_sale"
  | "submit_expense"
  | "make_manager_decision"
  | "manage_telegram_links"
  | "retry_notification";

const allowedRoles: Record<ProtectedAction, readonly EmployeeRole[]> = {
  submit_sale: ["salesperson"],
  submit_expense: ["expense_reporter"],
  make_manager_decision: ["manager"],
  manage_telegram_links: ["manager"],
  retry_notification: ["manager"],
};

export function canPerform(role: EmployeeRole, action: ProtectedAction): boolean {
  return allowedRoles[action].includes(role);
}

export function assertCanPerform(role: EmployeeRole, action: ProtectedAction): void {
  if (!canPerform(role, action)) {
    throw new DomainError(
      "PERMISSION_DENIED",
      `The ${role} role is not allowed to perform ${action.replaceAll("_", " ")}.`,
    );
  }
}
