INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES ('companyName', '"J.P. PROJECTS"'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES ('companyLogoUrl', '"/jp-projects-logo.jpeg"'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;
