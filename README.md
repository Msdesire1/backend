my backend  tutorial
# Church course API

Authentication API for registration, login, password reset, profile completion, and course access control.

Copy `.env.example` to `.env`, set a strong `JWT_SECRET`, then run `npm start`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account (requires `firstName`, `lastName`, `email`, `phoneNumber`, `password`, `confirmPassword`) |
| POST | `/api/auth/login` | Sign in and receive a bearer token |
| POST | `/api/auth/forgot-password` | Create a 15-minute reset token (logged locally during development) |
| POST | `/api/auth/reset-password/:token` | Reset password (`password`, `confirmPassword`) |
| GET | `/api/auth/me` | Current authenticated member |
| PATCH | `/api/auth/complete-registration` | Submit mandatory profile details after login |
| GET | `/api/courses/access` | Example protected course endpoint |

Send the login token as `Authorization: Bearer <token>`. All `/api/courses` routes reject authenticated users whose profile is incomplete with `REGISTRATION_INCOMPLETE`.

For production, replace the development reset-link log with your transactional email provider and use HTTPS.
