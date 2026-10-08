# Shipping Stride to TestFlight

Everything in code is set up (`apps/mobile/app.json`, `apps/mobile/eas.json`).
What's left needs your accounts, so only you can do it.

## 1. Make the backend reachable over HTTPS (blocker)

Release iOS builds refuse plain `http://`. The API is on
`http://stride-alb-1962699315.us-east-1.elb.amazonaws.com`, so a TestFlight build
can't talk to it.

1. Pick a subdomain you own, e.g. `api.<your-llc-domain>`.
2. AWS Console → Certificate Manager (us-east-1) → Request a public certificate
   for it, validate by DNS.
3. Set `acm_certificate_arn` in `infra/terraform/terraform.tfvars` and run
   `terraform apply`. That adds the 443 listener and redirects HTTP to HTTPS.
4. At your DNS provider, CNAME `api.<domain>` to the ALB hostname.
5. Check: `curl https://api.<domain>/health`.

## 2. Set the build's environment variables (once)

Run these from `apps/mobile`:

```sh
npm install -g eas-cli
eas login
eas init                       # links the project, writes the projectId into app.json
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.<domain> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<project>.supabase.co --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon/publishable key> --visibility plaintext
```

Only the **anon / publishable** Supabase key goes here. Never the service_role key
or the JWT secret: anything `EXPO_PUBLIC_*` ships inside the app.

## 3. Host the privacy and support pages

GitHub → Stride-v1 → Settings → Pages → Deploy from branch `main`, folder `/docs`.
The URLs become:

- Privacy: `https://tulastack.github.io/Stride-v1/privacy/`
- Support: `https://tulastack.github.io/Stride-v1/support/`

After editing `apps/mobile/src/content/legal.ts`, run
`node scripts/build-legal-pages.mjs` so the website matches the app.

## 4. Build and upload (after Apple approves the developer account)

```sh
cd apps/mobile
eas build --platform ios --profile production --auto-submit
```

Sign in with the Apple ID that owns the developer account when asked, and let EAS
create the certificate, provisioning profile and App Store Connect app. If it says
the bundle ID `com.stride.sprint` is taken, change `ios.bundleIdentifier` in
`app.json` (e.g. `com.<yourllc>.stride`) and run it again. Build numbers increase
automatically.

## 5. Testers

App Store Connect → your app → TestFlight:

- **Internal** (no review, same day): Users and Access → add people with an App
  Store Connect role, then add them to an internal group.
- **External** (up to 10,000, public link): create a group, fill in Test
  Information (beta description, feedback email, privacy URL from step 3) and a
  **demo login** for the reviewer, then submit for Beta App Review (~1 day).
