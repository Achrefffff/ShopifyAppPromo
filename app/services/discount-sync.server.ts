/**
 * Discount Sync Service
 *
 * Responsible for synchronizing promotions with Shopify's Discount API.
 * Key responsibilities:
 * - Pre-resolving complex conditions (collections, tags) into product ID lists
 * - Creating/updating Shopify automatic app discounts
 * - Syncing active promotions to a shop-level metafield for the theme extension
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  getPromotion,
  getPromotions,
  updatePromotion,
} from "../models/promotion.server";
import type { PromotionData } from "../models/promotion.server";

// ── Pre-resolution helpers ───────────────────────────────────────────────

/**
 * Resolve a collection GID to a list of product GIDs.
 * Fetches all products in the collection (paginated up to 250).
 */
async function resolveCollectionProductIds(
  collectionGid: string,
  graphql: AdminApiContext["graphql"]
): Promise<string[]> {
  const productIds: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const pageSize = 250;

  try {
    while (hasNextPage) {
      const gqlResponse: Response = await graphql(
        `#graphql
        query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
          collection(id: $collectionId) {
            products(first: $first, after: $after) {
              nodes { id }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }`,
        { variables: { collectionId: collectionGid, first: pageSize, after: cursor } }
      );
      const gqlData: any = await gqlResponse.json();
      const products = gqlData.data?.collection?.products;
      const nodes = products?.nodes || [];
      for (const node of nodes) {
        productIds.push(node.id);
      }
      hasNextPage = products?.pageInfo?.hasNextPage ?? false;
      cursor = products?.pageInfo?.endCursor ?? null;
    }
  } catch (e) {
    console.error(`Failed to resolve collection ${collectionGid}:`, e);
  }

  return productIds;
}

/**
 * Resolve a product tag to a list of product GIDs.
 * Fetches all products with the given tag (paginated up to 250).
 */
