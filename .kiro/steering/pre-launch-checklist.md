# Pre-Launch Checklist

These items MUST be completed before any real users access the app (TestFlight, APK, or production):

## Required Before Launch

- [x] **HTTPS** (done 2026-10-09, ACM cert on the ALB for api.strideforrunners.com), Add ACM certificate + HTTPS listener on the ALB. Credentials are sent in plaintext over HTTP. App stores will reject without TLS.
- [ ] **Rate limiting**, Add AWS WAF on the ALB and/or express-rate-limit middleware. Without this, a single script can rack up costs or crash the service.
- [ ] **Input sanitization**, Already done for `/api/users`, but every new endpoint must use express-validator before any DB operation.

## Nice to Have Before Launch

- [x] Custom domain: api.strideforrunners.com (Namecheap CNAME to the ALB)
- [ ] MFA for users (flip Cognito `mfa_configuration` to OPTIONAL)
- [ ] Structured logging (replace console.log with pino)
- [ ] CloudWatch alarms (unhealthy targets, error rates)
- [ ] CI/CD pipeline (GitHub Actions → ECR → ECS)

## Reference

- API: `https://api.strideforrunners.com` (ALB `stride-api-alb-production-1828400343.us-east-1.elb.amazonaws.com`)
- Cognito User Pool: check `terraform output cognito_user_pool_id`
- DSQL Cluster: `gft3jhbw2zbldbhnokioha5epm.dsql.us-east-1.on.aws` (production). `sztwxa4q2knxrbnfldh5x3fita` is an old prototype, unused
- Supabase: `https://rcmllqdxcxauebtowimy.supabase.co`
- S3: `stride-videos-production`, SQS: `stride-analysis-production`
- Never run `terraform destroy` (it took production down in July 2026)
