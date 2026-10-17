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

For production, set the environment variables in the deployment platform, run `pnpm db:deploy`, and start with `pnpm start`. Configure SMTP to send transactional emails and S3-compatible credentials to use private object storage. Without SMTP, the workflow still records email delivery as skipped in `EmailLog`; in-app notifications work normally. Without S3 settings, files are saved to `private-uploads/`, which must be on persistent private storage and excluded from public web serving.

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
- The seeded `DUPLICATE_ATTEMPT` event demonstrates a blocked duplicate submission without creating a duplicate bill record.

## Acceptance walkthrough

Use a fresh database seeded with demo data. Sign in as `team11@buildflow.local`, create `BILL-1001` with a selected project/vendor and a PDF or image, then submit. Sign in as `team21@buildflow.local` to verify and forward it. Sign in as `admin@buildflow.local` to approve it, then return to Team 2 to record payment using the full bill total and a UTR. Return to Team 1 and enter `BILL-1001` again; the bill number check displays `ALREADY PAID` and blocks submission. Trying payment a second time returns `PAYMENT ALREADY COMPLETED`.

With the app running and the database freshly seeded, run `pnpm acceptance` to execute this API-level workflow and assert notifications and both duplicate safeguards.

## Exports

Authorized Team 2 and Admin users can export the bill/payment register as CSV, Excel (`.xlsx`) or PDF. Reports can be scoped to a project.
