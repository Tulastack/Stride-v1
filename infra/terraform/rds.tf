# ─── RDS PostgreSQL Instance ───────────────────────────────────────

resource "random_password" "db_password" {
  length  = 16
  special = false
}

resource "aws_db_subnet_group" "db" {
  name        = "stride-db-subnet-group-${var.environment}"
  description = "Stride database subnet group"
  subnet_ids  = var.private_subnet_ids
}

resource "aws_security_group" "rds" {
  name        = "stride-rds-sg-${var.environment}"
  description = "Allow inbound PostgreSQL traffic from ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow postgres access from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "stride-rds-sg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_db_instance" "postgres" {
  identifier           = "stride-db-${var.environment}"
  allocated_storage    = 20
  max_allocated_storage = 100
  storage_type         = "gp3"
  engine               = "postgres"
  engine_version       = "16.1"
  instance_class       = "db.t4g.micro"
  db_name              = "stride"
  username             = "stride"
  password             = random_password.db_password.result
  db_subnet_group_name = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot  = var.environment == "dev" ? true : false
  deletion_protection  = var.environment == "prod" ? true : false

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  tags = {
    Name        = "stride-db-${var.environment}"
    Environment = var.environment
  }
}

# ─── Secrets Manager: DB Credentials ───────────────────────────────
# Keep database password rotated and stored securely (IAM/Day-1 dependency)

resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "stride-db-credentials-${var.environment}"
  recovery_window_in_days = 0 # force delete immediately for MVP redeploys
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.postgres.address
    port     = aws_db_instance.postgres.port
    db_name  = aws_db_instance.postgres.db_name
    username = aws_db_instance.postgres.username
    password = random_password.db_password.result
  })
}
