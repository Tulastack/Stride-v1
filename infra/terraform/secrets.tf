# ─── Secrets Manager ───────────────────────────────────────────────
# Secrets are injected into ECS containers via the task definitions' `secrets`
# blocks (see ecs.tf) instead of plaintext `environment` entries, so they never
# appear in DescribeTaskDefinition output or the ECS console.
#
# Values are seeded from the same tfvars the task definitions previously used;
# rotate by updating the secret version (no task-definition change needed —
# force a new deployment to pick up the new value).

resource "aws_secretsmanager_secret" "internal_api_secret" {
  name        = "stride/${var.environment}/internal-api-secret"
  description = "Shared secret for /internal/* callbacks between the ML worker and the API"
}

resource "aws_secretsmanager_secret_version" "internal_api_secret" {
  secret_id     = aws_secretsmanager_secret.internal_api_secret.id
  secret_string = var.internal_secret
}

resource "aws_secretsmanager_secret" "groq_api_key" {
  name        = "stride/${var.environment}/groq-api-key"
  description = "Groq API key for the coach LLM endpoints"
}

resource "aws_secretsmanager_secret_version" "groq_api_key" {
  secret_id     = aws_secretsmanager_secret.groq_api_key.id
  secret_string = var.groq_api_key
}
