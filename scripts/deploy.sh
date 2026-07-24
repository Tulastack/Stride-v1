#!/bin/bash
# Deploy script — builds images, pushes to ECR, and updates ECS services.
# Usage: ./scripts/deploy.sh [api|ml-worker|all]
#   api        — deploy only the API service
#   ml-worker  — deploy only the ML worker service
#   all        — deploy both (default)
#
# Cluster/service names match infra/terraform (stride-cluster-<env> etc.).
# Override via env vars for a non-terraform environment:
#   STRIDE_ENV, STRIDE_CLUSTER, STRIDE_API_SERVICE, STRIDE_ML_WORKER_SERVICE

set -e

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="${AWS_ACCOUNT_ID:-442004016139}"
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ENVIRONMENT="${STRIDE_ENV:-production}"
CLUSTER="${STRIDE_CLUSTER:-stride-cluster-${ENVIRONMENT}}"
API_SERVICE="${STRIDE_API_SERVICE:-stride-api-${ENVIRONMENT}}"
ML_WORKER_SERVICE="${STRIDE_ML_WORKER_SERVICE:-stride-ml-worker-${ENVIRONMENT}}"
TARGET="${1:-all}"

# Repo root — Docker build contexts MUST be the repo root: the API image copies
# turbo.json + packages/* (monorepo workspaces), which don't exist under apps/.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

update_service() {
  local service="$1"
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$service" \
    --force-new-deployment \
    --region "$REGION" \
    --no-cli-pager >/dev/null
}

deploy_api() {
  log "Building API image (linux/amd64)..."
  docker build --platform linux/amd64 \
    -f "${REPO_ROOT}/apps/api/Dockerfile" \
    -t "${ECR_BASE}/stride:api-latest" \
    "${REPO_ROOT}"

  log "Pushing API image to ECR..."
  docker push "${ECR_BASE}/stride:api-latest"

  log "Updating ECS API service (${CLUSTER}/${API_SERVICE})..."
  update_service "$API_SERVICE"

  success "API deployed"
}

deploy_ml_worker() {
  log "Building ML worker image (linux/amd64)..."
  docker build --platform linux/amd64 \
    -f "${REPO_ROOT}/apps/ml-worker/Dockerfile" \
    -t "${ECR_BASE}/stride:ml-worker-latest" \
    "${REPO_ROOT}/apps/ml-worker"

  log "Pushing ML worker image to ECR..."
  docker push "${ECR_BASE}/stride:ml-worker-latest"

  log "Updating ECS ML worker service (${CLUSTER}/${ML_WORKER_SERVICE})..."
  update_service "$ML_WORKER_SERVICE"

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
echo "ALB URL: $(aws elbv2 describe-load-balancers --names "stride-api-alb-${ENVIRONMENT}" \
  --query 'LoadBalancers[0].DNSName' --output text --region "$REGION" 2>/dev/null || echo '<run terraform output>')"
