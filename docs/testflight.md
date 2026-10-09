# Shipping Stride to TestFlight

Everything in code is set up (`apps/mobile/app.json`, `apps/mobile/eas.json`).
What's left needs your accounts, so only you can do it.

## 1. Put the API on https://api.strideforrunners.com (blocker)

Release iOS builds refuse plain `http://`, and the API currently answers only on
`http://stride-alb-1962699315.us-east-1.elb.amazonaws.com`.

1. **Request the certificate.** AWS Console, region **us-east-1** → Certificate
   Manager → Request → Public certificate → domain `api.strideforrunners.com` →
   DNS validation.
2. **Validate it.** ACM shows a CNAME (name starts with `_`, value ends in
   `.acm-validations.aws.`). Add that record wherever strideforrunners.com's DNS is
   managed (the registrar, or Vercel → Domains if the site's DNS lives there).
   Wait until ACM says **Issued**, usually 5–30 minutes.
3. **Point the name at the load balancer.** Add a second record at the same DNS host:
   `CNAME  api  →  stride-alb-1962699315.us-east-1.elb.amazonaws.com`
4. **Attach it.** In `infra/terraform/terraform.tfvars`:
   ```hcl
   acm_certificate_arn = "arn:aws:acm:us-east-1:442004016139:certificate/<id from step 1>"
   api_domain          = "api.strideforrunners.com"
   ```
   Then `cd infra/terraform && terraform plan` (expect a new HTTPS listener, the HTTP
   listener switching to a redirect, and the worker's `API_SERVER_URL` changing) and
   `terraform apply`.
5. **Check:** `curl https://api.strideforrunners.com/health` returns 200.

## 2. Set the build's environment variables (once)

Run these from `apps/mobile`:

```sh
npm install -g eas-cli
eas login
eas init                       # links the project, writes the projectId into app.json
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.strideforrunners.com --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<project>.supabase.co --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon/publishable key> --visibility plaintext
```

Only the **anon / publishable** Supabase key goes here. Never the service_role key
or the JWT secret: anything `EXPO_PUBLIC_*` ships inside the app.

## 3. Host the app's privacy and support pages

strideforrunners.com/privacy covers **the website's waitlist only** (it says so),
so it can't be the app's privacy URL. Its footer also says "Stride Biomechanics";
the registered name is Stride Biometrics, LLC.

Quickest: GitHub → Stride-v1 → Settings → Pages → Deploy from branch `main`,
folder `/docs`. Use these in App Store Connect:

- Privacy: `https://tulastack.github.io/Stride-v1/privacy/`
- Support: `https://tulastack.github.io/Stride-v1/support/`

Later you can copy `docs/privacy`, `docs/terms` and `docs/support` into the website
(e.g. `strideforrunners.com/app/privacy`) and swap the URLs. After editing
`apps/mobile/src/content/legal.ts`, run `node scripts/build-legal-pages.mjs`.

## 4. Build and upload (after Apple approves the developer account)

```sh
cd apps/mobile
eas build --platform ios --profile production --auto-submit
```

Sign in with the Apple ID that owns the developer account when asked, and let EAS
create the certificate, provisioning profile and App Store Connect app. The bundle
ID is `com.stridebiometrics.stride`; it becomes permanent after the first upload,
so change `ios.bundleIdentifier` in `app.json` before then if you want a different
one. Build numbers increase automatically.

## 5. Testers

App Store Connect → your app → TestFlight:

- **Internal** (no review, same day): Users and Access → add people with an App
  Store Connect role, then add them to an internal group.
- **External** (up to 10,000, public link): create a group, fill in Test
  Information (beta description, feedback email, privacy URL from step 3) and a
  **demo login** for the reviewer, then submit for Beta App Review (~1 day).
