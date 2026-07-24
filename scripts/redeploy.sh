#!/bin/bash
# Redeploy script — scales ECS services back to their normal desired counts.
# Use after undeploy.sh to bring services back online.
# Usage: ./scripts/redeploy.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${STRIDE_ENV:-production}"
CLUSTER="${STRIDE_CLUSTER:-stride-cluster-${ENVIRONMENT}}"
API_SERVICE="${STRIDE_API_SERVICE:-stride-api-${ENVIRONMENT}}"
ML_WORKER_SERVICE="${STRIDE_ML_WORKER_SERVICE:-stride-ml-worker-${ENVIRONMENT}}"
API_COUNT="${STRIDE_API_COUNT:-2}"   # PRD minimum: 2 API tasks
ML_WORKER_COUNT="${STRIDE_ML_WORKER_COUNT:-1}"

log() { echo -e "\n\033[1;34m▶ $1\033[0m"; }
success() { echo -e "\033[1;32m✔ $1\033[0m"; }
fail() { echo -e "\033[1;31m✖ $1\033[0m"; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"

log "Scaling API service to ${API_COUNT}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$API_SERVICE" \
  --desired-count "$API_COUNT" \
  --region "$REGION" \
  --no-cli-pager >/dev/null

log "Scaling ML worker service to ${ML_WORKER_COUNT}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$ML_WORKER_SERVICE" \
  --desired-count "$ML_WORKER_COUNT" \
  --region "$REGION" \
  --no-cli-pager >/dev/null

echo ""
success "Services are scaling back up."
echo "It may take 1-2 minutes for tasks to reach RUNNING state."
