import { describe, it, expect } from "vitest";
import { run } from "../run";
import { createMockInput } from "./mocks";
import { DiscountApplicationStrategy } from "../../generated/api";

describe("Product Discount Function", () => {
  it("should apply 100% discount on a free product (GWP) when conditions are met", () => {
    const config = {
      conditionLogic: "all",
      conditions: [{ type: "cart_total", operator: "gte", value: "100" }],
      action: { type: "free_product", target: "product", productId: "gid://shopify/Product/GIFT123", quantity: 1 },
      combinable: true,
    };

    const input = createMockInput({
      config,
      subtotalAmount: 150, // Condition met
      lines: [
        { id: "line-1", quantity: 1, amountPerQuantity: 150, productId: "gid://shopify/Product/NORMAL1" },
        { id: "line-2", quantity: 1, amountPerQuantity: 0, productId: "gid://shopify/Product/GIFT123" } // The gift
      ],
    });

    const result = run(input);

    expect(result.discounts.length).toBe(1);
    expect(result.discounts[0].value).toEqual({ percentage: { value: 100 } });
    expect(result.discounts[0].targets.length).toBe(1);
    expect((result.discounts[0].targets[0] as any).cartLine.id).toBe("line-2");
    expect(result.discountApplicationStrategy).toBe(DiscountApplicationStrategy.Maximum);
  });

  it("should NOT apply discount if conditions are not met", () => {
    const config = {
      conditionLogic: "all",
      conditions: [{ type: "cart_total", operator: "gte", value: "100" }],
      action: { type: "free_product", target: "product", productId: "gid://shopify/Product/GIFT123", quantity: 1 },
      combinable: true,
    };

    const input = createMockInput({
      config,
      subtotalAmount: 50, // Condition NOT met
      lines: [
        { id: "line-1", quantity: 1, amountPerQuantity: 50, productId: "gid://shopify/Product/NORMAL1" },
        { id: "line-2", quantity: 1, amountPerQuantity: 0, productId: "gid://shopify/Product/GIFT123" }
      ],
    });

    const result = run(input);

    expect(result.discounts.length).toBe(0); // Empty discount
  });

  it("should apply percentage discount to a targeted product", () => {
    const config = {
      conditionLogic: "all",
      conditions: [], // No conditions
      action: { type: "percentage_off", value: "20", target: "product", targetId: "gid://shopify/Product/TARGET123" },
      combinable: false,
    };

    const input = createMockInput({
      config,
      lines: [
        { id: "line-1", quantity: 1, amountPerQuantity: 100, productId: "gid://shopify/Product/NORMAL1" },
        { id: "line-2", quantity: 2, amountPerQuantity: 50, productId: "gid://shopify/Product/TARGET123" }
      ],
    });

    const result = run(input);

    expect(result.discounts.length).toBe(1);
    expect(result.discounts[0].value).toEqual({ percentage: { value: 20 } });
    expect(result.discounts[0].targets.length).toBe(1);
    expect((result.discounts[0].targets[0] as any).cartLine.id).toBe("line-2");
    expect(result.discountApplicationStrategy).toBe(DiscountApplicationStrategy.First);
  });
});
