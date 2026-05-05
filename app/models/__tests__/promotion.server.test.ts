import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../db.server";

// Mock prisma
vi.mock("../../db.server", () => ({
    default: {
        promotion: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
            deleteMany: vi.fn(),
        },
    },
}));

// Import after mocking
import {
    getPromotions,
    getPromotion,
    createPromotion,
    updatePromotion,
    deletePromotion,
    togglePromotionStatus,
    duplicatePromotion,
    parsePromotion,
} from "../promotion.server";

describe("promotion.server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockPromo = {
        id: "promo_1",
        shop: "test-shop.myshopify.com",
        name: "Test Promotion",
        description: "A test promotion",
        status: "draft",
        priority: 5,
        conditionLogic: "all",
        conditions: JSON.stringify([{ id: "1", type: "cart_total", operator: "gte", value: "50" }]),
        action: JSON.stringify({ type: "percentage_off", value: "10", target: "order" }),
        combinable: false,
    };

    describe("getPromotions", () => {
        it("should fetch all promotions for a shop", async () => {
            vi.mocked(prisma.promotion.findMany).mockResolvedValue([mockPromo as any]);

            const result = await getPromotions("test-shop.myshopify.com");
            expect(prisma.promotion.findMany).toHaveBeenCalledWith({
                where: { shop: "test-shop.myshopify.com" },
                orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            });
            expect(result).toHaveLength(1);
        });

        it("should filter by status when provided", async () => {
            vi.mocked(prisma.promotion.findMany).mockResolvedValue([]);

            await getPromotions("test-shop.myshopify.com", "active");
            expect(prisma.promotion.findMany).toHaveBeenCalledWith({
                where: { shop: "test-shop.myshopify.com", status: "active" },
                orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            });
        });
    });

    describe("getPromotion", () => {
        it("should fetch a single promotion by id and shop", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue(mockPromo as any);

            const result = await getPromotion("promo_1", "test-shop.myshopify.com");
            expect(result).toEqual(mockPromo);
            expect(prisma.promotion.findFirst).toHaveBeenCalledWith({
                where: { id: "promo_1", shop: "test-shop.myshopify.com" },
            });
        });

        it("should return null when not found", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue(null);

            const result = await getPromotion("nonexistent", "test-shop.myshopify.com");
            expect(result).toBeNull();
        });
    });

    describe("createPromotion", () => {
        it("should create a promotion with JSON-serialized fields", async () => {
            const createData = {
                shop: "test-shop.myshopify.com",
                name: "New Promotion",
                conditions: [{ id: "1", type: "cart_total", operator: "gte", value: "100" }],
                action: { type: "fixed_amount_off", value: "15", target: "order" },
            };

            vi.mocked(prisma.promotion.create).mockResolvedValue({
                ...mockPromo,
                id: "new_id",
                name: "New Promotion",
            } as any);

            await createPromotion(createData);
            expect(prisma.promotion.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    shop: "test-shop.myshopify.com",
                    name: "New Promotion",
                    conditions: JSON.stringify(createData.conditions),
                    action: JSON.stringify(createData.action),
                }),
            });
        });
    });

    describe("updatePromotion", () => {
        it("should only update provided fields", async () => {
            vi.mocked(prisma.promotion.updateMany).mockResolvedValue({ count: 1 } as any);

            await updatePromotion("promo_1", "test-shop.myshopify.com", { name: "Updated Name" });
            expect(prisma.promotion.updateMany).toHaveBeenCalledWith({
                where: { id: "promo_1", shop: "test-shop.myshopify.com" },
                data: { name: "Updated Name" },
            });
        });
    });

    describe("deletePromotion", () => {
        it("should delete a promotion scoped to shop", async () => {
            vi.mocked(prisma.promotion.deleteMany).mockResolvedValue({ count: 1 } as any);

            await deletePromotion("promo_1", "test-shop.myshopify.com");
            expect(prisma.promotion.deleteMany).toHaveBeenCalledWith({
                where: { id: "promo_1", shop: "test-shop.myshopify.com" },
            });
        });
    });

    describe("togglePromotionStatus", () => {
        it("should toggle from draft to active", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue({ ...mockPromo, status: "draft" } as any);
            vi.mocked(prisma.promotion.updateMany).mockResolvedValue({ count: 1 } as any);

            const result = await togglePromotionStatus("promo_1", "test-shop.myshopify.com");
            expect(result).toBe("active");
        });

        it("should toggle from active to paused", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue({ ...mockPromo, status: "active" } as any);
            vi.mocked(prisma.promotion.updateMany).mockResolvedValue({ count: 1 } as any);

            const result = await togglePromotionStatus("promo_1", "test-shop.myshopify.com");
            expect(result).toBe("paused");
        });

        it("should return null if promotion not found", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue(null);

            const result = await togglePromotionStatus("nonexistent", "test-shop.myshopify.com");
            expect(result).toBeNull();
        });
    });

    describe("duplicatePromotion", () => {
        it("should create a copy with (copie) suffix and draft status", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue(mockPromo as any);
            vi.mocked(prisma.promotion.create).mockResolvedValue({} as any);

            await duplicatePromotion("promo_1", "test-shop.myshopify.com");
            expect(prisma.promotion.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    name: "Test Promotion (copie)",
                    status: "draft",
                }),
            });
        });

        it("should return null if original not found", async () => {
            vi.mocked(prisma.promotion.findFirst).mockResolvedValue(null);

            const result = await duplicatePromotion("nonexistent", "test-shop.myshopify.com");
            expect(result).toBeNull();
        });
    });

    describe("parsePromotion", () => {
        it("should parse JSON conditions and action fields", () => {
            const parsed = parsePromotion(mockPromo);
            expect(Array.isArray(parsed.conditions)).toBe(true);
            expect(parsed.conditions[0].type).toBe("cart_total");
            expect(typeof parsed.action).toBe("object");
            expect(parsed.action.type).toBe("percentage_off");
        });

        it("should handle empty JSON fields", () => {
            const raw = { ...mockPromo, conditions: "[]", action: "{}" };
            const parsed = parsePromotion(raw);
            expect(Array.isArray(parsed.conditions)).toBe(true);
            expect(parsed.conditions).toHaveLength(0);
            expect(parsed.action).toEqual({});
        });
    });
});