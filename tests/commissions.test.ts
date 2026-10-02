import { describe, expect, it } from "vitest";
import { calculateCommission } from "../src/domain/commissions";

describe("calculateCommission", () => {
  it("calculates the 10% pool and individual shares dynamically", () => {
    expect(
      calculateCommission(100_000, { richard: 50, anastasia: 30, jeanClaude: 20 }),
    ).toEqual({
      poolCents: 10_000,
      richardCents: 5_000,
      anastasiaCents: 3_000,
      jeanClaudeCents: 2_000,
    });
  });

  it("gives a rounding difference to the largest share and uses the required tie order", () => {
    expect(calculateCommission(10, { richard: 34, anastasia: 33, jeanClaude: 33 })).toEqual({
      poolCents: 1,
      richardCents: 1,
      anastasiaCents: 0,
      jeanClaudeCents: 0,
    });

    expect(calculateCommission(10, { richard: 0, anastasia: 50, jeanClaude: 50 })).toEqual({
      poolCents: 1,
      richardCents: 0,
      anastasiaCents: 1,
      jeanClaudeCents: 0,
    });
  });
});
