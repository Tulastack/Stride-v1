#!/bin/bash
# Deploy script — builds images, pushes to ECR, and updates ECS services.
# Usage: ./scripts/deploy.sh [api|frontend|all]
#   api       — deploy only the API service
#   frontend  — deploy only the frontend service
#   all       — deploy both (default)

set -e

REGION="us-east-1"
ACCOUNT_ID="442004016139"
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/stride"
CLUSTER="default"
API_SERVICE="stride-api"
FRONTEND_SERVICE="stride-frontend"
TARGET="${1:-all}"

# --- Helpers ---

log() { echo -e "\n\033[1;34m▶ $1\033[0m"; }
success() { echo -e "\033[1;32m✔ $1\033[0m"; }
fail() { echo -e "\033[1;31m✖ $1\033[0m"; exit 1; }

check_prereqs() {
  command -v aws >/dev/null 2>&1 || fail "AWS CLI not installed"
  command -v docker >/dev/null 2>&1 || fail "Docker not installed"
  aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"
}

ecr_login() {
  log "Logging in to ECR..."
  aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
}

deploy_api() {
  log "Building API image (linux/amd64)..."
  docker build --platform linux/amd64 -t "${ECR_REPO}:api-latest" ./api

  log "Pushing API image to ECR..."
  docker push "${ECR_REPO}:api-latest"

  log "Updating ECS API service..."
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$API_SERVICE" \
    --force-new-deployment \
    --region "$REGION" \
    --no-cli-pager

  success "API deployed"
}

deploy_frontend() {
  log "Building frontend image (linux/amd64)..."
  docker build --platform linux/amd64 -t "${ECR_REPO}:frontend-latest" ./frontend

  log "Pushing frontend image to ECR..."
  docker push "${ECR_REPO}:frontend-latest"

  log "Updating ECS frontend service..."
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$FRONTEND_SERVICE" \
    --force-new-deployment \
    --region "$REGION" \
    --no-cli-pager

  success "Frontend deployed"
}

# --- Main ---

check_prereqs
ecr_login

case "$TARGET" in
  api)      deploy_api ;;
  frontend) deploy_frontend ;;
  all)      deploy_api; deploy_frontend ;;
  *)        fail "Unknown target: $TARGET (use api, frontend, or all)" ;;
esac

echo ""
success "Deployment complete!"
echo "ALB URL: http://stride-alb-1962699315.us-east-1.elb.amazonaws.com"
