# ─── ECS Cluster & ECR Repositories ────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "stride-cluster-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "stride"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# ML worker shares the same ECR repo with a different tag
# Image: stride:ml-worker-latest

# ─── Security Group: ECS Tasks ─────────────────────────────────────

resource "aws_security_group" "ecs_tasks" {
  name        = "stride-ecs-tasks-sg-${var.environment}"
  description = "Access control for ECS container instances"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow traffic from ALB on port 3000"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "stride-ecs-tasks-sg-${var.environment}"
    Environment = var.environment
  }
}

# ─── CloudWatch Log Groups ─────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/stride-api-${var.environment}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "ml_worker" {
  name              = "/ecs/stride-ml-worker-${var.environment}"
  retention_in_days = 30
}

# ─── ECS Task Definitions ──────────────────────────────────────────

# 1. Express API (Fargate)
resource "aws_ecs_task_definition" "api" {
  family                   = "stride-api-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.api_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:api-latest"
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "S3_BUCKET", value = aws_s3_bucket.videos.id },
        { name = "SQS_QUEUE_URL", value = aws_sqs_queue.analysis.url },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SUPABASE_URL", value = var.supabase_url },
        { name = "INTERNAL_API_SECRET", value = var.internal_secret },
        { name = "DSQL_ENDPOINT", value = aws_dsql_cluster.main.endpoint },
        { name = "SENTRY_DSN", value = var.sentry_dsn_api },
      ]
    }
  ])
}

# 2. ML Worker (runs on GPU-enabled instances or high-CPU Fargate)
resource "aws_ecs_task_definition" "ml_worker" {
  family                   = "stride-ml-worker-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"] # FARGATE for ease of deployment, or EC2 for GPU
  cpu                      = "1024"      # 1 vCPU
  memory                   = "2048"      # 2 GB RAM
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ml_worker_role.arn

  container_definitions = jsonencode([
    {
      name      = "ml-worker"
      image     = "${aws_ecr_repository.api.repository_url}:ml-worker-latest"
      essential = true
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ml_worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ml-worker"
        }
      }
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "S3_BUCKET", value = aws_s3_bucket.videos.id },
        { name = "SQS_QUEUE_URL", value = aws_sqs_queue.analysis.url },
        { name = "API_SERVER_URL", value = "http://${aws_lb.api.dns_name}" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "INTERNAL_API_SECRET", value = var.internal_secret },
        { name = "SENTRY_DSN", value = var.sentry_dsn_worker },
        { name = "DSQL_ENDPOINT", value = aws_dsql_cluster.main.endpoint },
      ]
    }
  ])
}

# ─── ECS Services ──────────────────────────────────────────────────

# 1. API Service (Multi-instance - min 2 tasks as required by PRD)
resource "aws_ecs_service" "api" {
  name            = "stride-api-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}

# 2. ML Worker Service (SQS poller, single replica for processing)
resource "aws_ecs_service" "ml_worker" {
  name            = "stride-ml-worker-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ml_worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }
}
