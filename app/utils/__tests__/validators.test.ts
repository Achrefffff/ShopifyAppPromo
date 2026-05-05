import { describe, it, expect } from "vitest";
import { validatePromotion, isValid } from "../validators";

describe("validatePromotion", () => {
    it("should return errors when name is empty", () => {
        const errors = validatePromotion({ name: "", conditions: [], action: undefined });
        expect(errors.name).toBe("Le nom de la promotion est requis");
        expect(isValid(errors)).toBe(false);
    });

    it("should return errors when name exceeds 100 characters", () => {
        const errors = validatePromotion({ name: "A".repeat(101), conditions: [], action: undefined });
        expect(errors.name).toBe("Le nom ne peut pas dépasser 100 caractères");
    });

    it("should return errors when no conditions provided", () => {
        const errors = validatePromotion({ name: "Test", conditions: [], action: undefined });
        expect(errors.conditions).toBe("Au moins une condition est requise");
    });

    it("should return errors when condition value is missing for non-boolean types", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "" },
            ],
            action: { type: "percentage_off", value: "10", target: "order" },
        });
        expect(errors.condition_0).toBe("La valeur est requise");
    });

    it("should return errors when numeric condition value is negative", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "-5" },
            ],
            action: { type: "percentage_off", value: "10", target: "order" },
        });
        expect(errors.condition_0).toBe("La valeur doit être un nombre positif");
    });

    it("should return errors when no action type provided", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: undefined,
        });
        expect(errors.action).toBe("Une action est requise");
    });

    it("should return errors when percentage exceeds 100", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: { type: "percentage_off", value: "150", target: "order" },
        });
        expect(errors.actionValue).toBe("Le pourcentage ne peut pas dépasser 100%");
    });

    it("should return errors when end date is before start date", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: { type: "percentage_off", value: "10", target: "order" },
            startDate: "2026-06-01",
            endDate: "2026-05-01",
        });
        expect(errors.endDate).toBe("La date de fin doit être après la date de début");
    });

    it("should pass validation with valid data", () => {
        const errors = validatePromotion({
            name: "Soldes Été 2026",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: { type: "percentage_off", value: "20", target: "order" },
        });
        expect(isValid(errors)).toBe(true);
        expect(Object.keys(errors).length).toBe(0);
    });

    it("should pass validation with boolean conditions (no value required)", () => {
        const errors = validatePromotion({
            name: "First order",
            conditions: [
                { id: "1", type: "customer_first_order", operator: "eq", value: "true" },
            ],
            action: { type: "free_shipping" },
        });
        expect(isValid(errors)).toBe(true);
    });

    it("should return error when target is product but no targetId", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: { type: "percentage_off", value: "10", target: "product" },
        });
        expect(errors.actionTarget).toBe("Sélectionnez un produit cible");
    });

    it("should pass validation with product target and targetId", () => {
        const errors = validatePromotion({
            name: "Test",
            conditions: [
                { id: "1", type: "cart_total", operator: "gte", value: "50" },
            ],
            action: { type: "percentage_off", value: "10", target: "product", targetId: "gid://shopify/Product/123" },
        });
        expect(isValid(errors)).toBe(true);
    });
});