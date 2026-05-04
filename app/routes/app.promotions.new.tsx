import { useState, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData, useNavigate, useSubmit, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createPromotion } from "../models/promotion.server";
import { upsertDiscount } from "../services/discount-sync.server";
import { CONDITION_TYPES, type ConditionInstance } from "../config/conditions";
import { ACTION_TYPES, type ActionInstance } from "../config/actions";
import { validatePromotion, isValid } from "../utils/validators";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {
    conditionTypes: CONDITION_TYPES,
    actionTypes: ACTION_TYPES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const raw = formData.get("data") as string;

  try {
    const data = JSON.parse(raw);

    const errors = validatePromotion(data);
    if (!isValid(errors)) {
      return { success: false, errors };
    }

    let status = data.status || "draft";
    if (status === "active" && data.startDate) {
      const start = new Date(data.startDate);
      if (start > new Date()) {
        status = "scheduled";
      }
    }

    const newPromo = await createPromotion({
      shop: session.shop,
      name: data.name,
      description: data.description,
      status,
      priority: parseInt(data.priority || "0"),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      conditionLogic: data.conditionLogic,
      conditions: data.conditions,
      action: data.action,
      combinable: data.combinable,
    });

    // Sync to Shopify
    try {
      await upsertDiscount(newPromo.id, newPromo as any, admin.graphql, session.shop);
    } catch (syncError: any) {
      console.error("Shopify sync failed:", syncError);
      return { success: false, errors: { form: `Enregistré localement, mais échec de la synchro Shopify : ${syncError.message}` } };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, errors: { form: e.message } };
  }
};

let conditionCounter = 0;
function generateConditionId() {
  return `cond_${Date.now()}_${conditionCounter++}`;
}

