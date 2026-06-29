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
