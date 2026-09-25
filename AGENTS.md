# AGENTS.md

Guidance for AI agents and developers working in this repository. Read this before
touching code. It reflects the **actual** state of the codebase — the `README.md` is
older and describes the auth-only starter; this project has moved well beyond it.

## Project overview

PH Healthcare System is a doctor-appointment platform backend (REST API). Patients
find doctors, book a slot on a published schedule, pay via bKash, and join a video
consultation. Doctors manage schedules/appointments and write PDF prescriptions.
Admins/Super Admins approve doctor applications and review platform-wide data.

The product requirements live in `Project Requirements.md`; feature-by-feature specs
live in `.opencode/specs/`. The Postman collection is at the repo root.

## Tech stack

- **Runtime**: Node.js 20+, Express 5, TypeScript (ESM, `"type": "module"`)
- **Database**: PostgreSQL + Prisma 7 (generator `prisma-client`, output to `src/generated/prisma`)
- **Auth**: JWT (access + refresh), bcryptjs, Google OAuth (patients only)
- **Cache / ephemeral store**: Redis (OTPs, pending registrations, bKash tokens)
- **Payments**: bKash tokenized checkout (sandbox), refunds via bKash API
- **Files**: Cloudinary (profile images, doctor resumes/additional files, prescription PDFs)
- **Email**: Nodemailer + Gmail SMTP, EJS templates in `src/app/templates/`
- **PDFs**: pdfkit (invoices, prescriptions)
- **Jobs**: node-cron (auto-delete unverified doctor applications)
- **Validation**: zod (via `validateRequest` middleware)
- **Lint/format**: Biome 2 (`biome.json` — tabs, double quotes, no `organizeImports`)

## Commands

```bash
npm run dev          # tsx watch src/server.ts — primary dev loop
npm run build        # tsc typecheck + emit to dist/ (NOT directly runnable, see Gotchas)
npm run start        # node dist/src/server.js — currently broken for real runs, use dev/tsx
npm test             # placeholder, no tests exist

npm run lint:check   # npx @biomejs/biome lint ./src
npm run lint:fix     # npx @biomejs/biome lint --write ./src
npm run format:check # npx @biomejs/biome format ./src
npm run format:fix   # npx @biomejs/biome format --write ./src

npx prisma generate   # MUST run after cloning (src/generated is git-ignored) and after any schema edit
npx prisma migrate dev
npx prisma studio
```

## Project structure

```
src/
├── server.ts                    # boot: connect DB + Redis, verify SMTP, seed, start cron, listen
├── app.ts                       # express app: cors, json/urlencoded, cookie-parser, route mounts, error handling
├── generated/prisma/            # Prisma client — git-ignored, never edit
└── app/
    ├── config/index.ts          # ONLY place that reads process.env — import config everywhere else
    ├── interfaces/index.ts      # IQuery (pagination/search/filter query params)
    ├── lib/                     # shared infrastructure singletons
    │   ├── prisma.ts            # PrismaClient with PrismaPg adapter — import this, never `new` your own
    │   ├── redis.ts             # redisClient
    │   ├── bKash.ts             # getBkashIdToken() — grants/refreshes id token, cached in Redis
    │   ├── cloudinary.ts        # configured v2 client
    │   ├── googleAuth.ts        # OAuth2Client for verifying Google id tokens
    │   ├── multer.ts            # memory storage upload middleware
    │   ├── nodemailer.ts        # Gmail transporter
    │   └── cron.ts              # deleteUnverifiedDoctors (every 10 min, >1h old unverified DOCTOR users)
    ├── middleware/
    │   ├── checkAuth.ts         # auth(...roles) JWT + role guard; augments req.user
    │   ├── validateRequest.ts   # validateRequest(zodSchema) -> req.body = parsed data
    │   ├── globalErrorHandler.ts# maps AppError + Prisma errors to JSON (statusCode IS correct here)
    │   └── notFound.ts          # 404 catch-all
    ├── utils/
    │   ├── catchAsync.ts        # wraps handlers so async throws reach the error handler
    │   ├── AppError.ts          # class AppError(statusCode, message)
    │   ├── sendResponse.ts      # { success, statusCode, message, data, meta? } envelope
    │   ├── jwt.ts               # createToken / verifyToken
    │   └── seed.ts              # seedSuperAdmin / seedTesterAdmin / seedTesterDoctor (run at boot)
    ├── templates/               # EJS email templates (registration-otp, welcome, forgot/reset, approve/reject)
    └── module/<name>/           # one folder per feature: auth, user, doctor, schedule, appointment, payment, prescription, analytics

prisma/
├── schema/                      # multi-file schema, merged via prisma.config.ts
│   ├── schema.prisma            # generator + datasource only
│   ├── enums.prisma, user.prisma, patient.prisma, doctor.prisma,
│   ├── schedule.prisma, appointment.prisma, payment.prisma
└── migrations/                  # committed SQL migrations
```

