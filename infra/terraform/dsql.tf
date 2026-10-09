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

# The AWS provider 5.x resource exports no endpoint attribute, but DSQL
# endpoints are always <identifier>.dsql.<region>.on.aws.
locals {
  dsql_endpoint = "${aws_dsql_cluster.main.identifier}.dsql.${var.aws_region}.on.aws"
}

output "dsql_endpoint" {
  description = "Aurora DSQL cluster endpoint"
  value       = local.dsql_endpoint
}
