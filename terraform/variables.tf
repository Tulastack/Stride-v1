variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "stride"
}

variable "vpc_id" {
  description = "Existing VPC ID"
  type        = string
  default     = "vpc-0e5f3ce34a6b31884"
}

variable "public_subnets" {
  description = "Public subnet IDs for ECS tasks and ALB"
  type        = list(string)
  default = [
    "subnet-04e2da0c0914b6dc3",
    "subnet-0fda307b1c8d50b21",
    "subnet-0f14510352d3a9d76",
  ]
}

variable "dsql_cluster_id" {
  description = "Existing Aurora DSQL cluster identifier"
  type        = string
  default     = "sztwxa4q2knxrbnfldh5x3fita"
}

variable "api_desired_count" {
  description = "Desired number of API tasks"
  type        = number
  default     = 1
}

variable "frontend_desired_count" {
  description = "Desired number of frontend tasks"
  type        = number
  default     = 1
}

variable "api_max_count" {
  description = "Max number of API tasks for auto-scaling"
  type        = number
  default     = 4
}

variable "frontend_max_count" {
  description = "Max number of frontend tasks for auto-scaling"
  type        = number
  default     = 3
}
