/**
 * Action type definitions for the promotion rule builder.
 * Each action represents a "THEN" brick — the discount to apply.
 */

export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  icon: string;
  hasValue: boolean;
  valueSuffix?: string;
  valuePlaceholder?: string;
  hasTarget: boolean;
  targets?: { value: string; label: string }[];
  hasProductPicker?: boolean;
}

export const ACTION_TYPES: ActionDefinition[] = [
  {
    id: "percentage_off",
    label: "Réduction en %",
    description: "Applique un pourcentage de réduction",
    icon: "📊",
    hasValue: true,
    valueSuffix: "%",
    valuePlaceholder: "20",
    hasTarget: true,
    targets: [
      { value: "order", label: "Commande entière" },
      { value: "product", label: "Produit spécifique" },
      { value: "collection", label: "Collection spécifique" },
    ],
  },
  {
    id: "fixed_amount_off",
    label: "Réduction montant fixe",
    description: "Retire un montant fixe du prix",
    icon: "💰",
    hasValue: true,
    valueSuffix: "€",
    valuePlaceholder: "10",
    hasTarget: true,
    targets: [
      { value: "order", label: "Commande entière" },
      { value: "product", label: "Produit spécifique" },
      { value: "collection", label: "Collection spécifique" },
    ],
  },
  {
    id: "fixed_price",
    label: "Prix fixe",
    description: "Fixe le prix à un montant donné",
    icon: "🏷️",
    hasValue: true,
    valueSuffix: "€",
    valuePlaceholder: "59",
    hasTarget: true,
    targets: [
      { value: "product", label: "Produit spécifique" },
      { value: "collection", label: "Collection spécifique" },
    ],
  },
  {
    id: "free_product",
    label: "Produit offert (GWP)",
    description: "Ajoute un produit gratuit au panier",
    icon: "🎁",
    hasValue: false,
    hasTarget: false,
    hasProductPicker: true,
  },
  {
    id: "free_shipping",
    label: "Livraison offerte",
    description: "Les frais de livraison sont offerts",
    icon: "🚚",
    hasValue: false,
    hasTarget: false,
  },
];

/**
 * Get an action definition by its ID.
 */
export function getActionById(id: string): ActionDefinition | undefined {
  return ACTION_TYPES.find((a) => a.id === id);
}

/**
 * Represents a configured action instance (what gets stored in the DB).
 */
export interface ActionInstance {
  type: string;      // action type ID (e.g., "percentage_off")
  value?: string;    // the value (e.g., "20" for 20%)
  target?: string;   // target scope (e.g., "order", "product", "collection")
  targetId?: string; // Shopify GID if targeting specific product/collection
  targetTitle?: string; // Human-readable name for display
  targetImage?: string; // Thumbnail for display
  productId?: string;   // For GWP: the product to add
  productTitle?: string; // For GWP: product display name
  productImage?: string; // For GWP: product thumbnail
  quantity?: number;     // For GWP: quantity to add
}
