import type {
  RunInput,
  FunctionRunResult,
  Discount,
  Target
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
 * are pre-resolved server-side: `resolvedProductIds` contains
 * the product GIDs needed for runtime evaluation.
 */
type Configuration = {
  conditionLogic: "all" | "any";
  conditions: ResolvedCondition[];
  action: {
    type: string;
    value: string;
    target: string;
    targetId?: string;
    productId?: string;
    variantId?: string;
    price?: string;
    quantity?: number;
    /** Pre-resolved product GIDs for collection-targeted discounts */
    resolvedTargetProductIds?: string[];
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

function evaluateCondition(cond: ResolvedCondition, input: RunInput, action: Configuration["action"]): boolean {
  switch (cond.type) {
    case "cart_total": {
      let actual = parseFloat(input.cart.cost.subtotalAmount.amount);
      
      // Fix: Subtract the gift product's price from the subtotal so it doesn't count towards its own threshold!
      if (action && action.type === "free_product" && action.variantId) {
        const giftVariantId = `gid://shopify/ProductVariant/${action.variantId}`;
        const giftLine = input.cart.lines.find(l => 
          l.merchandise.__typename === "ProductVariant" && 
          l.merchandise.id === giftVariantId
        );
        if (giftLine && giftLine.cost && giftLine.cost.amountPerQuantity) {
            actual -= (parseFloat(giftLine.cost.amountPerQuantity.amount) * giftLine.quantity);
        }
      }

      const expected = parseFloat(cond.value);
      return compareNumbers(actual, expected, cond.operator);
    }

    case "item_count": {
      let actual = input.cart.lines.reduce((sum, line) => sum + line.quantity, 0);
      
      // Fix: Subtract the gift product's quantity from the item count
      if (action && action.type === "free_product" && action.variantId) {
        const giftVariantId = `gid://shopify/ProductVariant/${action.variantId}`;
        const giftLine = input.cart.lines.find(l => 
          l.merchandise.__typename === "ProductVariant" && 
          l.merchandise.id === giftVariantId
        );
        if (giftLine) {
            actual -= giftLine.quantity;
        }
      }

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

// ── Target resolution ────────────────────────────────────────────────────

/**
 * Determines which cart lines should receive the discount.
 * Returns an empty array if no matching lines are found.
 */
function resolveTargets(action: Configuration["action"], input: RunInput): Target[] {
  const targets: Target[] = [];

  if (action.type === "free_product" && action.productId) {
    // GWP: find the free product in cart and discount it
    const freeLine = input.cart.lines.find(line => {
      const md = line.merchandise;
      return md.__typename === "ProductVariant" && md.product.id === action.productId;
    });

    if (freeLine) {
      targets.push({
        cartLine: { id: freeLine.id, quantity: action.quantity || 1 }
      });
    }
    return targets;
  }

  if (action.target === "product" && action.targetId) {
    // Specific product target
    for (const line of input.cart.lines) {
      const md = line.merchandise;
      if (md.__typename === "ProductVariant" && md.product.id === action.targetId) {
        targets.push({ cartLine: { id: line.id } });
      }
    }
    return targets;
  }

  if (action.target === "collection" && action.resolvedTargetProductIds) {
    // Collection target: pre-resolved product IDs from the sync service
    const collectionProductIds = action.resolvedTargetProductIds;
    for (const line of input.cart.lines) {
      const md = line.merchandise;
      if (md.__typename === "ProductVariant" && collectionProductIds.includes(md.product.id)) {
        targets.push({ cartLine: { id: line.id } });
      }
    }
    return targets;
  }

  return targets;
}

// ── Discount value computation ───────────────────────────────────────────

/**
 * Computes the discount value for a given action and target line.
 * For `fixed_price`, it calculates per-line because it depends on the line price.
 */
function computeDiscountValue(
  action: Configuration["action"],
  line?: { id: string; cost?: any }
): Discount["value"] | null {
  switch (action.type) {
    case "free_product":
      return { percentage: { value: 100 } };

    case "percentage_off":
      return { percentage: { value: parseFloat(action.value) } };

    case "fixed_amount_off":
      return { fixedAmount: { amount: parseFloat(action.value) } };

    case "fixed_price": {
      // fixed_price needs per-line calculation: discount = currentPrice - fixedPrice
      if (!line) return null;
      const currentPrice = parseFloat((line.cost as any)?.amountPerQuantity?.amount || "0");
      const fixedPrice = parseFloat(action.value);
      const discountAmount = Math.max(0, currentPrice - fixedPrice);
      if (discountAmount <= 0) return null;
      return { fixedAmount: { amount: discountAmount } };
    }

    default:
      return null;
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
    const results = config.conditions.map(cond => evaluateCondition(cond, input, config.action));
    const pass = config.conditionLogic === "all"
      ? results.every(Boolean)
      : results.some(Boolean);

    if (!pass) return EMPTY_DISCOUNT;
  }

  // 2. Resolve target lines
  const action = config.action;
  const targets = resolveTargets(action, input);
  if (targets.length === 0) return EMPTY_DISCOUNT;

  // 3. Build discounts
  // For fixed_price, we need per-line discount values
  if (action.type === "fixed_price") {
    const discounts: Discount[] = [];
    for (const target of targets) {
      const lineId = (target as any).cartLine?.id;
      const line = input.cart.lines.find(l => l.id === lineId);
      const value = computeDiscountValue(action, line);
      if (value) {
        discounts.push({
          value,
          targets: [target],
          message: "Promotion appliquée !",
        });
      }
    }
    if (discounts.length === 0) return EMPTY_DISCOUNT;

    return {
      discountApplicationStrategy: config.combinable
        ? DiscountApplicationStrategy.Maximum
        : DiscountApplicationStrategy.First,
      discounts,
    };
  }

  // For all other types, one discount covers all targets
  const value = computeDiscountValue(action);
  if (!value) return EMPTY_DISCOUNT;

  const discount: Discount = {
    value,
    targets,
    message: "Promotion appliquée !",
  };

  return {
    discountApplicationStrategy: config.combinable
      ? DiscountApplicationStrategy.Maximum
      : DiscountApplicationStrategy.First,
    discounts: [discount],
  };
}