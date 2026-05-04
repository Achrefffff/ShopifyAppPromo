import type {
  RunInput,
  FunctionRunResult,
  Discount,
  Target
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discounts: [],
};

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
  resolvedProductIds?: string[];
};

// ── Condition evaluation ─────────────────────────────────────────────────

function evaluateCondition(cond: ResolvedCondition, input: RunInput): boolean {
  switch (cond.type) {
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

    case "contains_product": {
      const cartProductIds = getCartProductIds(input);
      const hasProduct = cartProductIds.includes(cond.value);
      return cond.operator === "not_contains" ? !hasProduct : hasProduct;
    }

    case "contains_collection": {
      const resolvedIds = cond.resolvedProductIds || [];
      if (resolvedIds.length === 0) return false;
      const cartProductIds = getCartProductIds(input);
      const hasAny = cartProductIds.some(id => resolvedIds.includes(id));
      return cond.operator === "not_contains" ? !hasAny : hasAny;
    }

    case "product_tag": {
      const resolvedIds = cond.resolvedProductIds || [];
      if (resolvedIds.length === 0) return cond.operator === "not_contains";
      const cartProductIds = getCartProductIds(input);
      const hasAny = cartProductIds.some(id => resolvedIds.includes(id));
      return cond.operator === "not_contains" ? !hasAny : hasAny;
    }

    case "customer_first_order": {
      const numberOfOrders = input.cart.buyerIdentity?.customer?.numberOfOrders || 0;
      const isFirstOrder = numberOfOrders === 0;
      const expected = cond.value !== "false";
      return isFirstOrder === expected;
    }

    case "customer_tag": {
      if (cond.resolvedProductIds !== undefined) {
        const hasTag = cond.resolvedProductIds.length > 0;
        return cond.operator === "not_contains" ? !hasTag : hasTag;
      }
      return false;
    }

    default:
      return false;
  }
}

function getCartProductIds(input: RunInput): string[] {
  return input.cart.lines
    .map(l => l.merchandise)
    .filter((m): m is Extract<typeof m, { __typename: "ProductVariant" }> =>
      m.__typename === "ProductVariant"
    )
    .map(m => m.product.id);
}

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

  // 2. This extension only handles free_shipping
  if (config.action.type !== "free_shipping") {
    return EMPTY_DISCOUNT;
  }

  // 3. Target all delivery groups
  const deliveryGroups = input.cart.deliveryGroups;
  if (!deliveryGroups || deliveryGroups.length === 0) {
    return EMPTY_DISCOUNT;
  }

  const targets: Target[] = deliveryGroups.map(group => ({
    deliveryGroup: { id: group.id }
  }));

  const discount: Discount = {
    value: {
      percentage: { value: 100 }
    },
    targets,
    message: "Livraison offerte !",
  };

  return {
    discounts: [discount],
  };
}