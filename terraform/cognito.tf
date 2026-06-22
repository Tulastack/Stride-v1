# Cognito User Pool — identity store for app users
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-user-pool"

  # Sign-in options: email, phone, or username
  username_attributes = ["email", "phone_number"]
  auto_verified_attributes = ["email"]

  # Username configuration
  username_configuration {
    case_sensitive = false
  }

  # Password policy
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  # Schema attributes
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 255
    }
  }

  schema {
    name                = "given_name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  schema {
    name                = "family_name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  # Account recovery via email
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }

  # MFA (optional, can enable later)
  mfa_configuration = "OFF"

  tags = {
    Name = "${var.project_name}-user-pool"
  }
}

# App client for React Native (no client secret — mobile apps can't store secrets)
resource "aws_cognito_user_pool_client" "mobile" {
  name         = "${var.project_name}-mobile-client"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  # Token expiration
  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Prevent user existence errors from leaking info
  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]

  # Google can be added later:
  # supported_identity_providers = ["COGNITO", "Google"]
}

# Placeholder for Google identity provider (uncomment when ready)
# resource "aws_cognito_identity_provider" "google" {
#   user_pool_id  = aws_cognito_user_pool.main.id
#   provider_name = "Google"
#   provider_type = "Google"
#
#   provider_details = {
#     client_id        = "<YOUR_GOOGLE_CLIENT_ID>"
#     client_secret    = "<YOUR_GOOGLE_CLIENT_SECRET>"
#     authorize_scopes = "openid email profile"
#   }
#
#   attribute_mapping = {
#     email       = "email"
#     given_name  = "given_name"
#     family_name = "family_name"
#     username    = "sub"
#   }
# }
