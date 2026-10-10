# Stride: TestFlight + backend runbook

## Where things stand (2026-10-09)

| Piece | Value / state |
|---|---|
| API | `https://api.strideforrunners.com` (HTTP redirects to HTTPS) |
| Load balancer | `stride-api-alb-production-1828400343.us-east-1.elb.amazonaws.com` |
| HTTPS cert | `arn:aws:acm:us-east-1:442004016139:certificate/51bab60e-38be-4c0c-be9e-e7d8ed0843b9` (issued) |
| DNS | Namecheap: `api` CNAME to the ALB, plus the ACM validation CNAME |
| Database | Aurora DSQL `gft3jhbw2zbldbhnokioha5epm.dsql.us-east-1.on.aws`, deletion-protected, schema + seed content applied. `sztwxa4q2knxrbnfldh5x3fita` is an unused prototype |
| Supabase | `https://rcmllqdxcxauebtowimy.supabase.co` (app uses the publishable key) |
| S3 / SQS | `stride-videos-production` / `stride-analysis-production` |
| ECS | cluster `stride-cluster-production`, services `stride-api-production` (2) and `stride-ml-worker-production` (1) |
| Terraform state | `s3://stride-terraform-state-442004016139`; settings in `infra/terraform/terraform.tfvars` (gitignored) |
| iOS build | EAS project `@thebigt/stride-sprint`, env vars in the EAS `production` environment |
| Bundle ID | `com.stridebiometrics.stride` (App Store Connect name is the placeholder "Stride (2470c6)") |
| Legal pages | `https://tulastack.github.io/Stride-v1/{privacy,terms,support}/` from `site/` |

Steps 1-4 below were completed on 2026-10-08/09; they stay here for rebuilding
from scratch. All commands run from the repo root on the Mac (`~/Desktop/stride-build`)
unless stated. Get the latest code first: `git pull`.

## 1. Check the deploy finished

```sh
aws ecs describe-services --region us-east-1 --cluster stride-cluster-production \
  --services stride-api-production stride-ml-worker-production \
  --query "services[].{name:serviceName,running:runningCount,desired:desiredCount}" --output table
curl -s http://stride-api-alb-production-1828400343.us-east-1.elb.amazonaws.com/health
```

`running` should equal `desired` (API 2, worker 1). `/health` may report `db: error`
until step 3 is done; that is expected.

## 2. Find the database that holds the real data (read-only)

```sh
node apps/api/scripts/dsql/inspect.mjs
```

It connects to both DSQL clusters and prints the row counts per table plus the latest
activity date. The first connection to an INACTIVE cluster wakes it and can take a
minute. The one with real users/analyses is production.

If that is `gft3jhbw2zbldbhnokioha5epm` (not the one Terraform uses now), repoint
Terraform. This only changes which cluster Terraform tracks; neither cluster is
touched or deleted:

```sh
cd infra/terraform
terraform state rm aws_dsql_cluster.main
terraform import aws_dsql_cluster.main gft3jhbw2zbldbhnokioha5epm
terraform plan -out=db.tfplan     # expect: task definitions + DSQL IAM policies change, 0 destroy
terraform apply db.tfplan
cd ../..
```

## 3. Bring that database up to date

Dry run first. It lists what is missing and changes nothing:

```sh
node apps/api/scripts/dsql/migrate.mjs --cluster <real-cluster-id>
```

Then apply:

```sh
node apps/api/scripts/dsql/migrate.mjs --cluster <real-cluster-id> --apply
```

Adds the columns/tables the current app needs (calendar `source`, `revealed_at`,
`completed_on`; drill `recovery_phases`; the `metric_biomechanics` table; the
`uploading` analysis status; widened event types), builds missing indexes, and loads
the drill programs and research content from `apps/api/src/db/seeds`. It never drops
or deletes anything and is safe to re-run. Rehearsed against copies of the June and
July schemas and an empty database.

## 4. HTTPS

### 4a. Normal path: certificate on the load balancer