async function resolveTagProductIds(
  tag: string,
  graphql: AdminApiContext["graphql"]
): Promise<string[]> {
  const productIds: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const pageSize = 250;

  try {
    while (hasNextPage) {
      const gqlResponse: Response = await graphql(
        `#graphql
        query GetProductsByTag($query: String!, $first: Int!, $after: String) {
          products(first: $first, query: $query, after: $after) {
            nodes { id }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { variables: { query: `tag:${tag}`, first: pageSize, after: cursor } }
      );
      const gqlData: any = await gqlResponse.json();
      const products = gqlData.data?.products;
      const nodes = products?.nodes || [];
      for (const node of nodes) {
        productIds.push(node.id);
      }
      hasNextPage = products?.pageInfo?.hasNextPage ?? false;
      cursor = products?.pageInfo?.endCursor ?? null;
    }
  } catch (e) {
    console.error(`Failed to resolve products with tag "${tag}":`, e);
  }

  return productIds;
}

/**
 * Pre-resolve complex conditions that can't be evaluated at runtime
 * in the Shopify Function (because the GraphQL input query is static).
 *
 * This enriches each condition with a `resolvedProductIds` field
 * containing the product GIDs needed for runtime checks.
 */
async function resolveConditions(
  conditions: any[],
  graphql: AdminApiContext["graphql"]
): Promise<any[]> {
  const resolved = [];

  for (const condition of conditions) {
    const enriched = { ...condition };

    switch (condition.type) {
      case "contains_collection":
        if (condition.value) {
          enriched.resolvedProductIds = await resolveCollectionProductIds(
            condition.value,
            graphql
          );
        }
        break;

      case "product_tag":
        if (condition.value) {
          enriched.resolvedProductIds = await resolveTagProductIds(
            condition.value,
            graphql
          );
        }
        break;

      case "customer_tag":
        // Customer tags can't be pre-resolved to product IDs.
        // We mark this as "needs runtime check" — the Function
        // will use its own logic with the customer data it has.
        // For now, we pass an empty marker so the Function knows
        // this condition exists but can't be pre-resolved.
        enriched.resolvedProductIds = [];
        break;
    }

    resolved.push(enriched);
  }

  return resolved;
}

/**
 * Pre-resolve the product IDs for a collection-targeted action.
 * This allows the Product Discount Function to know which cart lines to target.
 */
async function resolveActionTargetProducts(
  action: any,
  graphql: AdminApiContext["graphql"]
): Promise<any> {
  if (action.target === "collection" && action.targetId) {
    const resolvedTargetProductIds = await resolveCollectionProductIds(
      action.targetId,
      graphql
    );
    return { ...action, resolvedTargetProductIds };
  }
  return action;
}

// ── Discount CRUD ────────────────────────────────────────────────────────

/**
 * Create or update a Shopify automatic app discount for a promotion.
 *
 * Flow:
 * 1. Parse & pre-resolve conditions and action
 * 2. Determine which Shopify Function to use
 * 3. Create/update the discount via GraphQL
 * 4. Activate/deactivate based on promotion status
 */
export async function upsertDiscount(
  promotionId: string,
  promotion: PromotionData,
  graphql: AdminApiContext["graphql"],
  shop: string
) {
  // ── Parse JSON fields (handle double-serialization) ──
  let action = promotion.action;
  while (typeof action === "string") {
    try { action = JSON.parse(action); } catch { break; }
  }

  let conditions = promotion.conditions;
  while (typeof conditions === "string") {
    try { conditions = JSON.parse(conditions); } catch { break; }
  }

  // ── Pre-resolve complex conditions and action targets ──
  const resolvedConditions = await resolveConditions(conditions as any[], graphql);
  const resolvedAction = await resolveActionTargetProducts(action, graphql);

  // ── Determine which Shopify Function to use ──
  const actionType = (resolvedAction as any).type;
  let functionTitle = "";

  if (actionType === "free_shipping") {
    functionTitle = "kea-shipping-discount";
  } else if ((resolvedAction as any).target === "order") {
    functionTitle = "kea-order-discount";
  } else {
    // product, collection, free_product → all go to product-discount
    functionTitle = "kea-product-discount";
  }

  // ── Find the Function ID ──
  const functionsQuery = await graphql(
    `#graphql
    query GetFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
        }
      }
    }`
  );
  const functionsResult = await functionsQuery.json();
  const functions = functionsResult.data?.shopifyFunctions?.nodes || [];
  const targetFunction = functions.find((f: any) => f.title === functionTitle);

  if (!targetFunction) {
    throw new Error(`Shopify Function "${functionTitle}" not found. Make sure extensions are deployed.`);
  }

  // ── Build the metafield config ──
  const configMetafield = {
    namespace: "kea_promo",
    key: "config",
    type: "json",
    value: JSON.stringify({
      conditionLogic: promotion.conditionLogic,
      conditions: resolvedConditions,
      action: resolvedAction,
      combinable: promotion.combinable,
    }),
  };

  // ── Build the discount input ──
  const discountInput: any = {
    title: `${promotion.name} [${promotionId.substring(0, 5)}]`,
    functionId: targetFunction.id,
    startsAt: promotion.startDate
      ? new Date(promotion.startDate).toISOString()
      : new Date().toISOString(),
    combinesWith: {
      orderDiscounts: promotion.combinable || false,
      productDiscounts: promotion.combinable || false,
      shippingDiscounts: promotion.combinable || false,
    },
    metafields: [configMetafield],
  };

  if (promotion.endDate) {
    discountInput.endsAt = new Date(promotion.endDate).toISOString();
  }

  // ── Check for existing Shopify discount ──
  const currentPromo = await getPromotion(promotionId, shop);
  const shopifyDiscountId = currentPromo?.shopifyDiscountId;

  if (shopifyDiscountId) {
    // Check if the function type has changed (e.g., order → shipping).
    // Shopify does NOT allow changing functionId after creation,
    // so we must delete the old discount and create a new one.
    // Also handles migration: old promos with no functionType stored → recreate.
    const currentFunctionType = currentPromo?.functionType;
    const needsRecreate = !currentFunctionType || currentFunctionType !== functionTitle;

    if (needsRecreate) {
      // Delete old discount, create new one
      try {
        await deleteDiscount(shopifyDiscountId, graphql);
      } catch (e) {
        console.error("Failed to delete old discount during function type change:", e);
      }

      const newDiscountId = await createNewDiscount(
        discountInput,
        promotion.status || "draft",
        graphql
      );
      await updatePromotion(promotionId, shop, {
        shopifyDiscountId: newDiscountId,
        functionType: functionTitle,
      });
      return newDiscountId;
    }

    // Same function type → update in place (strip functionId, Shopify forbids changing it)
    const { functionId: _removed, ...updateInput } = discountInput;
    return await updateExistingDiscount(
      shopifyDiscountId,
      updateInput,
      promotion.status || "draft",
      graphql
    );
  } else {
    const newDiscountId = await createNewDiscount(
      discountInput,
      promotion.status || "draft",
      graphql
    );

    // Save the Shopify discount ID and function type back to the DB
    await updatePromotion(promotionId, shop, {
      shopifyDiscountId: newDiscountId,
      functionType: functionTitle,
    });

    // Sync all active promotions to shop metafield for the theme extension
    await syncActivePromotionsMetafield(graphql, shop);

    return newDiscountId;
  }
}

async function updateExistingDiscount(
  discountId: string,
  discountInput: any,
  status: string,
  graphql: AdminApiContext["graphql"]
): Promise<string> {
  const response = await graphql(
    `#graphql
    mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: discountId,
        automaticAppDiscount: discountInput,
      },
    }
  );

  const data = await response.json();
  const errors = data.data?.discountAutomaticAppUpdate?.userErrors || [];
  if (errors.length > 0) {
    console.error("Failed to update discount:", errors);
    throw new Error(`Shopify API Error: ${errors[0].message}`);
  }

  // Activate or deactivate based on status
  await setDiscountActiveState(discountId, status, graphql);

  return discountId;
}

