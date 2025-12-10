-- Clean out legacy auth records as they cannot be migrated safely
DELETE FROM "RefreshToken";
DELETE FROM "Session";
DELETE FROM "UserSettings";
DELETE FROM "CustomAssignment";
DELETE FROM "AssignmentCheck";
DELETE FROM "AuditEvent";
DELETE FROM "User";

ALTER TABLE "User"
ADD COLUMN     "email" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- Ensure new columns are required
ALTER TABLE "User"
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "passwordHash" SET NOT NULL;

-- Drop legacy username hash unique constraint
DROP INDEX IF EXISTS "User_usernameHash_key";

-- Remove legacy column
ALTER TABLE "User"
DROP COLUMN "usernameHash";

-- Enforce uniqueness on email
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

