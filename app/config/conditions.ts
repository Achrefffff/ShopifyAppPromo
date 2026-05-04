/**
 * Condition type definitions for the promotion rule builder.
 * Each condition represents a "IF" brick that the marketing team can use.
 */

export interface ConditionDefinition {
  id: string;
  label: string;
  description: string;
  operators: { value: string; label: string }[];
  valueType: "number" | "text" | "boolean" | "product" | "collection" | "date_range";
  placeholder?: string;
  suffix?: string;
}

export const CONDITION_TYPES: ConditionDefinition[] = [
  {
    id: "cart_total",
    label: "Montant du panier",
    description: "Le montant total du panier",
    operators: [
      { value: "gte", label: "est supérieur ou égal à" },
      { value: "lte", label: "est inférieur ou égal à" },
      { value: "eq", label: "est égal à" },
    ],
    valueType: "number",
    placeholder: "100",
    suffix: "€",
  },
  {
    id: "item_count",
    label: "Nombre d'articles",
    description: "Le nombre total d'articles dans le panier",
    operators: [
      { value: "gte", label: "est supérieur ou égal à" },
      { value: "lte", label: "est inférieur ou égal à" },
      { value: "eq", label: "est égal à" },
    ],
    valueType: "number",
    placeholder: "3",
  },
  {
    id: "contains_product",
    label: "Contient le produit",
    description: "Le panier contient un produit spécifique",
    operators: [
      { value: "contains", label: "contient" },
      { value: "not_contains", label: "ne contient pas" },
    ],
    valueType: "product",
  },
  {
    id: "contains_collection",
    label: "Article de la collection",
    description: "Le panier contient un article d'une collection",
    operators: [
      { value: "contains", label: "contient un article de" },
      { value: "not_contains", label: "ne contient pas d'article de" },
    ],
    valueType: "collection",
  },
  {
    id: "product_tag",
    label: "Produit avec le tag",
    description: "Le panier contient un produit ayant ce tag",
    operators: [
      { value: "contains", label: "contient" },
      { value: "not_contains", label: "ne contient pas" },
    ],
    valueType: "text",
    placeholder: "summer-2026",
  },
  {
    id: "customer_first_order",
    label: "Première commande",
    description: "Le client n'a jamais commandé auparavant",
    operators: [
      { value: "eq", label: "est" },
    ],
    valueType: "boolean",
  },
  {
    id: "customer_tag",
    label: "Tag client",
    description: "Le client possède un tag spécifique",
    operators: [
      { value: "eq", label: "est" },
      { value: "contains", label: "contient" },
    ],
    valueType: "text",
    placeholder: "VIP",
  },
];

/**
 * Get a condition definition by its ID.
 */
export function getConditionById(id: string): ConditionDefinition | undefined {
  return CONDITION_TYPES.find((c) => c.id === id);
}

/**
 * Represents a configured condition instance (what gets stored in the DB).
 */
export interface ConditionInstance {
  id: string;       // unique instance ID (for React keys)
  type: string;     // condition type ID (e.g., "cart_total")
  operator: string; // operator value (e.g., "gte")
  value: string;    // the value (stored as string, parsed based on valueType)
  valueLabel?: string; // display name for products/collections
  valueImage?: string; // image thumbnail url
}
