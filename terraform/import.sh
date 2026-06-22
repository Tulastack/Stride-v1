#!/bin/bash
# Run this ONCE after 'terraform init' to import existing resources into state.
# This avoids Terraform trying to recreate what already exists.

set -e

echo "Importing existing resources into Terraform state..."

# Security Group
terraform import aws_security_group.ecs sg-042f5d178abf04bd3

# ECR
terraform import aws_ecr_repository.stride stride

# ALB
terraform import aws_lb.main arn:aws:elasticloadbalancing:us-east-1:442004016139:loadbalancer/app/stride-alb/4b8503b2f9a3d1e0
terraform import aws_lb_target_group.api arn:aws:elasticloadbalancing:us-east-1:442004016139:targetgroup/stride-api-tg/abe5c6f3b079e9a7
terraform import aws_lb_target_group.frontend arn:aws:elasticloadbalancing:us-east-1:442004016139:targetgroup/stride-frontend-tg/91d133a8a5b220df
terraform import aws_lb_listener.http arn:aws:elasticloadbalancing:us-east-1:442004016139:listener/app/stride-alb/4b8503b2f9a3d1e0/b0dd755879d88522
terraform import aws_lb_listener_rule.api arn:aws:elasticloadbalancing:us-east-1:442004016139:listener-rule/app/stride-alb/4b8503b2f9a3d1e0/b0dd755879d88522/b685003b2e9e8c88

# IAM
terraform import aws_iam_role.ecs_execution ecsTaskExecutionRole
terraform import aws_iam_role_policy_attachment.ecs_execution ecsTaskExecutionRole/arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
terraform import aws_iam_role.api_task stride-api-task-role

# ECS
terraform import aws_ecs_cluster.main default
terraform import aws_ecs_service.api default/stride-api
terraform import aws_ecs_service.frontend default/stride-frontend
terraform import aws_ecs_task_definition.api arn:aws:ecs:us-east-1:442004016139:task-definition/default-stride-5320:9
terraform import aws_ecs_task_definition.frontend arn:aws:ecs:us-east-1:442004016139:task-definition/stride-frontend:1

# DSQL
terraform import aws_dsql_cluster.main sztwxa4q2knxrbnfldh5x3fita

echo ""
echo "Done! Run 'terraform plan' to verify no changes are needed."
