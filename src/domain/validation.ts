import { z } from "zod";

const requiredText = z.string().trim().min(1, "This field is required.");
const reference = requiredText
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores.");
const positiveCents = z.number().int().positive("Amount must be greater than zero.");
const percentage = z.number().int().min(0).max(100);

export const commissionSplitSchema = z
  .object({
    richard: percentage,
    anastasia: percentage,
    jeanClaude: percentage,
  })
  .superRefine((split, context) => {
    if (split.richard + split.anastasia + split.jeanClaude !== 100) {
      context.addIssue({
        code: "custom",
        message: "Richard, Anastasia, and Jean-Claude percentages must total exactly 100%.",
      });
    }
  });

export const saleSubmissionSchema = z.object({
  reference,
  customer: requiredText.max(200),
  project: z.enum(["A", "B"]),
  description: requiredText.max(2000),
  amountCents: positiveCents,
  proposedSplit: commissionSplitSchema,
});

export const expenseSubmissionSchema = z.object({
  reference,
  description: requiredText.max(2000),
  category: z.enum(["Materials", "Travel", "Other"]),
  amountCents: positiveCents,
  proposedAllocation: z.enum(["A", "B", "COMPANY_OVERHEAD"]),
});

export const saleApprovalSchema = z.object({
  transactionId: z.string().uuid(),
  finalSplit: commissionSplitSchema,
});

export const expenseAllocationSchema = z.object({
  transactionId: z.string().uuid(),
  finalAllocation: z.enum(["A", "B", "COMPANY_OVERHEAD"]),
});
