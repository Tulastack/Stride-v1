# ─── Fallback HTTPS without DNS (off by default) ──────────────────────────────
# iOS release builds refuse plain http://. The normal path is an ACM
# certificate on the ALB for api.strideforrunners.com (acm_certificate_arn +
# api_domain). If the DNS records for that can't be added yet, set
# enable_cloudfront_https = true to put CloudFront in front of the ALB: it
# serves the API at https://<id>.cloudfront.net with no domain or certificate
# work, and nothing is cached (every request goes straight to the API).
#
# The app bakes its API URL in at build time, so switching the app to the
# CloudFront URL (and later back to api.strideforrunners.com) needs a new EAS
# build each time.

variable "enable_cloudfront_https" {
  description = "Serve the API over https://<id>.cloudfront.net (no DNS needed). Use only while the ALB has no ACM certificate."
  type        = bool
  default     = false
}

locals {
  # AWS-managed policies (stable IDs, documented by AWS).
  cf_policy_caching_disabled       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cf_policy_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

resource "aws_cloudfront_distribution" "api" {
  count           = var.enable_cloudfront_https ? 1 : 0
  enabled         = true
  comment         = "Stride API HTTPS front door (no custom domain)"
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true

  origin {
    domain_name = aws_lb.api.dns_name
    origin_id   = "stride-alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = "stride-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cf_policy_caching_disabled
    origin_request_policy_id = local.cf_policy_all_viewer_except_host
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    precondition {
      # With a certificate attached the ALB redirects HTTP to HTTPS on the ALB's
      # own hostname, which this http-only origin would follow into a loop.
      condition     = var.acm_certificate_arn == ""
      error_message = "enable_cloudfront_https is a fallback for when the ALB has no certificate. Turn it off once acm_certificate_arn is set."
    }
  }
}

output "api_https_url" {
  description = "The HTTPS base URL the app should use (EXPO_PUBLIC_API_BASE_URL)."
  value = (
    var.acm_certificate_arn != "" ? "https://${var.api_domain}" :
    var.enable_cloudfront_https ? "https://${aws_cloudfront_distribution.api[0].domain_name}" :
    "(none yet: set acm_certificate_arn + api_domain, or enable_cloudfront_https)"
  )
}
