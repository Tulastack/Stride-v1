# Pre-Launch Checklist

These items MUST be completed before any real users access the app (TestFlight, APK, or production):

## Required Before Launch

- [ ] **HTTPS** — Add ACM certificate + HTTPS listener on the ALB. Credentials are sent in plaintext over HTTP. App stores will reject without TLS.
- [ ] **Rate limiting** — Add AWS WAF on the ALB and/or express-rate-limit middleware. Without this, a single script can rack up costs or crash the service.
- [ ] **Input sanitization** — Already done for `/api/users`, but every new endpoint must use express-validator before any DB operation.

## Nice to Have Before Launch

- [ ] Custom domain (Route 53 + ALB alias record)
- [ ] MFA for users (flip Cognito `mfa_configuration` to OPTIONAL)
- [ ] Structured logging (replace console.log with pino)
- [ ] CloudWatch alarms (unhealthy targets, error rates)
- [ ] CI/CD pipeline (GitHub Actions → ECR → ECS)

## Reference

- ALB URL: `http://stride-alb-1962699315.us-east-1.elb.amazonaws.com`
- Cognito User Pool: check `terraform output cognito_user_pool_id`
- DSQL Cluster: `sztwxa4q2knxrbnfldh5x3fita.dsql.us-east-1.on.aws`
