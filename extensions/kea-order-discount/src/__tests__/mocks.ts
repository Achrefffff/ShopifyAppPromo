import type { RunInput } from "../../generated/api";

export function createMockInput(options: {
  config: any;
  subtotalAmount?: number;
  lines?: { id: string; quantity: number; productId: string }[];
}): RunInput {
  return {
    discountNode: {
      metafield: {
        value: JSON.stringify(options.config),
      },
    },
    cart: {
      cost: {
        subtotalAmount: {
          amount: (options.subtotalAmount || 0).toString(),
        },
      },
      lines: (options.lines || []).map((line) => ({
        id: line.id,
        quantity: line.quantity,
        merchandise: {
          __typename: "ProductVariant",
          id: `gid://shopify/ProductVariant/${line.productId.split("/").pop()}`,
          product: {
            id: line.productId,
          },
        },
      })),
    },
  } as unknown as RunInput;
}
