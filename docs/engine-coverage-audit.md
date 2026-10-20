# Hosted page engine coverage — 2026-10-20

The engine entry excluded all of Google Docs and Drive, including Forms response
pages and public file viewers. It also excluded entire Okta, Auth0, OneLogin, Duo,
PingOne, B2C Login, CIAM Login, Cognito and Shopify domain families. This proved an
injection gap; it did not prove arbitrary tenant HTML hosting on each provider.

The engine now runs on Docs/Drive and ordinary routes in those nine families.
Fixed-prefix authentication routes remain excluded by the manifest. Tenant-variable
routes are checked in `engine-compat.js` using `URL.pathname`; manifest globs can
consume an auth-looking string inside the query. Engine startup and Permission
Chain return before hooks on these routes, and worker health/repair uses the same
decision. Merely placing `/oauth2/authorize` in a content-page query cannot opt out.

Other manifest compatibility exceptions, including dedicated Google/Microsoft
account hosts, challenge providers and Google communication apps, are unchanged.
The separate fingerprint realm keeps its broader exclusions. The restored engine
and embedded frames also keep fingerprint noise off on the affected hosted apps.
Only four engine settings are paused there: `antiFingerprintNoise`, its alias
`antiFingerprint`, `removeOverlays` and `autoRejectConsent`. The popup uses the
shared host policy to disclose those pauses. Core security guards remain enabled.

## Authentication route evidence

Path families were checked against provider documentation. Some extra paths retain
existing flow compatibility, including recovery, continuation and MFA routes.

- [Auth0 Universal Login](https://auth0.com/docs/authenticate/login/auth0-universal-login)
  starts at `/authorize`; [identifier-first login](https://support.auth0.com/center/s/article/automated-testing-with-identifier-first-universal-login)
  uses `/u/login/identifier` and `/u/login/password`.
- [Okta authorization](https://developer.okta.com/docs/guides/authorization/)
  includes `/oauth2/{authorizationServerId}/v1/authorize`; the tenant root and
  sign-in routes retain their exclusions.
- [OneLogin authorization](https://developers.onelogin.com/docs/openid-connect/api/authorization-code/)
  uses `/oidc/2/auth`.
- [Duo Universal Prompt](https://duo.com/docs/oauthapi) starts at
  `/oauth/v1/authorize`; traditional and current prompt frames retain `/frame/*`.
- [PingOne's application guide](https://docs.pingidentity.com/pingone/pingone_tutorials/p1_tutorial_integrate_nodejs_express_app.html)
  identifies the environment-scoped `/as/authorize` endpoint.
- [Microsoft B2C migration guidance](https://learn.microsoft.com/en-us/azure/active-directory-b2c/b2clogin)
  identifies both policy-in-path and query-policy authorization routes.
- [Cognito endpoint reference](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints.html)
  identifies `/oauth2/authorize`; login, recovery and MFA paths remain excluded.
- [Shopify authentication](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps)
  documents authentication separately from hosted content; dedicated account and
  authentication namespaces retain compatibility exceptions.

## Regression evidence

The unit suite runs the worker coverage checks, early engine return and real
configuration derivation. It checks content routes, known login URLs, host
lookalikes, query smuggling and preservation of named security guards.

The browser smoke suite fulfills synthetic HTTPS documents at the actual host/path
shapes, exercising native content-script matching. It checks thirteen content URLs
and nine login URLs, preserved editing/form submitters, native fingerprint signals,
and an actual ClickFix warning on a Google Forms URL. These fixtures do not complete
authenticated sessions against provider accounts.

Validation passed: all 292 suites in the maintainability gate, plus the native
HTTPS fixture checks in Edge 150.0.4078.48 and Chrome 121.0.6167.184. The release
inventory includes the new helper. Its temporary staging for the package check
was removed after validation; no commit or push was made.
