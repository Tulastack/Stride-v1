# ─── Aurora DSQL (opt-in database) ─────────────────────────────────
# The API supports DSQL when DSQL_ENDPOINT is set.
# This resource manages the existing cluster.

resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = true

  tags = {
    Name        = "Stride-DSQL"
    Environment = var.environment
  }
}

output "dsql_endpoint" {
  description = "Aurora DSQL cluster endpoint"
  value       = aws_dsql_cluster.main.endpoint
}
