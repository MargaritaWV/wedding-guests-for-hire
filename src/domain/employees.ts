export const EMPLOYEE_CODES = [
  "svetlana",
  "richard",
  "anastasia",
  "jean_claude",
  "kevin",
] as const;

export type EmployeeCode = (typeof EMPLOYEE_CODES)[number];
export type EmployeeRole = "manager" | "salesperson" | "expense_reporter";

export interface EmployeeDefinition {
  code: EmployeeCode;
  displayName: string;
  role: EmployeeRole;
  roleLabel: string;
}

export const EMPLOYEES: readonly EmployeeDefinition[] = [
  {
    code: "svetlana",
    displayName: "Svetlana de Monte Carlo",
    role: "manager",
    roleLabel: "Manager",
  },
  {
    code: "richard",
    displayName: "Richard \"Call Me Dick\" Darling",
    role: "salesperson",
    roleLabel: "Salesperson",
  },
  {
    code: "anastasia",
    displayName: "Anastasia Ferrari",
    role: "salesperson",
    roleLabel: "Salesperson",
  },
  {
    code: "jean_claude",
    displayName: "Jean-Claude Bērziņš",
    role: "salesperson",
    roleLabel: "Salesperson",
  },
  {
    code: "kevin",
    displayName: "Kevin von Whatever",
    role: "expense_reporter",
    roleLabel: "Expense reporter",
  },
] as const;

export function getEmployeeDefinition(code: EmployeeCode): EmployeeDefinition {
  const employee = EMPLOYEES.find((candidate) => candidate.code === code);
  if (!employee) {
    throw new Error(`Unknown employee code: ${code}`);
  }
  return employee;
}
