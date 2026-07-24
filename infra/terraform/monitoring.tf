# ─── Alerting ──────────────────────────────────────────────────────
# One SNS topic for every CloudWatch alarm (ALB health, DLQ depth, queue age).
# Set alert_email in tfvars to actually receive pages; the subscription must be
# confirmed from the email inbox after the first apply.

resource "aws_sns_topic" "alerts" {
  name = "stride-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
