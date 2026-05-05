/**
 * Form validation for promotions.
 */
import type { ConditionInstance } from "../config/conditions";
import type { ActionInstance } from "../config/actions";
import { CONDITION_TYPES } from "../config/conditions";
import { ACTION_TYPES } from "../config/actions";

export interface ValidationErrors {
  [key: string]: string;
}

/**
 * Validate the promotion form data.
 * Returns an object with field-level errors, or empty object if valid.
 */
export function validatePromotion(data: {
  name?: string;
  conditions?: ConditionInstance[];
  action?: ActionInstance;
  startDate?: string | null;
  endDate?: string | null;
}): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.name || data.name.trim().length === 0) {
    errors.name = "Le nom de la promotion est requis";
  } else if (data.name.trim().length > 100) {
    errors.name = "Le nom ne peut pas dépasser 100 caractères";
  }

  // Must have at least one condition
  if (!data.conditions || data.conditions.length === 0) {
    errors.conditions = "Au moins une condition est requise";
  } else {
    // Validate each condition
    for (let i = 0; i < data.conditions.length; i++) {
      const condition = data.conditions[i];
      const condType = CONDITION_TYPES.find((c) => c.id === condition.type);

      if (!condType) {
        errors[`condition_${i}`] = "Type de condition invalide";
        continue;
      }

      if (!condition.operator) {
        errors[`condition_${i}`] = "L'opérateur est requis";
      }

      if (condType.valueType !== "boolean" && (!condition.value || condition.value.trim() === "")) {
        errors[`condition_${i}`] = "La valeur est requise";
      }

      // Validate numeric values
      if (condType.valueType === "number" && condition.value) {
        const num = parseFloat(condition.value);
        if (isNaN(num) || num < 0) {
          errors[`condition_${i}`] = "La valeur doit être un nombre positif";
        }
      }
    }
  }

  // Action is required
  if (!data.action || !data.action.type) {
    errors.action = "Une action est requise";
  } else {
    const actionType = ACTION_TYPES.find((a) => a.id === data.action!.type);

    if (!actionType) {
      errors.action = "Type d'action invalide";
    } else {
      // Validate value if required
      if (actionType.hasValue && (!data.action.value || data.action.value.trim() === "")) {
        errors.actionValue = "La valeur de l'action est requise";
      }

      if (actionType.hasValue && data.action.value) {
        const num = parseFloat(data.action.value);
        if (isNaN(num) || num <= 0) {
          errors.actionValue = "La valeur doit être un nombre positif";
        }
        // Percentage cannot exceed 100
        if (data.action.type === "percentage_off" && num > 100) {
          errors.actionValue = "Le pourcentage ne peut pas dépasser 100%";
        }
      }

      // Validate target if required
      if (actionType.hasTarget && !data.action.target) {
        errors.actionTarget = "La cible de l'action est requise";
      }

      // Validate targetId when targeting a specific product or collection
      if (
        actionType.hasTarget &&
        (data.action.target === "product" || data.action.target === "collection") &&
        !data.action.targetId
      ) {
        errors.actionTarget = data.action.target === "product"
          ? "Sélectionnez un produit cible"
          : "Sélectionnez une collection cible";
      }

      // Validate product picker for GWP
      if (actionType.hasProductPicker && !data.action.productId) {
        errors.actionProduct = "Sélectionnez un produit à offrir";
      }
    }
  }

  // Validate date range
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end <= start) {
      errors.endDate = "La date de fin doit être après la date de début";
    }
  }

  return errors;
}

/**
 * Check if validation passed (no errors).
 */
export function isValid(errors: ValidationErrors): boolean {
  return Object.keys(errors).length === 0;
}
