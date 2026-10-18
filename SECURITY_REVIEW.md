# Security review — October 17, 2026

Reviewed the repository, reachable Git history, dependency advisories, Express
server, Netlify function, browser rendering, and the published site at
https://loandecipher.netlify.app/.

## Verified on the current live deployment

- The homepage and browser assets respond successfully. An API GET returns 405;
  an empty-input JSON POST returns 400 without making a paid AI request.
- `/.env`, `/.env.local`, `/.git/config`, and local `.preview/` output return 404.
- No real API key was found in the checked public responses or tracked source.
  The one key-shaped history match is a repeated-character placeholder in an
  old `.env.example`, not a real credential. The actual `.env` is ignored and
  is not tracked.
- `/server.js`, `/openai-proxy.js`, `/netlify/functions/openai.mjs`,
  `/package.json`, and the fictional test PDF are publicly downloadable.
  No actual key was present in those source files, but the project root should
  not be the public output directory.
- HTTPS is enabled. The old deployment lacks the additional application
  security headers now prepared locally.

## Fixes prepared locally

- Build only `index.html`, `styles.css`, `analysis.js`, and `app.js` into `dist/`,
  plus generated response headers. Remove stale build output. Netlify now
  publishes `dist/`; local Express serves the same four-file allowlist.
  Server code, dependencies, tests, test PDFs, and private files are excluded.
  This follows [Netlify's recommendation to separate function source from the
  publish directory](https://docs.netlify.com/build/functions/configuration/).
- Add frame protection, MIME-sniffing protection, referrer restrictions,
  permissions restrictions, and a content security policy. Existing inline
  event handlers require `unsafe-inline`; untrusted document/chat text is
  separately escaped or rendered as text.
- Configure the Netlify function for 20 requests per 60 seconds per IP/domain.
  Reject cross-site browser POSTs and non-JSON submissions. These checks do not
  authenticate a caller or prevent scripts from calling the public endpoint.
- Limit request bodies and allow text or inline file/image inputs only. Reject
  remote URLs, account file references, and tool-result input. Client-supplied
  model, storage, tools, and previous-response settings are not forwarded.
- Keep `store:false` and add `Cache-Control: no-store` to API responses. Replace
  provider errors with controlled messages so credential fragments, account
  details, and request data cannot be echoed through those errors.
- Apply compatible dependency fixes and a patched `qs` override. The final npm
  install reported zero known vulnerabilities. Netlify's function still imports
  no Express/dotenv dependencies.
- Ignore generated dependencies/output and remove the 650 previously committed
  `node_modules` files from Git tracking, preserving installed files on disk.
- Bind the local development server to loopback. Change the generic upload
  error heading so infrastructure failures do not imply the PDF is invalid.

The Netlify secret-scanning exclusions remain limited to non-secret
`OPENAI_MODEL` and `PORT`; API-key scanning has not been disabled.

## Validation and remaining deployment work

All 53 automated tests passed, including the seven new security regressions.
The production asset build passed. The tests verify blocked private paths,
clean build output, safe error responses, input restrictions, and normal API
forwarding without spending AI credits.
The generated public build also passed browser checks at five desktop/phone
sizes, with the security headers applied and no JavaScript exceptions.

These fixes have not been pushed or deployed by this review. After deployment,
confirm the private/source/test paths above return 404 and the browser assets
and uploads still work. Check Netlify's post-processing log for the accepted
rate-limit rule: [invalid rate-limit rules do not necessarily fail a
deploy](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
Old immutable deploy URLs may retain their earlier published files; the files
confirmed exposed in this review contain server source or fictional data.

This review does not establish a guarantee that nothing can ever be exposed.
The AI endpoint remains public and unauthenticated, so rate limiting is not a
global spending cap. Provider usage monitoring and authentication/bot verification
are the remaining measures for broader public use. Netlify account permissions,
environment-variable scopes, historic logs, and provider-side retention settings
could not be audited without authenticated account access. Uploaded files are
sent to OpenAI; the application itself does not persist them. Explicit local
evaluation scripts save results only under ignored `.preview/`.
