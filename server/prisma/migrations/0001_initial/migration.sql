CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "usernameHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Session_userId_deviceId_key" ON "Session" ("userId", "deviceId");
CREATE INDEX "Session_userId_idx" ON "Session" ("userId");

CREATE TABLE "RefreshToken" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT,
  "userId" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "revoked" BOOLEAN DEFAULT FALSE NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" ("userId");
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken" ("sessionId");

CREATE TABLE "UserSettings" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "notificationsEnabled" BOOLEAN DEFAULT TRUE NOT NULL,
  "syncEnabled" BOOLEAN DEFAULT TRUE NOT NULL,
  "preferences" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CustomAssignment" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "courseName" TEXT,
  "dueDate" TIMESTAMP WITH TIME ZONE,
  "status" TEXT DEFAULT 'pending' NOT NULL,
  "externalId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "CustomAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CustomAssignment_userId_idx" ON "CustomAssignment" ("userId");
CREATE INDEX "CustomAssignment_userId_externalId_idx" ON "CustomAssignment" ("userId", "externalId");
CREATE UNIQUE INDEX "CustomAssignment_userId_title_dueDate_key" ON "CustomAssignment" ("userId", "title", "dueDate");

CREATE TABLE "AssignmentCheck" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "assignmentDate" TIMESTAMP WITH TIME ZONE NOT NULL,
  "status" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "AssignmentCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssignmentCheck_userId_assignmentDate_idx" ON "AssignmentCheck" ("userId", "assignmentDate");
CREATE UNIQUE INDEX "AssignmentCheck_userId_assignmentId_key" ON "AssignmentCheck" ("userId", "assignmentId");

CREATE TABLE "AuditEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent" ("userId", "createdAt");

