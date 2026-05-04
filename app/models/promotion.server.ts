/**
 * Promotion CRUD operations using Prisma.
 * Server-only module — all database interactions go through here.
 */
import prisma from "../db.server";
import type { ConditionInstance } from "../config/conditions";
import type { ActionInstance } from "../config/actions";

export interface PromotionData {
  shop: string;
  name: string;
  description?: string;
  status?: string;
  priority?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  conditionLogic?: string;
  conditions: ConditionInstance[];
  action: ActionInstance;
  combinable?: boolean;
  shopifyDiscountId?: string;
  functionType?: string;
}

/**
 * Get all promotions for a shop, ordered by priority then creation date.
 */
export async function getPromotions(shop: string, status?: string) {
  const where: any = { shop };
  if (status) {
    where.status = status;
  }
  return prisma.promotion.findMany({
    where,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * Get a single promotion by ID (scoped to shop).
 */
export async function getPromotion(id: string, shop: string) {
  return prisma.promotion.findFirst({
    where: { id, shop },
  });
}

/**
 * Create a new promotion.
 */
export async function createPromotion(data: PromotionData) {
  return prisma.promotion.create({
    data: {
      shop: data.shop,
      name: data.name,
      description: data.description || null,
      status: data.status || "draft",
      priority: data.priority || 0,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      conditionLogic: data.conditionLogic || "all",
      conditions: JSON.stringify(data.conditions),
      action: JSON.stringify(data.action),
      combinable: data.combinable || false,
    },
  });
}

/**
 * Update an existing promotion.
 */
export async function updatePromotion(id: string, shop: string, data: Partial<PromotionData>) {
  const updateData: any = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.endDate !== undefined) updateData.endDate = data.endDate;
  if (data.conditionLogic !== undefined) updateData.conditionLogic = data.conditionLogic;
  if (data.conditions !== undefined) updateData.conditions = JSON.stringify(data.conditions);
  if (data.action !== undefined) updateData.action = JSON.stringify(data.action);
  if (data.combinable !== undefined) updateData.combinable = data.combinable;
  if (data.shopifyDiscountId !== undefined) updateData.shopifyDiscountId = data.shopifyDiscountId;
  if (data.functionType !== undefined) updateData.functionType = data.functionType;

  return prisma.promotion.updateMany({
    where: { id, shop },
    data: updateData,
  });
}

/**
 * Delete a promotion.
 */
export async function deletePromotion(id: string, shop: string) {
  return prisma.promotion.deleteMany({
    where: { id, shop },
  });
}

/**
 * Toggle promotion status (activate/deactivate).
 */
export async function togglePromotionStatus(id: string, shop: string) {
  const promo = await getPromotion(id, shop);
  if (!promo) return null;

  const newStatus = promo.status === "active" ? "paused" : "active";
  await updatePromotion(id, shop, { status: newStatus });
  return newStatus;
}

/**
 * Duplicate a promotion.
 */
export async function duplicatePromotion(id: string, shop: string) {
  const original = await getPromotion(id, shop);
  if (!original) return null;

  return prisma.promotion.create({
    data: {
      shop: original.shop,
      name: `${original.name} (copie)`,
      description: original.description,
      status: "draft",
      priority: original.priority,
      conditionLogic: original.conditionLogic,
      conditions: original.conditions,
      action: original.action,
      combinable: original.combinable,
    },
  });
}

/**
 * Parse JSON fields from a raw promotion record.
 */
export function parsePromotion(promo: any) {
  return {
    ...promo,
    conditions: JSON.parse(promo.conditions || "[]") as ConditionInstance[],
    action: JSON.parse(promo.action || "{}") as ActionInstance,
  };
}