async function createNewDiscount(
  discountInput: any,
  status: string,
  graphql: AdminApiContext["graphql"]
): Promise<string> {
  const response = await graphql(
    `#graphql
    mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        automaticAppDiscount: discountInput,
      },
    }
  );

  const data = await response.json();
  const errors = data.data?.discountAutomaticAppCreate?.userErrors || [];
  if (errors.length > 0) {
    console.error("Failed to create discount:", errors);
    throw new Error(`Shopify API Error: ${errors[0].message}`);
  }

  const newDiscountId = data.data.discountAutomaticAppCreate.automaticAppDiscount.discountId;

  // Deactivate if draft/paused
  if (status === "paused" || status === "draft") {
    await setDiscountActiveState(newDiscountId, status, graphql);
  }

  return newDiscountId;
}

async function setDiscountActiveState(
  discountId: string,
  status: string,
  graphql: AdminApiContext["graphql"]
) {
  const shouldDeactivate = status === "paused" || status === "draft";
  const mutation = shouldDeactivate
    ? `#graphql
      mutation discountAutomaticDeactivate($id: ID!) {
        discountAutomaticDeactivate(id: $id) {
          userErrors { field message }
        }
      }`
    : `#graphql
      mutation discountAutomaticActivate($id: ID!) {
        discountAutomaticActivate(id: $id) {
          userErrors { field message }
        }
      }`;

  await graphql(mutation, { variables: { id: discountId } });
}

// ── Discount deletion ────────────────────────────────────────────────────

export async function deleteDiscount(
  shopifyDiscountId: string,
  graphql: AdminApiContext["graphql"]
) {
  const response = await graphql(
    `#graphql
    mutation discountAutomaticDelete($id: ID!) {
      discountAutomaticDelete(id: $id) {
        deletedAutomaticDiscountId
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: shopifyDiscountId } }
  );

  const data = await response.json();
  const errors = data.data?.discountAutomaticDelete?.userErrors || [];
  if (errors.length > 0) {
    console.error("Failed to delete discount:", errors);
    throw new Error(`Shopify API Error: ${errors[0].message}`);
  }

  // Update shop metafield
  // Note: we can't easily get the shop here without passing it, 
  // but usually this is called from a context where we have it.
}

/**
 * Synchronizes all currently active promotions to a shop-level metafield.
 * This allows the Theme App Extension to read the rules and automate GWP.
 */
export async function syncActivePromotionsMetafield(
  graphql: AdminApiContext["graphql"],
  shop: string
) {
  try {
    const activePromos = await getPromotions(shop, "active");

    // Format them for the frontend
    const rules = [];
    for (const p of activePromos) {
      let action: any = p.action;
      while (typeof action === "string") { action = JSON.parse(action); }

      let conditions = p.conditions;
      while (typeof conditions === "string") { conditions = JSON.parse(conditions); }

      // If it's a GWP, we need the numeric Variant ID and price for the Ajax API and logic
      if (action.type === "free_product" && action.productId) {
        const variant = await resolveFirstVariantInfo(action.productId, graphql);
        if (variant) {
          action.variantId = variant.id.split("/").pop(); // Numeric ID
          action.price = variant.price; // For threshold calculation
        }
      }

      rules.push({
        id: p.id,
        conditionLogic: p.conditionLogic,
        conditions: conditions,
        action: action,
        combinable: p.combinable
      });
    }

    await graphql(
      `#graphql
      mutation CreateShopMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            key
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              namespace: "kea_promo",
              key: "active_promotions",
              type: "json",
              ownerId: (await getShopId(graphql)),
              value: JSON.stringify(rules)
            }
          ]
        }
      }
    );
  } catch (e) {
    console.error("Failed to sync active promotions metafield:", e);
  }
}

async function getShopId(graphql: AdminApiContext["graphql"]): Promise<string> {
  const response = await graphql(
    `#graphql
    query {
      shop {
        id
      }
    }`
  );
  const data = await response.json();
  return data.data.shop.id;
}

async function resolveFirstVariantInfo(productGid: string, graphql: AdminApiContext["graphql"]): Promise<{ id: string, price: string } | null> {
  try {
    const response = await graphql(
      `#graphql
      query GetProductVariant($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            nodes {
              id
              price
            }
          }
        }
      }`,
      { variables: { id: productGid } }
    );
    const data = await response.json();
    const node = data.data?.product?.variants?.nodes?.[0];
    return node ? { id: node.id, price: node.price } : null;
  } catch (e) {
    console.error("Failed to resolve variant info:", e);
    return null;
  }
}