## Module pattern (use this when adding features)

Each feature lives in `src/app/module/<name>/` with strict file responsibilities:

| File                       | Responsibility |
| -------------------------- | -------------- |
| `<name>.route.ts`          | Wires `auth(...roles)` + `validateRequest(...)` to controllers; exports `<Name>Routes` |
| `<name>.controller.ts`     | Reads `req.body`/`req.params`/`req.query`/`req.user`, calls the service, calls `sendResponse` |
| `<name>.service.ts`        | ALL business logic + every Prisma call for the module |
| `<name>.interface.ts`      | TS payload types for the module |
| `<name>.validation.ts`     | zod schemas (used via `validateRequest`) |

Then mount it in `src/app.ts` next to the existing `app.use("/api/v1/...", ...Routes)` lines.

Hard rules:
- **Controllers never call Prisma.** **Services never touch `req`/`res`.**
  If a service needs the caller, pass the small `{ userId, email, name, role }` shape
  (typed as `RequestUser` from `checkAuth.ts`), never the whole request.
- **Never spread `req.body` into a Prisma `create`/`update`.** Destructure the exact
  fields you expect. There is no global auto-sanitizer; the zod schema + explicit
  destructuring are the only guards against role/field injection.
- Controllers are wrapped in `catchAsync`, and the service throws `AppError(statusCode, message)`.
- Responses go through `sendResponse` → `{ success, statusCode, message, data, meta? }`.
  Paginated list queries return `{ data, meta: { page, limit, total, totalPages } }`
  via the `IQuery` shape (`page`, `limit`, `sortBy`, `sortOrder`, `searchTerm`, custom filters).
- Import enums/where-inputs from the generated client (`../../../generated/prisma/enums`,
  `../../../generated/prisma/models`), never hardcode string literals for DB writes.

## Auth and roles

Roles: `SUPER_ADMIN`, `ADMIN`, `DOCTOR`, `PATIENT` (enum `Role`).

- `auth(...requiredRoles)` (`middleware/checkAuth.ts`):
  1. Token from `accessToken` cookie, else `Authorization: Bearer <token>` or raw header value.
  2. Verifies JWT with `config.jwt_access_secret`.
  3. Rejects if the token's `role` is not in `requiredRoles`.
  4. Re-fetches the user matching `id + email + name + role` together — if any changed
     since the token was issued, the request is rejected.
  5. Only a `status === "BLOCKED"` user is rejected. `isDeleted`/`DELETED` are NOT checked here.
  6. Sets `req.user = { userId, email, name, role }`.
- Tokens are returned **in the JSON body** (use those) AND set as cookies. The cookie
  combo `sameSite: "none"` + `secure: false` is invalid, so browsers silently drop them.
  `POST /auth/refresh-token` is the one endpoint that reads the `refreshToken` cookie.
- Registration is **patient-only** and OTP-gated: `register` stores hashed password +
  pending data in Redis (key `patient-registration-data:<email>`, 5 min TTL) and emails
  an OTP (`patient-registration-otp:<email>`); `verify-email` checks the OTP, then creates
  the User + Patient rows and returns tokens.
- Google login (`POST /auth/google`) is patient-only and links a credential account by email.

## Business rules (the important ones)

- **Schedules** (`schedule`): start/end must be the same day, start < end, one schedule
  per doctor per day. Slots are computed as `floor(durationMinutes / 20)`. Created as
  `DRAFT`; patients can only book `PUBLISHED` schedules. A published schedule with bookings
  can't be updated/deleted. Deleting is soft (`isDeleted` + `deletedAt`).
- **Booking** (`appointment.bookAppointment`): schedule must be published, today, not yet
  started, have `availableSlots > 0`, and the doctor must have a `consultationFee`.
  One active appointment per patient per schedule. Creates the appointment as `PENDING`
  and a bKash payment in a single transaction; returns `bkashURL`.
