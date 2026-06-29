#!/bin/bash
# Deploy script — builds images, pushes to ECR, and updates ECS services.
# Usage: ./scripts/deploy.sh [api|ml-worker|all]
#   api        — deploy only the API service
#   ml-worker  — deploy only the ML worker service
#   all        — deploy both (default)

set -e

REGION="us-east-1"
ACCOUNT_ID="442004016139"
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
CLUSTER="default"
API_SERVICE="stride-api"
ML_WORKER_SERVICE="stride-ml-worker"
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
    docker login --username AWS --password-stdin "${ECR_BASE}"
}

deploy_api() {
  log "Building API image (linux/amd64)..."
  docker build --platform linux/amd64 -t "${ECR_BASE}/stride:api-latest" ./apps/api

  log "Pushing API image to ECR..."
  docker push "${ECR_BASE}/stride:api-latest"

  log "Updating ECS API service..."
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$API_SERVICE" \
    --force-new-deployment \
    --region "$REGION" \
    --no-cli-pager

  success "API deployed"
}

deploy_ml_worker() {
  log "Building ML worker image (linux/amd64)..."
  docker build --platform linux/amd64 -t "${ECR_BASE}/stride:ml-worker-latest" ./apps/ml-worker

  log "Pushing ML worker image to ECR..."
  docker push "${ECR_BASE}/stride:ml-worker-latest"

  log "Updating ECS ML worker service..."
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$ML_WORKER_SERVICE" \
    --force-new-deployment \
    --region "$REGION" \
    --no-cli-pager

  success "ML worker deployed"
}

# --- Main ---

check_prereqs
ecr_login

case "$TARGET" in
  api)       deploy_api ;;
  ml-worker) deploy_ml_worker ;;
  all)       deploy_api; deploy_ml_worker ;;
  *)         fail "Unknown target: $TARGET (use api, ml-worker, or all)" ;;
esac

echo ""
success "Deployment complete!"
echo "ALB URL: http://stride-alb-1962699315.us-east-1.elb.amazonaws.com"
