# WOFBI API

The backend for the Word of Faith Bible Institute portal. It serves the student
dashboard and the admin console in `../Lfc-website/lfc/app/dashboard`.

Express 5 and Mongoose 9 on MongoDB, ESM throughout. Six runtime dependencies and
no build step: `node index.js` is the whole deployment story.

## Running it

```bash
cp .env.example .env      # fill in MONGODB_URI, JWT_SECRET, ADMIN_JWT_SECRET
npm install
npm run seed              # three courses, their lessons, and the first admin
npm run dev               # http://localhost:5000
```

Confirm it is alive at <http://localhost:5000/api/health>.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with nodemon, restarting on save |
| `npm start` | Start plainly — this is the production entry point |
| `npm run seed` | Create or update the courses, lessons and first admin. Safe to re-run |
| `npm run check` | Import every module and print the live route table |
| `npm test` | Unit tests for the multipart parser, middleware and statistics |

`npm run check` is the fastest way to find out whether something is wired up. It
resolves the entire import graph — so a typo in a path or a missing export shows
up as a failed module rather than a 404 at runtime — then walks the mounted
routers and prints every method and path the server actually answers.

The server refuses to start if `MONGODB_URI`, `JWT_SECRET` or `ADMIN_JWT_SECRET`
is missing, or if the two secrets are equal. A shared secret would mean a student
token satisfying an admin check, which is worth failing loudly over rather than
discovering later.

## How it is laid out

```
index.js       bootstrap: env check, DB connect, GridFS, listen, graceful shutdown
app.js         middleware order and the mount table
config/        database connection, GridFS bucket, constants and formatters
models/        Mongoose schemas, each with a toPublicJSON()
services/      logic shared by student and admin controllers
controllers/   one file per resource; admin split into auth/review/records/content
routes/        thin routers — guards and rate limits attached here
middleware/    auth, admin auth, CORS, rate limiting, uploads
utils/         ApiError, asyncHandler, multipart parser, id generators, email
scripts/       seed.js and check.js
```

`config/constants.js` is the file to read first. The fee, the class timetable, the
intake, the course list, the status enumerations and every display formatter live
there, so changing "₦3,000" or the Covenant Practice hours is a one-line edit that
propagates through every endpoint.

Two rules shape the rest:

**Display strings are computed by the API.** The dashboard payload carries
`"₦3,000"`, `"Due Fri, 27 Mar"`, `"In 4 days"`, `"NEXT LESSON · 09"` and
`"1 of 3 lessons complete"` — the exact strings the components already render. The
raw values are always alongside them (`progress.percent` next to
`progress.percentLabel`), so nothing is lost, but the frontend does not have to
reimplement formatting the server already knows how to do.

**Progress is derived, never stored.** A completion percentage is computed from
the student's completion records every time it is read, and completions pointing
at a lesson an admin has since unpublished are ignored. There is no counter to
drift, and nobody can end up over 100%.

## Two kinds of session

Students sign in at `/api/auth/login` and get a token signed with `JWT_SECRET`,
valid seven days. Admins sign in at a separate route, `/api/admin/auth/login`, and
get a token signed with `ADMIN_JWT_SECRET`, valid twelve hours. An admin is not a
student with a flag set: separate collection, separate secret, separate route. The
shorter admin session is deliberate, since that console approves payments and
issues student IDs.

Admin tokens carry `scope: "admin"`, and `requireAdmin` checks it, so a token from
the student secret cannot pass an admin guard even by accident.

Registration is three steps: `register` creates the account and emails a six-digit
code, `verify-email` activates it, `complete-registration` fills in the profile.
Logging in before verifying returns 403 with `code: "EMAIL_NOT_VERIFIED"`.

## Files

Passport photographs and payment receipts go into MongoDB itself through GridFS.
No storage credentials to manage, and nothing is lost when the app redeploys onto
a fresh filesystem — which is exactly what happens on most hosts.

`initGridFS()` runs in `index.js` after the database connection resolves, because
the bucket needs a live connection. Uploads are parsed by `utils/multipart.js`
rather than multer: one dependency fewer, and the API only ever accepts a single
file per request, which is a small enough problem to own.

`GET /api/files/:id` accepts its token in either the `Authorization` header or a
`?token=` query parameter. The query parameter exists because an `<img>` tag
cannot send a header; it is the only route that allows it.

## Idempotency and soft deletes

The operations an administrator might double-click are all safe to repeat.
Approving an application twice issues one student ID, not two. Checking in twice
creates one attendance record — the unique index on `(user, date)` with the date
normalised to UTC midnight makes a second one impossible, and the handler reports
the existing record rather than failing.

Deleting is avoided. Retiring a lesson unpublishes it, because students'
completion records point at it. Revoking a certificate keeps the row, because
public verification has to be able to say "this number exists but is no longer
valid". Reversing an approved application withdraws the place but keeps the
student ID, since those get printed and quoted in letters and recycling one would
put two people on the same number.

Dates are formatted from the local calendar rather than `toISOString()`. Lagos is
UTC+1, so a registration made at half past midnight would otherwise report the
previous day and disagree with its own display label.

## Email