- **bKash callback** (`bookAppointmentCallback`): executes the payment; on success sets
  `CONFIRMED`, computes `serialNumber = (totalSlots - availableSlots) + 1`,
  `joiningTime = startDateTime + (serialNumber - 1) * 20 min`, decrements `availableSlots`,
  marks payment `PAID`, and emails a pdfkit invoice.
- **Cancellation/refund** (`cancelAppointment`): can't cancel ONGOING/COMPLETED/CANCELLED.
  Refund via bKash only if cancelled at least 1 hour before `startDateTime`
  (`subHours(startDateTime, 1)`); otherwise it's a no-refund cancel.
- **Status flow** (doctor): `CONFIRMED → ONGOING → COMPLETED` only.
- **Prescriptions**: only for a `COMPLETED` appointment, one per appointment. Generates a
  PDF (pdfkit), uploads to Cloudinary, emails it, stores `prescriptionUrl` on the appointment.
- **Doctor application**: apply → OTP email verify → admin approve/reject (email sent).
  Unverified applications are deleted by cron after 1 hour.
- **File uploads** (`apply-as-doctor`, `profile-image`): multer memory storage, uploaded to
  Cloudinary; doctor resume + up to 10 additional files via `upload.fields(...)`.

## Environment variables

`.env.example` is **outdated** — it's missing the credentials the app actually requires.
The real key list (all read in `src/app/config/index.ts`, most with `!` non-null assertion):

`NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `BCRYPT_SALT_ROUNDS`, `APP_URL`
(used as `config.bak_url`), `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SUPER_ADMIN_NAME/EMAIL/PASSWORD`, `TESTER_ADMIN_NAME/EMAIL/PASSWORD`,
`TESTER_DOCTOR_NAME/EMAIL/PASSWORD`, `REDIS_USER/PASSWORD/HOST/PORT`,
`SMTP_USER`, `EMAIL_SENDER`, `SMTP_PASSWORD`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`,
`BKASH_BASE_URL/USERNAME/PASSWORD/APP_KEY/APP_SECRET/CALLBACK_URL`.

There is **no startup validation** of these — missing values surface as runtime errors.

## Gotchas (read before debugging)

- **`src/generated/prisma` is git-ignored.** A fresh clone won't compile until
  `npx prisma generate` runs. Run it again after any change under `prisma/schema/`.
- **`npm run build` output is not directly runnable.** The code uses extensionless imports
  (`from "./app"`), which `tsx` resolves but Node's native ESM loader doesn't. `npm run start`
  (`node dist/src/server.js`) fails with `ERR_UNSUPPORTED_DIR_IMPORT`. Use `npm run dev` or
  `npx tsx src/server.ts`. Build is still the fast typecheck.
- **Server startup is all-or-nothing**: it connects to Postgres AND Redis AND verifies SMTP
  AND seeds test accounts AND starts the cron before listening. If any of those fail it
  exits with code 1.
- **Seeds run on every boot** (`seedSuperAdmin`, `seedTesterAdmin`, `seedTesterDoctor`) and
  recreate accounts if their env vars change — they are not a one-time migration.
- **Decimal fields** (`consultationFee`, `Payment.amount`, refunds) are Prisma `Decimal` —
  use `.toString()` / `.toNumber()` rather than relying on implicit coercion.
- **bKash** id tokens are cached in Redis with TTL logic in `lib/bKash.ts`; if the bKash
  sandbox is down, booking/payment endpoints will fail with `BAD_GATEWAY`.
- **Refresh-token and Google flows depend on cookies/Redis/Google client** config being set;
  the Google client is only configured with `clientId`, so verify-id-token requires a valid
  `GOOGLE_CLIENT_ID`.
- Some files contain large commented-out blocks and unused imports (e.g. `Doc` from
  `zod/v4/core` in `doctor.route.ts`, the `join` import in `auth.controller.ts`) — leftovers,
  not required. Don't reintroduce them; removing them in passing is fine but not required.
- Email sending is **not optional** — registration, doctor approval, invoices, and
  prescriptions all send mail and will throw if SMTP is misconfigured.

## Verification before finishing a change

1. `npm run build` — catches type errors fast (this is the project's typecheck).
2. `npm run lint:check` and `npm run format:check` — must pass. Fix with `:fix` variants.
3. If you changed Prisma schema: `npx prisma generate` (then `npx prisma migrate dev`
   for real schema changes) and `npm run build`.
4. No test framework exists; don't claim "tests pass."