Two CNAME records in Namecheap (Domain List → Manage → Advanced DNS → Add New Record).
Do not change existing records.

| Host | Value |
|---|---|
| `_afcab4cff6f09ee2da9bc1c6f2966955.api` | `_1c992f47ab792aef292d6dc6fe483fb4.wzccmgtwzk.acm-validations.aws.` |
| `api` | `stride-api-alb-production-1828400343.us-east-1.elb.amazonaws.com` |

Wait for the certificate:

```sh
aws acm describe-certificate --region us-east-1 \
  --certificate-arn arn:aws:acm:us-east-1:442004016139:certificate/51bab60e-38be-4c0c-be9e-e7d8ed0843b9 \
  --query Certificate.Status --output text      # ISSUED when ready
```

Then in `infra/terraform/terraform.tfvars` add:

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:442004016139:certificate/51bab60e-38be-4c0c-be9e-e7d8ed0843b9"
api_domain          = "api.strideforrunners.com"
# Optional, recommended: lets Delete Account also remove the Supabase login.
# Supabase → Project Settings → API keys → the service_role / secret key.
# terraform.tfvars is gitignored; the value goes to AWS Secrets Manager.
# supabase_service_role_key = "..."
```

```sh
cd infra/terraform && terraform plan -out=https.tfplan
# expect: HTTPS listener added, HTTP listener -> redirect, task definitions updated, 0 destroy
terraform apply https.tfplan && cd ../..
curl -s https://api.strideforrunners.com/health
```

The app was built with `https://api.strideforrunners.com`, so no app rebuild is needed.

### 4b. Fallback if DNS can't be changed: CloudFront

```hcl
# terraform.tfvars
enable_cloudfront_https = true
```

`terraform apply`, then `terraform output api_https_url` prints
`https://<id>.cloudfront.net`. Point the app at it and rebuild:

```sh
cd apps/mobile
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://<id>.cloudfront.net --visibility plaintext --force
eas build --platform ios --profile production --auto-submit
```

Once DNS is sorted, do 4a, set `enable_cloudfront_https = false`, switch the env var
back to `https://api.strideforrunners.com`, and rebuild.

## 5. Ship the latest API fixes

```sh
caffeinate -i ./scripts/deploy.sh api      # ~5-10 min; ./scripts/deploy.sh does both services
```

Needed after any API code change (e.g. the DSQL account-deletion fix). Docker images
pile up: if disk runs low, `docker system prune -a` reclaims it.

## 6. Test end to end

1. `curl https://api.strideforrunners.com/health` returns `"status":"ok"`.
2. Install from TestFlight, sign in, film/import a sprint, and check the analysis,
   coach, and calendar.
3. Logs if something fails: CloudWatch → Log groups → `/ecs/stride-api-production`
   and `/ecs/stride-ml-worker-production`.

## Testers

App Store Connect → the app → TestFlight:

- **Internal** (no review, same day): Users and Access → add people with an App
  Store Connect role, then add them to the internal group.
- **External** (up to 10,000, public link): create a group, fill in Test Information
  (beta description, feedback email, privacy URL, and a demo login for the reviewer),
  then submit for Beta App Review (~1 day).

Privacy/support pages live in `site/` and are published by `.github/workflows/pages.yml`
(only that folder is served). One-time setup: GitHub → Settings → Pages → Source:
**GitHub Actions**, then Actions → Pages → Run workflow. URLs:
`https://tulastack.github.io/Stride-v1/privacy/`, `.../terms/`, `.../support/`.
Regenerate after editing `apps/mobile/src/content/legal.ts`: `node scripts/build-legal-pages.mjs`.
`strideforrunners.com/privacy` covers only the website waitlist.

## Guardrails

- Never run `terraform destroy` (it took production down in July). Don't let coding
  agents run Terraform or AWS commands unattended.
- Both DSQL clusters have deletion protection on; leave it on.
- Set an AWS budget alert: Billing → Budgets → monthly cost budget with an email alert.
