# ─── SQS Queues ───────────────────────────────────────────────────

resource "aws_sqs_queue" "analysis_dlq" {
  name                      = "stride-analysis-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "analysis" {
  name                       = "stride-analysis-${var.environment}"
  visibility_timeout_seconds = 90
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.analysis_dlq.arn
    maxReceiveCount     = 3
  })
}

# ─── CloudWatch Alarm: DLQ Depth ──────────────────────────────────
# Page on-call immediately if ANY message lands in the DLQ

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "stride-analysis-dlq-depth-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Analysis DLQ has messages - jobs are failing after 3 retries"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.analysis_dlq.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ─── CloudWatch Alarm: Queue Age ──────────────────────────────────
# Fires when the oldest queued analysis has waited >10 min — the worker is
# down, wedged, or drowning. This is the "user staring at a spinner" alarm.

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "stride-analysis-queue-age-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 600
  alarm_description   = "Analyses are queueing for >10 min — ML worker down or overloaded"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.analysis.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ─── Outputs ──────────────────────────────────────────────────────

output "analysis_queue_url" {
  value = aws_sqs_queue.analysis.url
}

output "analysis_queue_arn" {
  value = aws_sqs_queue.analysis.arn
}

output "analysis_dlq_arn" {
  value = aws_sqs_queue.analysis_dlq.arn
}
