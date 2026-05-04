import { describe, it, expect } from "vitest";
import { run } from "../run";
import { createMockInput } from "./mocks";
import { DiscountApplicationStrategy } from "../../generated/api";

describe("Order Discount Function", () => {
  it("should apply fixed amount discount to the order when conditions are met", () => {
    const config = {
      conditionLogic: "all",
      conditions: [{ type: "cart_total", operator: "gte", value: "200" }],
      action: { type: "fixed_amount_off", value: "50", target: "order" },
      combinable: true,
    };

    const input = createMockInput({
      config,
      subtotalAmount: 250, // Condition met
      lines: [
        { id: "line-1", quantity: 2, productId: "gid://shopify/Product/NORMAL1" }
      ],
    });

    const result = run(input);

    expect(result.discounts.length).toBe(1);
    expect(result.discounts[0].value).toEqual({ fixedAmount: { amount: 50 } });
    expect(result.discounts[0].targets.length).toBe(1);
    expect((result.discounts[0].targets[0] as any).orderSubtotal).toBeDefined();
    expect(result.discountApplicationStrategy).toBe(DiscountApplicationStrategy.Maximum);
  });

  it("should NOT apply order discount if conditions are not met", () => {
    const config = {
      conditionLogic: "all",
      conditions: [{ type: "cart_total", operator: "gte", value: "200" }],
      action: { type: "fixed_amount_off", value: "50", target: "order" },
      combinable: false,
    };

    const input = createMockInput({
      config,
      subtotalAmount: 150, // Condition NOT met
      lines: [
        { id: "line-1", quantity: 1, productId: "gid://shopify/Product/NORMAL1" }
      ],
    });

    const result = run(input);

    expect(result.discounts.length).toBe(0); // Empty discount
    expect(result.discountApplicationStrategy).toBe(DiscountApplicationStrategy.First);
  });
});