export default function NewPromotion() {
  const { conditionTypes, actionTypes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditionLogic, setConditionLogic] = useState("all");
  const [conditions, setConditions] = useState<ConditionInstance[]>([
    { id: generateConditionId(), type: "cart_total", operator: "gte", value: "" },
  ]);
  const [promoAction, setPromoAction] = useState<ActionInstance>({
    type: "percentage_off",
    value: "",
    target: "order",
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState("0");
  const [combinable, setCombinable] = useState(false);

  // Redirect on success
  if (actionData?.success) {
    shopify.toast.show("Promotion créée !");
    navigate("/app");
  }

  const errors: Record<string, string> = (actionData as any)?.errors || {};

  // --- Condition handlers ---
  const addCondition = () => {
    setConditions([
      ...conditions,
      { id: generateConditionId(), type: "cart_total", operator: "gte", value: "" },
    ]);
  };

  const removeCondition = (id: string) => {
    if (conditions.length <= 1) return;
    setConditions(conditions.filter((c) => c.id !== id));
  };

  const updateCondition = (id: string, field: keyof ConditionInstance | Partial<ConditionInstance>, value?: string) => {
    setConditions((prevConditions) =>
      prevConditions.map((c) => {
        if (c.id !== id) return c;
        let updated = { ...c };
        if (typeof field === "string") {
          updated = { ...updated, [field]: value };
        } else {
          updated = { ...updated, ...field };
        }
        
        if (typeof field === "string" && field === "type") {
          const condType = conditionTypes.find((ct: any) => ct.id === value);
          updated.operator = condType?.operators[0]?.value || "";
          updated.value = "";
          updated.valueLabel = "";
        }
        return updated;
      })
    );
  };

  // --- Action handlers ---
  const updateAction = (field: string, value: any) => {
    setPromoAction((prev: ActionInstance) => {
      const updated = { ...prev, [field]: value };
      if (field === "type") {
        const actType = actionTypes.find((at: any) => at.id === value);
        updated.value = "";
        updated.target = actType?.targets?.[0]?.value || undefined;
        updated.targetId = undefined;
        updated.targetTitle = undefined;
        updated.targetImage = undefined;
        updated.productId = undefined;
        updated.productTitle = undefined;
        updated.productImage = undefined;
      }
      return updated;
    });
  };

  // --- Resource pickers ---
  const pickProduct = useCallback(async (callback: (id: string, title: string, image?: string) => void) => {
    try {
      const selected = await (shopify as any).resourcePicker({ type: "product", multiple: false });
      if (selected && selected.length > 0) {
        callback(selected[0].id, selected[0].title, selected[0].images?.[0]?.originalSrc);
      }
    } catch (e) {
      // User cancelled
    }
  }, [shopify]);

  const pickCollection = useCallback(async (callback: (id: string, title: string, image?: string) => void) => {
    try {
      const selected = await (shopify as any).resourcePicker({ type: "collection", multiple: false });
      if (selected && selected.length > 0) {
        callback(selected[0].id, selected[0].title, selected[0].image?.originalSrc);
      }
    } catch (e) {
      // User cancelled
    }
  }, [shopify]);

  // --- Submit ---
  const handleSubmit = (status: string) => {
    const data = {
      name,
      description,
      status,
      conditionLogic,
      conditions,
      action: promoAction,
      startDate: startDate || null,
      endDate: endDate || null,
      priority,
      combinable,
    };

    submit({ data: JSON.stringify(data) }, { method: "POST" });
  };

  const currentActionType = actionTypes.find((at: any) => at.id === promoAction.type);

  return (
    <s-page heading="Nouvelle promotion">
      <Link slot="breadcrumb-actions" to="/app">Promotions</Link>
      <s-button slot="primary-action" variant="primary" onClick={() => handleSubmit("active")}>
        Créer et activer
      </s-button>
      <s-button slot="secondary-actions" onClick={() => handleSubmit("draft")}>
        Enregistrer comme brouillon
      </s-button>

      {/* Global error */}
      {errors.form && (
        <s-section>
          <s-banner tone="critical">{errors.form}</s-banner>
        </s-section>
      )}

      {/* === INFORMATIONS === */}
      <s-section heading="Informations">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Nom de la promotion"
            value={name}
            onInput={(e: any) => setName(e.target.value)}
            error={errors.name}
            placeholder="Ex: Soldes Été -20%"
          />
          <s-text-field
            label="Description (interne)"
            value={description}
            onInput={(e: any) => setDescription(e.target.value)}
            placeholder="Note pour l'équipe, non visible par les clients"
          />
        </s-stack>
      </s-section>

      {/* === CONDITIONS === */}
      <s-section heading="🔹 Conditions (SI)">
        <s-stack direction="block" gap="base">
          {/* Logic selector */}
          <s-select
            label="Les conditions doivent"
            value={conditionLogic}
            onChange={(e: any) => setConditionLogic(e.target.value)}
          >
            <s-option value="all">TOUTES être remplies (ET)</s-option>
            <s-option value="any">AU MOINS UNE être remplie (OU)</s-option>
          </s-select>

          {errors.conditions && (
            <s-banner tone="critical">{errors.conditions}</s-banner>
          )}

          {/* Condition rows */}
          {conditions.map((condition, index) => {
            const condType = conditionTypes.find((ct: any) => ct.id === condition.type);
            const condError = errors[`condition_${index}`];

            return (
              <s-box key={condition.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="base">
                    {/* Type selector */}
                    <s-select
                      label="Type"
                      value={condition.type}
                      onChange={(e: any) => updateCondition(condition.id, "type", e.target.value)}
                    >
                      {conditionTypes.map((ct: any) => (
                        <s-option key={ct.id} value={ct.id}>{ct.label}</s-option>
                      ))}
                    </s-select>

                    {/* Operator selector */}
                    {condType && condType.operators.length > 0 && (
                      <s-select
                        label="Opérateur"
                        value={condition.operator}
                        onChange={(e: any) => updateCondition(condition.id, "operator", e.target.value)}
                      >
                        {condType.operators.map((op: any) => (
                          <s-option key={op.value} value={op.value}>{op.label}</s-option>
                        ))}
                      </s-select>
                    )}

                    {/* Value input — depends on type */}
                    {condType && condType.valueType === "number" && (
                      <s-number-field
                        label="Valeur"
                        value={condition.value as any}
                        onInput={(e: any) => updateCondition(condition.id, "value", e.target.value)}
                        suffix={condType.suffix}
                      />
                    )}

                    {condType && condType.valueType === "text" && (
                      <s-text-field
                        label="Valeur"
                        value={condition.value}
                        onInput={(e: any) => updateCondition(condition.id, "value", e.target.value)}
                        placeholder={condType.placeholder}
                      />
                    )}

                    {condType && condType.valueType === "boolean" && (
                      <s-select
                        label="Valeur"
                        value={condition.value || "true"}
                        onChange={(e: any) => updateCondition(condition.id, "value", e.target.value)}
                      >
                        <s-option value="true">Oui</s-option>
                        <s-option value="false">Non</s-option>
                      </s-select>
                    )}

                    {condType && condType.valueType === "product" && (
                      <s-button
                        variant="tertiary"
                        onClick={() => pickProduct((id, title, image) => {
                          updateCondition(condition.id, { value: id, valueLabel: title, valueImage: image });
                        })}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {condition.valueImage && (
                            <img src={condition.valueImage} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} />
                          )}
                          <span>{condition.valueLabel || (condition.value ? "Produit sélectionné" : "Sélectionner un produit")}</span>
                      </div>
                      </s-button>
                    )}

                    {condType && condType.valueType === "collection" && (
                      <s-button
                        variant="tertiary"
                        onClick={() => pickCollection((id, title, image) => {
                          updateCondition(condition.id, { value: id, valueLabel: title, valueImage: image });
                        })}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {condition.valueImage && (
                            <img src={condition.valueImage} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} />
                          )}
                          <span>{condition.valueLabel || (condition.value ? "Collection sélectionnée" : "Sélectionner une collection")}</span>
                      </div>
                      </s-button>
                    )}

                    {/* Remove button */}
                    {conditions.length > 1 && (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => removeCondition(condition.id)}
                      >
                        ✕
                      </s-button>
                    )}
                  </s-stack>

                  {condError && (
                    <s-banner tone="critical">{condError}</s-banner>
                  )}
                </s-stack>
              </s-box>
            );
          })}

          <s-button variant="secondary" onClick={addCondition}>
            + Ajouter une condition
          </s-button>
        </s-stack>
      </s-section>

      {/* === ACTION === */}
      <s-section heading="🔸 Action (ALORS)">
        <s-stack direction="block" gap="base">
          {errors.action && (
            <s-banner tone="critical">{errors.action}</s-banner>
          )}

          {/* Action type cards */}
          <s-stack direction="inline" gap="small">
            {actionTypes.map((at: any) => (
              <s-button
                key={at.id}
                variant={promoAction.type === at.id ? "primary" : "secondary"}
                onClick={() => updateAction("type", at.id)}
              >
                {at.icon} {at.label}
              </s-button>
            ))}
          </s-stack>

          {currentActionType && (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-paragraph color="subdued">{currentActionType.description}</s-paragraph>

                <s-stack direction="inline" gap="base">
                  {/* Value input */}
                  {currentActionType.hasValue && (
                    <s-number-field
                      label="Valeur"
                      value={(promoAction.value || "") as any}
                      onInput={(e: any) => updateAction("value", e.target.value)}
                      suffix={currentActionType.valueSuffix}
                    />
                  )}

                  {/* Target selector */}
                  {currentActionType.hasTarget && currentActionType.targets && (
                    <s-select
                      label="Appliquer sur"
                      value={promoAction.target || currentActionType.targets[0].value}
                      onChange={(e: any) => updateAction("target", e.target.value)}
                    >
                      {currentActionType.targets.map((t: any) => (
                        <s-option key={t.value} value={t.value}>{t.label}</s-option>
                      ))}
                    </s-select>
                  )}
                </s-stack>

                {/* Product/collection picker for targeted actions */}
                {promoAction.target === "product" && (
                  <s-button
                    variant="tertiary"
                    onClick={() => pickProduct((id, title, image) => {
                      updateAction("targetId", id);
                      updateAction("targetTitle", title);
                      updateAction("targetImage", image);
                    })}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {promoAction.targetImage && (
                        <img src={promoAction.targetImage} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} />
                      )}
                      <span>{promoAction.targetTitle || "Sélectionner un produit"}</span>
                    </div>
                  </s-button>
                )}

                {promoAction.target === "collection" && (
                  <s-button
                    variant="tertiary"
                    onClick={() => pickCollection((id, title, image) => {
                      updateAction("targetId", id);
                      updateAction("targetTitle", title);
                      updateAction("targetImage", image);
                    })}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {promoAction.targetImage && (
                        <img src={promoAction.targetImage} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} />
                      )}
                      <span>{promoAction.targetTitle || "Sélectionner une collection"}</span>
                    </div>
                  </s-button>
                )}

                {/* GWP product picker */}
                {currentActionType.hasProductPicker && (
                  <s-stack direction="block" gap="small">
                    <s-button
                      variant="tertiary"
                      onClick={() => pickProduct((id, title, image) => {
                        updateAction("productId", id);
                        updateAction("productTitle", title);
                        updateAction("productImage", image);
                      })}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {promoAction.productImage && (
                          <img src={promoAction.productImage} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} />
                        )}
                        <span>{promoAction.productTitle ? `🎁 ${promoAction.productTitle}` : "Sélectionner le produit à offrir"}</span>
                      </div>
                    </s-button>
                    {errors.actionProduct && (
                      <s-paragraph tone="critical">{errors.actionProduct}</s-paragraph>
                    )}
                    <s-number-field
                      label="Quantité"
                      value={String(promoAction.quantity || 1) as any}
                      onInput={(e: any) => updateAction("quantity", parseInt(e.target.value) || 1)}
                      min={1 as any}
                    />
                  </s-stack>
                )}
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      {/* === SCHEDULING === */}
      <s-section heading="📅 Planification">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-date-field
              label="Date de début"
              value={startDate}
              onChange={(e: any) => setStartDate(e.currentTarget.value)}
            />
            <s-date-field
              label="Date de fin"
              value={endDate}
              onChange={(e: any) => setEndDate(e.currentTarget.value)}
            />
          </s-stack>
          {errors.endDate && (
            <s-paragraph tone="critical">{errors.endDate}</s-paragraph>
          )}
          <s-paragraph color="subdued">
            Laissez vide pour une activation immédiate / sans date de fin.
          </s-paragraph>
        </s-stack>
      </s-section>

      {/* === OPTIONS === */}
      <s-section heading="⚙️ Options">
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Priorité"
            value={priority as any}
            onInput={(e: any) => setPriority(e.target.value)}
          />
          <s-paragraph color="subdued">Plus le nombre est élevé, plus la priorité est haute</s-paragraph>
          <s-checkbox
            label="Cumulable avec d'autres promotions"
            checked={combinable}
            onChange={(e: any) => setCombinable(e.target.checked)}
          />
        </s-stack>
      </s-section>

      {/* === PROGRESS BAR === */}

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
