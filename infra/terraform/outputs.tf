# ─── Outputs ───────────────────────────────────────────────────────

output "alb_dns" {
  description = "ALB DNS name"
  value       = aws_lb.api.dns_name
}

output "ecr_api_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "s3_bucket" {
  description = "S3 video bucket name"
  value       = aws_s3_bucket.videos.id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "api_service_name" {
  description = "API ECS service name"
  value       = aws_ecs_service.api.name
}

output "ml_worker_service_name" {
  description = "ML worker ECS service name"
  value       = aws_ecs_service.ml_worker.name
}
