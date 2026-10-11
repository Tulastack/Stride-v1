# ─── Variables ─────────────────────────────────────────────────────

variable "vpc_id" {
  description = "VPC ID for all resources"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB and ECS tasks"
  type        = list(string)
}

# ─── Scaling ───────────────────────────────────────────────────────

variable "api_min_count" {
  description = "Minimum number of API tasks"
  type        = number
  default     = 2
}

variable "api_max_count" {
  description = "Maximum number of API tasks for auto-scaling"
  type        = number
  default     = 6
}

variable "ml_worker_max_count" {
  description = "Maximum number of ML worker tasks"
  type        = number
  default     = 3
}

# ─── TLS / Alerting ───────────────────────────────────────────────

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the ALB HTTPS listener. Empty = HTTP only (dev). REQUIRED before launch: without it JWTs/biometric data transit plaintext and iOS ATS blocks the API."
  type        = string
  default     = ""
}

variable "api_domain" {
  description = "Public hostname the ACM certificate covers and DNS points at the ALB (e.g. api.strideforrunners.com). Required when acm_certificate_arn is set."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email address subscribed to the stride-alerts SNS topic (CloudWatch alarms). Empty = alarms fire into the void."
  type        = string
  default     = ""
}

variable "supabase_service_role_key" {
  description = "Supabase service_role key. Lets DELETE /users/me also remove the Supabase auth user (App Store account-deletion requirement). Empty = app data is deleted but the login remains."
  type        = string
  default     = ""
  sensitive   = true
}

variable "inception_api_key" {
  description = "Inception (Mercury) key for the coach LLM. When set, the coach uses Mercury 2.5, the model it is tuned for; otherwise Google (google_api_key), then Groq."
  type        = string
  default     = ""
  sensitive   = true
}
