-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "conditionLogic" TEXT NOT NULL DEFAULT 'all',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "action" TEXT NOT NULL DEFAULT '{}',
    "combinable" BOOLEAN NOT NULL DEFAULT false,
    "showProgressBar" BOOLEAN NOT NULL DEFAULT false,
    "progressMessage" TEXT DEFAULT 'Plus que {remaining}€ pour obtenir {reward}',
    "completionMessage" TEXT DEFAULT '🎉 Vous avez débloqué {reward} !',
    "barColor" TEXT DEFAULT '#4CAF50',
    "barIcon" TEXT DEFAULT '🎁',
    "shopifyDiscountId" TEXT,
    "functionType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Promotion_shop_idx" ON "Promotion"("shop");

-- CreateIndex
CREATE INDEX "Promotion_shop_status_idx" ON "Promotion"("shop", "status");
