ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_categoryId_userId_fkey";

ALTER TABLE "Transaction" ALTER COLUMN "categoryId" DROP NOT NULL;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_categoryId_userId_fkey"
FOREIGN KEY ("categoryId", "userId")
REFERENCES "Category"("id", "userId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
