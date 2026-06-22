# Aurora DSQL Cluster — existing
# Note: As of writing, DSQL may require aws_dsql_cluster resource from the AWS provider.
# If not yet supported, this serves as documentation and can use aws_rds_cluster as a placeholder.

resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = true

  tags = {
    Name = "Stride-DSQL"
  }
}
