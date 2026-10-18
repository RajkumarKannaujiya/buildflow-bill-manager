ALTER TABLE "Vendor"
ADD COLUMN "gstRegistered" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Vendor"
SET "gstRegistered" = ("gstin" IS NOT NULL AND btrim("gstin") <> '');

ALTER TABLE "Bill"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT,
ADD COLUMN "deleteReason" TEXT;

CREATE TABLE "BillLineItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Bill_deletedAt_createdAt_idx" ON "Bill"("deletedAt", "createdAt");
CREATE INDEX "BillLineItem_billId_sortOrder_idx" ON "BillLineItem"("billId", "sortOrder");

ALTER TABLE "Bill"
ADD CONSTRAINT "Bill_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillLineItem"
ADD CONSTRAINT "BillLineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
