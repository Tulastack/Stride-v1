# ─── Application Load Balancer (ALB) ────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "stride-alb-sg-${var.environment}"
  description = "Allow inbound public HTTP/HTTPS traffic to ALB"
  vpc_id      = var.vpc_id

  ingress {
    description      = "HTTP from public Internet"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS from public Internet"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "stride-alb-sg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_lb" "api" {
  name               = "stride-api-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false # disable for MVP speed

  tags = {
    Name        = "stride-api-alb-${var.environment}"
    Environment = var.environment
  }
}

# Target Group with STICKY SESSIONS enabled.
# Guarantees the SSE clients stick to the same ECS container task instances.
resource "aws_lb_target_group" "api" {
  name        = "stride-api-tg-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    port                = "3000"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  # CRITICAL RESOLUTION: ALB Sticky Sessions enable client connections 
  # to hit the exact same backend instance for SSE/REST callbacks.
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400 # 24 hours
    enabled         = true
  }

  tags = {
    Name        = "stride-api-tg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = "80"
  protocol          = "HTTP"

  # Redirect to HTTPS in production, or forward directly for dev/staging without SSL certs setup
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ─── CloudWatch Alarm: Unhealthy Targets ───────────────────────────

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name          = "stride-api-unhealthy-targets-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "API has unhealthy targets behind the ALB"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.api.arn_suffix
    LoadBalancer = aws_lb.api.arn_suffix
  }

  # TODO: Add SNS topic ARN for notifications
  # alarm_actions = [aws_sns_topic.oncall.arn]
}
