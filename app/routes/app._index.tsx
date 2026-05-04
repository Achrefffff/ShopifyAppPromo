import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData, useNavigate, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getPromotions,
  getPromotion,
  deletePromotion,
  togglePromotionStatus,
  duplicatePromotion,
  parsePromotion,
} from "../models/promotion.server";
import { upsertDiscount, deleteDiscount, syncActivePromotionsMetafield } from "../services/discount-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const promotions = await getPromotions(session.shop);

  return {
    promotions: promotions.map(parsePromotion),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const id = formData.get("id") as string;

  switch (intent) {
    case "delete":
      const promoToDelete = await getPromotion(id, session.shop);
      if (promoToDelete?.shopifyDiscountId) {
        try { await deleteDiscount(promoToDelete.shopifyDiscountId, admin.graphql); } catch (e) {}
      }
      await deletePromotion(id, session.shop);
      await syncActivePromotionsMetafield(admin.graphql, session.shop);
      return { success: true, message: "Promotion supprimée" };

    case "toggle":
      const newStatus = await togglePromotionStatus(id, session.shop);
      const updatedPromo = await getPromotion(id, session.shop);
      if (updatedPromo) {
        try { 
          await upsertDiscount(id, updatedPromo as any, admin.graphql, session.shop); 
          // syncActivePromotionsMetafield is called inside upsertDiscount
        } catch (e) {}
      }
      return { success: true, message: `Promotion ${newStatus === "active" ? "activée" : "mise en pause"}` };

    case "duplicate":
      await duplicatePromotion(id, session.shop);
      await syncActivePromotionsMetafield(admin.graphql, session.shop);
      return { success: true, message: "Promotion dupliquée" };

    default:
      return { success: false, message: "Action inconnue" };
  }
};

const STATUS_CONFIG: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "success" },
  draft: { label: "Brouillon", tone: "info" },
  scheduled: { label: "Planifiée", tone: "caution" },
  paused: { label: "En pause", tone: "warning" },
  expired: { label: "Expirée", tone: "critical" },
};

const ACTION_LABELS: Record<string, string> = {
  percentage_off: "Réduction %",
  fixed_amount_off: "Montant fixe",
  fixed_price: "Prix fixe",
  free_product: "Produit offert",
  free_shipping: "Livraison offerte",
};

export default function PromotionsDashboard() {
  const { promotions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? promotions
    : promotions.filter((p: any) => p.status === filter);

  const handleAction = (intent: string, id: string) => {
    if (intent === "delete" && !confirm("Supprimer cette promotion ?")) return;
    submit({ intent, id }, { method: "POST" });
  };

  const formatDate = (date: string | null, isEnd: boolean = false) => {
    if (!date) return isEnd ? "Sans fin" : "Immédiatement";
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getActionSummary = (action: any) => {
    const label = ACTION_LABELS[action.type] || action.type;
    if (action.value) {
      const suffix = action.type === "percentage_off" ? "%" : "€";
      return `${label}: -${action.value}${suffix}`;
    }
    return label;
  };

  return (
    <>
      <s-page heading="Promotions">
        <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/promotions/new")}>
          Créer une promotion
        </s-button>

        {promotions.length === 0 ? (
          <s-section>
            <s-stack direction="block" gap="large">
              <s-heading>Aucune promotion</s-heading>
              <s-paragraph>
                Créez des promotions personnalisées que votre équipe marketing peut gérer en toute autonomie.
              </s-paragraph>
              <s-button variant="primary" onClick={() => navigate("/app/promotions/new")}>
                Créer votre première promotion
              </s-button>
            </s-stack>
          </s-section>
        ) : (
          <>
            {/* Filter tabs */}
            <s-section>
              <s-stack direction="inline" gap="small">
                {[
                  { value: "all", label: `Toutes (${promotions.length})` },
                  { value: "active", label: "Actives" },
                  { value: "draft", label: "Brouillons" },
                  { value: "scheduled", label: "Planifiées" },
                  { value: "paused", label: "En pause" },
                ].map((tab) => (
                  <s-button
                    key={tab.value}
                    variant={filter === tab.value ? "primary" : "tertiary"}
                    onClick={() => setFilter(tab.value)}
                  >
                    {tab.label}
                  </s-button>
                ))}
              </s-stack>
            </s-section>

            {/* Promotion list */}
            <s-section>
              <s-stack direction="block" gap="base">
                {filtered.map((promo: any) => {
                  const statusConfig = STATUS_CONFIG[promo.status] || STATUS_CONFIG.draft;
                  return (
                    <s-box key={promo.id} padding="base" borderWidth="base" borderRadius="base">
                      <s-stack direction="block" gap="small">
                        {/* Header row */}
                        <s-stack direction="inline" gap="base">
                          <s-stack direction="inline" gap="small">
                            <s-heading>
                              <Link to={`/app/promotions/${promo.id}`}>
                                {promo.name}
                              </Link>
                            </s-heading>
                            <s-badge tone={statusConfig.tone as any}>{statusConfig.label}</s-badge>
                            {promo.combinable && <s-badge tone="info">Cumulable</s-badge>}
                          </s-stack>
                        </s-stack>

                        {/* Actions */}
                        <s-stack direction="inline" gap="small">
                          <s-button
                            variant="tertiary"
                            onClick={() => handleAction("toggle", promo.id)}
                          >
                            {promo.status === "active" ? "Pause" : "Activer"}
                          </s-button>
                          <s-button
                            variant="tertiary"
                            onClick={() => handleAction("duplicate", promo.id)}
                          >
                            Dupliquer
                          </s-button>
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => handleAction("delete", promo.id)}
                          >
                            Supprimer
                          </s-button>
                        </s-stack>

                        {/* Details */}
                        <s-stack direction="inline" gap="large">
                          <s-paragraph color="subdued">
                            Action: {getActionSummary(promo.action)}
                          </s-paragraph>
                          <s-paragraph color="subdued">
                            Conditions: {promo.conditions.length} règle{promo.conditions.length > 1 ? "s" : ""} ({promo.conditionLogic === "all" ? "ET" : "OU"})
                          </s-paragraph>
                          <s-paragraph color="subdued">
                            Période: {formatDate(promo.startDate)} → {formatDate(promo.endDate, true)}
                          </s-paragraph>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  );
                })}
              </s-stack>
            </s-section>

            {filtered.length === 0 && (
              <s-section>
                <s-paragraph color="subdued">
                  Aucune promotion avec le filtre &quot;{filter}&quot;.
                </s-paragraph>
              </s-section>
            )}
          </>
        )}
      </s-page>
      <div style={{ 
        textAlign: 'center', 
        padding: '30px 20px', 
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: '14px',
        letterSpacing: '-0.01em'
      }}>
        <span style={{ color: '#202223', fontWeight: '500' }}>App developped by </span>
        <span style={{ color: '#0080ff', fontWeight: '700' }}>Achraf</span>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
