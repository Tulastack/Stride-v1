# ─── IAM Roles ─────────────────────────────────────────────────────
# Day-1 requirement. No credentials in env vars, no root keys, ever.

# ─── Node API ECS Task Role ───────────────────────────────────────

resource "aws_iam_role" "api_task_role" {
  name = "stride-api-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_s3_access" {
  name = "stride-api-s3-access"
  role = aws_iam_role.api_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:CreateMultipartUpload",
          "s3:CompleteMultipartUpload",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
          "s3:UploadPart"
        ]
        Resource = "${aws_s3_bucket.videos.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.videos.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_sqs_access" {
  name = "stride-api-sqs-access"
  role = aws_iam_role.api_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.analysis.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_dsql_access" {
  name = "stride-api-dsql-access"
  role = aws_iam_role.api_task_role.id

  # Scoped to the one Stride cluster (was cluster/*). TODO: move both services
  # off the admin DB role and drop DbConnectAdmin once non-admin DSQL roles exist.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dsql:DbConnect",
          "dsql:DbConnectAdmin"
        ]
        Resource = aws_dsql_cluster.main.arn
      }
    ]
  })
}

# ─── ML Worker ECS Task Role ──────────────────────────────────────
# Used as the Fargate task_role_arn (ecs.tf) — the trust principal MUST be
# ecs-tasks.amazonaws.com or ECS refuses to launch the task.

resource "aws_iam_role" "ml_worker_role" {
  name = "stride-ml-worker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ml_worker_sqs_access" {
  name = "stride-ml-worker-sqs-access"
  role = aws_iam_role.ml_worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.analysis.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.analysis_dlq.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "ml_worker_s3_access" {
  name = "stride-ml-worker-s3-access"
  role = aws_iam_role.ml_worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.videos.arn}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ml_worker_dsql_access" {
  name = "stride-ml-worker-dsql-access"
  role = aws_iam_role.ml_worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dsql:DbConnect",
          "dsql:DbConnectAdmin"
        ]
        Resource = aws_dsql_cluster.main.arn
      }
    ]
  })
}

# ─── ECS Task Execution Role (shared) ─────────────────────────────

resource "aws_iam_role" "ecs_execution_role" {
  name = "stride-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Lets the execution role inject Secrets Manager values into containers
# (task definitions reference these via `secrets`, not plaintext `environment`).
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "stride-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.internal_api_secret.arn,
          aws_secretsmanager_secret.groq_api_key.arn,
        ]
      }
    ]
  })
}

# ─── Data Sources ──────────────────────────────────────────────────

data "aws_caller_identity" "current" {}
