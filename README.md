# BuildFlow Bill Management

A full-stack construction bill, verification, approval and payment workspace built with Next.js, TypeScript and PostgreSQL. The server enforces role permissions, duplicate checks, append-only audit history and a row-locked, atomic payment transaction. Uploaded documents are private and require a signed-in session to retrieve.

## Requirements

- Node.js 20 or later
- pnpm 9 or later
- Docker (for the included local PostgreSQL service), or a PostgreSQL 14+ database

## Run locally

1. Copy `.env.example` to `.env` and set `AUTH_SECRET` and `DATA_ENCRYPTION_KEY` to separate random values of at least 32 characters. Keep the encryption key stable or re-encrypt vendor bank details before rotating it.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install and prepare the database:

   ```sh
   pnpm install
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```

4. Start the application with `pnpm dev` and open `http://localhost:3000`.

## Deploy on Netlify Free

1. In the Netlify project, create a PostgreSQL database from **Data & Storage → Database**. Netlify provides `NETLIFY_DB_URL`; the build script runs Prisma migrations and seeds demo data only when the database is empty.
2. Add `AUTH_SECRET` and `DATA_ENCRYPTION_KEY` as private Netlify environment variables. Use different random values of at least 32 characters, then redeploy. Never commit these values.
3. On Netlify, bill and payment documents use the private `buildflow-private-files` Netlify Blobs store. Access continues through the app's authenticated document routes. SMTP is optional; without it, email attempts are logged as skipped and in-app notifications still work.

The Free plan has a hard monthly usage cap and no automatic overage charge; if the cap is reached, the site or database may pause until the next cycle. Free-tier hosting is suitable for a demo and light trial use. Change the seeded demo passwords and users before adding company data. Do not use the public demo credentials for real financial records.

For other hosting platforms, provide `DATABASE_URL`, `AUTH_SECRET`, and `DATA_ENCRYPTION_KEY`. Configure S3-compatible credentials for durable private file storage; without S3/Netlify Blobs, local storage is only suitable for development.

## Demo accounts

All seeded demo accounts use `Demo123!`:

| Role | Email |
| --- | --- |
| Team 1 · Bill entry | `team11@buildflow.local`, `team12@buildflow.local`, `team13@buildflow.local` |
| Team 2 · Verification and payment | `team21@buildflow.local`, `team22@buildflow.local`, `team23@buildflow.local` |
| Admin · Final approval | `admin@buildflow.local` |

Change or delete demo accounts before using this application with company data. Demo bills use numbers `BL-2026-0011` to `BL-2026-0030`; `BILL-1001` is reserved for the acceptance workflow.

## Workflow and controls

- Team 1 creates and submits a bill with a required PDF/image. Exact vendor + bill number + project matches and bill number collisions are blocked; paid bills display payment details.
- Team 2 verifies or returns a bill. Only an Admin can approve or reject; rejection requires a reason.
- Admin approval moves the bill through `ADMIN_APPROVED` to `PAYMENT_PENDING`. Team 2 alone can record payment.
- Payment locks the bill row inside a serializable database transaction and uses a unique payment per bill. A second attempt is blocked by the persisted paid status, payment row and unique constraint. The payment amount must equal the approved total.
- Every status transition and important action adds status history and audit records. No API route exposes audit edit or delete operations.
- Emails use professional HTML templates when SMTP is configured. Each attempted recipient is logged in `EmailLog`.
- Vendor bank details are encrypted with AES-256-GCM before they are stored. Team 1 never receives those fields; only Admin and Team 2 can read them.
- Bill entry can read PDF text locally or OCR invoice images/scanned PDF pages in the browser and suggest the bill number, date, taxable amount, GST amount, and a matching saved vendor GSTIN. The file is uploaded only when the bill is saved; review every suggested value before submission.
- GSTIN entry checks its structure and checksum locally and blocks malformed GSTINs when adding a vendor. This does not query GSTN or prove that a registration is active. Use the linked GST Portal search for live checks; a production API integration requires an authorized provider and credentials.
- The seeded `DUPLICATE_ATTEMPT` event demonstrates a blocked duplicate submission without creating a duplicate bill record.

## Acceptance walkthrough

Use a fresh database seeded with demo data. Sign in as `team11@buildflow.local`, create `BILL-1001` with a selected project/vendor and a PDF or image, then submit. Sign in as `team21@buildflow.local` to verify and forward it. Sign in as `admin@buildflow.local` to approve it, then return to Team 2 to record payment using the full bill total and a UTR. Return to Team 1 and enter `BILL-1001` again; the bill number check displays `ALREADY PAID` and blocks submission. Trying payment a second time returns `PAYMENT ALREADY COMPLETED`.

With the app running and the database freshly seeded, run `pnpm acceptance` to execute this API-level workflow and assert notifications and both duplicate safeguards.

## Exports

Authorized Team 2 and Admin users can export the bill/payment register as CSV, Excel (`.xlsx`) or PDF. Reports can be scoped to a project.