Six notifications are sent: email verification, password reset, application
received, application decision, payment confirmation and certificate issued. In
development, with no SMTP credentials configured, they are printed to the console
instead — the OTP is right there in the terminal, so the signup flow is testable
without a mail server. See `EMAIL_SETUP.md` for real credentials.

Notifications are fire-and-forget: a mail server outage logs a warning and does
not fail the request that triggered it. Verification and password-reset emails are
the exception and still fail loudly, because the user is waiting on the code.

## Testing

`npm test` runs four suites and needs no database:

- `multipart.test.mjs` — the upload parser, including boundary edge cases
- `middleware.test.mjs` — upload validation and the rate limiter
- `stats.test.mjs` — the admin figures and the date helpers
- `smoke.test.mjs` — the real app over a real socket: health, the 404 shape, the
  error-handler branches, every auth guard, CORS preflight and the sign-in throttle

The smoke suite is deliberately database-free. It boots `app.js` on an ephemeral
port and signs its test tokens with the wrong secret on purpose, so the guards
reject them at the signature check and never reach a query. That keeps it fast and
runnable anywhere, and it still catches the class of mistake unit tests miss —
middleware in the wrong order, a router mounted at the wrong prefix, an error
branch that is unreachable, a guard that lets an unauthenticated request through.

### Checking the flows that need a database

These cannot be automated without Mongo, so here they are as a checklist. With the
server running and `npm run seed` done:

```bash
# 1. Health
curl localhost:5000/api/health

# 2. Register. In development the OTP is printed in the server's terminal.
curl -X POST localhost:5000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"firstName":"Ada","lastName":"Obi","email":"ada@example.com","phoneNumber":"+2348000000000","password":"Passw0rd!","confirmPassword":"Passw0rd!"}'

# 3. Verify with the code from the terminal, then sign in.
curl -X POST localhost:5000/api/auth/verify-email -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","otp":"123456"}'
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Passw0rd!"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 4. The dashboard. Should answer for a brand-new account: empty milestones,
#    "Pending" student ID, attendance "—", nextAction pointing at registration.
curl -s localhost:5000/api/dashboard -H "Authorization: Bearer $TOKEN"

# 5. Save a draft, then submit it. Submitting an incomplete form should return 422
#    with an `errors` map naming each missing field.
curl -X PATCH localhost:5000/api/applications/me -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"firstName":"Ada","furthestStep":1}'
curl -X POST localhost:5000/api/applications/me/submit -H "Authorization: Bearer $TOKEN"

# 6. Upload a photo, then fetch it back through GridFS.
curl -X POST localhost:5000/api/applications/me/files/photo \
  -H "Authorization: Bearer $TOKEN" -F 'photo=@passport.jpg'

# 7. Admin sign-in, then the review queue.
ADMIN=$(curl -s -X POST localhost:5000/api/admin/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@wofbi.local","password":"<SEED_ADMIN_PASSWORD>"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
curl -s localhost:5000/api/admin/overview -H "Authorization: Bearer $ADMIN"
curl -s localhost:5000/api/admin/applications?status=Review -H "Authorization: Bearer $ADMIN"
```

Worth confirming by hand, because these are the behaviours with no test coverage:

- Approving an application issues a student ID, and **approving it a second time
  issues nothing new** — same id, one enrollment.
- Checking in twice in one day leaves one attendance record, and the second call
  reports the first rather than failing.
- Enrolling in LCC before finishing BCC returns `PREREQUISITE_NOT_MET`.
- `GET /api/certificates/verify/<number>` answers without any token, and reports a
  revoked certificate as existing-but-invalid rather than missing.
- Re-running `npm run seed` changes nothing and loses nothing.

## Endpoints

Run `npm run check` for the authoritative list — it reads the live route stack, so
it cannot go stale. Seventy-six routes across eleven routers, grouped as:

| Prefix | Covers |
| --- | --- |
| `/api/auth` | Register, login, OTP, password reset, profile |
| `/api/dashboard` | The entire student dashboard in one request |
| `/api/applications` | The four-step form: draft, submit, file uploads |
| `/api/payments` | The registration fee and its receipt |
| `/api/courses` | Catalogue, access rules, lessons, completion |
| `/api/attendance` | Rate, history, daily self check-in |
| `/api/assignments` | Coursework and submissions |
| `/api/announcements` | With per-student read state |
| `/api/certificates` | Own certificates, plus public verification |
| `/api/files` | GridFS streaming |
| `/api/admin` | Console: review queues, roster, content, records |

Field-by-field mapping onto the dashboard components, and a JavaScript client for
all of it, are in `../Lfc-website/lfc/API_INTEGRATION.md`.

## Notes for deploying

Set `NODE_ENV=production`, real SMTP credentials, and add the frontend's origin to
`ALLOWED_ORIGINS` if it is not the same as `CLIENT_URL` — otherwise the browser
blocks the requests. Change the seeded admin password on first login. Leave
`DISABLE_RATE_LIMIT` unset: it turns off the sign-in, OTP and upload limits and
exists only for testing a login screen repeatedly.

`SIGTERM` and `SIGINT` are handled: the server stops accepting connections,
finishes what is in flight, closes the Mongoose connection, and gives up after ten
seconds if something hangs.
