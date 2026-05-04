import type {
  RunInput,
  FunctionRunResult,
  Discount
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * Configuration stored in the discount metafield.
 * Complex conditions (contains_collection, product_tag, customer_tag)
 * are pre-resolved server-side: their `resolvedProductIds` or `resolvedValue`
 * fields contain the data needed for runtime evaluation.
 */
type Configuration = {
  conditionLogic: "all" | "any";
  conditions: ResolvedCondition[];
  action: {
    type: string;
    value: string;
    target: string;
  };
  combinable: boolean;
};

type ResolvedCondition = {
  type: string;
  operator: string;
  value: string;
  /** Pre-resolved product GIDs for collection/tag conditions */
  resolvedProductIds?: string[];
};

/**
 * Evaluate a single condition against the current cart.
 *
 * Conditions that depend on catalog data (collections, tags) are
 * pre-resolved server-side — the sync service populates `resolvedProductIds`
 * so the Function only needs to check cart line product IDs against that list.
 */
function evaluateCondition(cond: ResolvedCondition, input: RunInput): boolean {
  switch (cond.type) {
    // ── Cart-level conditions ──────────────────────────────────────────

    case "cart_total": {
      const actual = parseFloat(input.cart.cost.subtotalAmount.amount);
      const expected = parseFloat(cond.value);
      return compareNumbers(actual, expected, cond.operator);
    }

    case "item_count": {
      const actual = input.cart.lines.reduce((sum, line) => sum + line.quantity, 0);
      const expected = parseInt(cond.value, 10);
      return compareNumbers(actual, expected, cond.operator);
    }

    // ── Product-in-cart conditions ──────────────────────────────────────

    case "contains_product": {
      const cartProductIds = getCartProductIds(input);
      const hasProduct = cartProductIds.includes(cond.value);

      return cond.operator === "not_contains" ? !hasProduct : hasProduct;
    }

    case "contains_collection": {
      // Pre-resolved: resolvedProductIds = all product GIDs in the collection
      const resolvedIds = cond.resolvedProductIds || [];
      if (resolvedIds.length === 0) return false;

      const cartProductIds = getCartProductIds(input);
      const hasAny = cartProductIds.some(id => resolvedIds.includes(id));

      return cond.operator === "not_contains" ? !hasAny : hasAny;
    }

    case "product_tag": {
      // Pre-resolved: resolvedProductIds = all product GIDs with this tag
      const resolvedIds = cond.resolvedProductIds || [];
      if (resolvedIds.length === 0) return cond.operator === "not_contains";

      const cartProductIds = getCartProductIds(input);
      const hasAny = cartProductIds.some(id => resolvedIds.includes(id));

      return cond.operator === "not_contains" ? !hasAny : hasAny;
    }

    // ── Customer conditions ────────────────────────────────────────────

    case "customer_first_order": {
      const numberOfOrders = input.cart.buyerIdentity?.customer?.numberOfOrders || 0;
      const isFirstOrder = numberOfOrders === 0;
      const expected = cond.value !== "false"; // default "true"
      return isFirstOrder === expected;
    }

    case "customer_tag": {
      // Pre-resolved server-side: value is set to "true"/"false"
      // based on whether the customer actually has the tag.
      // If not pre-resolved, we can't evaluate → fail safe.
      if (cond.resolvedProductIds !== undefined) {
        // resolvedProductIds is repurposed here: if non-empty, customer HAS the tag
        const hasTag = cond.resolvedProductIds.length > 0;
        return cond.operator === "not_contains" ? !hasTag : hasTag;
      }
      return false; // Can't evaluate without pre-resolution
    }

    // ── Unknown condition → fail safe ──────────────────────────────────
    default:
      return false;
  }
}

/** Extract all product GIDs from cart lines */
function getCartProductIds(input: RunInput): string[] {
  return input.cart.lines
    .map(l => l.merchandise)
    .filter((m): m is Extract<typeof m, { __typename: "ProductVariant" }> =>
      m.__typename === "ProductVariant"
    )
    .map(m => m.product.id);
}

/** Numeric comparison helper */
function compareNumbers(actual: number, expected: number, operator: string): boolean {
  switch (operator) {
    case "eq":  return actual === expected;
    case "neq": return actual !== expected;
    case "gt":  return actual > expected;
    case "gte": return actual >= expected;
    case "lt":  return actual < expected;
    case "lte": return actual <= expected;
    default:    return false;
  }
}

// ── Main entry point ─────────────────────────────────────────────────────

export function run(input: RunInput): FunctionRunResult {
  const configValue = input?.discountNode?.metafield?.value;
  if (!configValue) return EMPTY_DISCOUNT;

  let config: Configuration;
  try {
    config = JSON.parse(configValue);
    // Handle double-serialization edge case
    if (typeof config.conditions === "string") {
      config.conditions = JSON.parse(config.conditions as any);
    }
    if (typeof config.action === "string") {
      config.action = JSON.parse(config.action as any);
    }
  } catch {
    return EMPTY_DISCOUNT;
  }

  // 1. Evaluate all conditions
  if (config.conditions && config.conditions.length > 0) {
    const results = config.conditions.map(cond => evaluateCondition(cond, input));
    const pass = config.conditionLogic === "all"
      ? results.every(Boolean)
      : results.some(Boolean);

    if (!pass) return EMPTY_DISCOUNT;
  }

  // 2. Build discount value (order-level only supports percentage and fixed amount)
  const action = config.action;
  let value: Discount["value"] | null = null;

  switch (action.type) {
    case "percentage_off":
      value = { percentage: { value: parseFloat(action.value) } };
      break;

    case "fixed_amount_off":
      value = { fixedAmount: { amount: parseFloat(action.value) } };
      break;

    default:
      // Order discount only handles percentage_off and fixed_amount_off
      return EMPTY_DISCOUNT;
  }

  if (!value) return EMPTY_DISCOUNT;

  const discount: Discount = {
    value,
    targets: [
      { orderSubtotal: { excludedVariantIds: [] } }
    ],
    message: "Promotion appliquée !",
  };

  return {
    discountApplicationStrategy: config.combinable
      ? DiscountApplicationStrategy.Maximum
      : DiscountApplicationStrategy.First,
    discounts: [discount],
  };
}