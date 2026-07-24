#!/bin/bash
# Undeploy script — scales ECS services to 0 (stops all running tasks).
# Infrastructure stays intact. Use redeploy.sh to bring services back up.
# Usage: ./scripts/undeploy.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${STRIDE_ENV:-production}"
CLUSTER="${STRIDE_CLUSTER:-stride-cluster-${ENVIRONMENT}}"
API_SERVICE="${STRIDE_API_SERVICE:-stride-api-${ENVIRONMENT}}"
ML_WORKER_SERVICE="${STRIDE_ML_WORKER_SERVICE:-stride-ml-worker-${ENVIRONMENT}}"

log() { echo -e "\n\033[1;34m▶ $1\033[0m"; }
success() { echo -e "\033[1;32m✔ $1\033[0m"; }
fail() { echo -e "\033[1;31m✖ $1\033[0m"; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"

log "Scaling API service to 0..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$API_SERVICE" \
  --desired-count 0 \
  --region "$REGION" \
  --no-cli-pager >/dev/null

log "Scaling ML worker service to 0..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$ML_WORKER_SERVICE" \
  --desired-count 0 \
  --region "$REGION" \
  --no-cli-pager >/dev/null

echo ""
success "All services scaled to 0. No tasks are running."
echo "Run ./scripts/redeploy.sh to bring them back up."
