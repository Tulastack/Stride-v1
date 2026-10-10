# ─── Secrets Manager ───────────────────────────────────────────────
# Secrets are injected into ECS containers via the task definitions' `secrets`
# blocks (see ecs.tf) instead of plaintext `environment` entries, so they never
# appear in DescribeTaskDefinition output or the ECS console.
#
# Values are seeded from the same tfvars the task definitions previously used;
# rotate by updating the secret version (no task-definition change needed,
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

resource "aws_secretsmanager_secret" "supabase_service_role_key" {
  count       = var.supabase_service_role_key != "" ? 1 : 0
  name        = "stride/${var.environment}/supabase-service-role-key"
  description = "Supabase service_role key, used only by DELETE /users/me to remove the auth user"
}

resource "aws_secretsmanager_secret_version" "supabase_service_role_key" {
  count         = var.supabase_service_role_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.supabase_service_role_key[0].id
  secret_string = var.supabase_service_role_key
}

# Coach LLM. resolveCoachProvider() (apps/api/src/lib/coach/provider.ts) picks
# Google automatically when GOOGLE_API_KEY is set; without it the coach falls
# back to Groq, whose free-tier token budget can't fit an agent turn.
resource "aws_secretsmanager_secret" "google_api_key" {
  count       = var.google_api_key != "" ? 1 : 0
  name        = "stride/${var.environment}/google-api-key"
  description = "Google AI Studio key for the coach LLM (Gemini)"
}

resource "aws_secretsmanager_secret_version" "google_api_key" {
  count         = var.google_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.google_api_key[0].id
  secret_string = var.google_api_key
}

resource "aws_secretsmanager_secret" "inception_api_key" {
  count       = var.inception_api_key != "" ? 1 : 0
  name        = "stride/${var.environment}/inception-api-key"
  description = "Inception (Mercury) key for the coach LLM"
}

resource "aws_secretsmanager_secret_version" "inception_api_key" {
  count         = var.inception_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.inception_api_key[0].id
  secret_string = var.inception_api_key
}
