import type { CommissionAmounts, CommissionSplit } from "./types";
import { commissionSplitSchema } from "./validation";

const tieBreakOrder: readonly (keyof CommissionSplit)[] = [
  "richard",
  "anastasia",
  "jeanClaude",
];

export function calculateCommission(
  saleAmountCents: number,
  splitInput: CommissionSplit,
): CommissionAmounts {
  if (!Number.isInteger(saleAmountCents) || saleAmountCents <= 0) {
    throw new Error("Sale amount must be a positive whole number of cents.");
  }

  const split = commissionSplitSchema.parse(splitInput);
  const poolCents = Math.round(saleAmountCents / 10);
  const rounded = {
    richard: Math.floor((poolCents * split.richard) / 100),
    anastasia: Math.floor((poolCents * split.anastasia) / 100),
    jeanClaude: Math.floor((poolCents * split.jeanClaude) / 100),
  };

  const currentTotal = rounded.richard + rounded.anastasia + rounded.jeanClaude;
  const difference = poolCents - currentTotal;
  const largestShare = Math.max(split.richard, split.anastasia, split.jeanClaude);
  const roundingRecipient = tieBreakOrder.find((name) => split[name] === largestShare);

  if (!roundingRecipient) {
    throw new Error("Unable to select a commission rounding recipient.");
  }
  rounded[roundingRecipient] += difference;

  return {
    poolCents,
    richardCents: rounded.richard,
    anastasiaCents: rounded.anastasia,
    jeanClaudeCents: rounded.jeanClaude,
  };
}
