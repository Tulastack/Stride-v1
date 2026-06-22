# ECS Task Execution Role — existing
data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = ["442004016139"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:*:442004016139:*"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "ecsTaskExecutionRole"
  path               = "/service-role/"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# API Task Role — grants DSQL IAM auth access
resource "aws_iam_role" "api_task" {
  name               = "stride-api-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

# Policy: allow the API task to generate DSQL auth tokens
data "aws_iam_policy_document" "api_dsql_access" {
  statement {
    effect = "Allow"
    actions = [
      "dsql:DbConnect",
      "dsql:DbConnectAdmin",
    ]
    resources = [
      "arn:aws:dsql:${var.aws_region}:442004016139:cluster/${var.dsql_cluster_id}",
    ]
  }
}

resource "aws_iam_role_policy" "api_dsql" {
  name   = "stride-api-dsql-access"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_dsql_access.json
}
