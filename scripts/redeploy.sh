#!/bin/bash
# Redeploy script — scales ECS services back to their normal desired counts.
# Use after undeploy.sh to bring services back online.
# Usage: ./scripts/redeploy.sh

set -e

REGION="us-east-1"
CLUSTER="default"
API_SERVICE="stride-api"
FRONTEND_SERVICE="stride-frontend"
API_COUNT=1
FRONTEND_COUNT=1

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
  --no-cli-pager

log "Scaling frontend service to ${FRONTEND_COUNT}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$FRONTEND_SERVICE" \
  --desired-count "$FRONTEND_COUNT" \
  --region "$REGION" \
  --no-cli-pager

echo ""
success "Services are scaling back up."
echo "It may take 1-2 minutes for tasks to reach RUNNING state."
echo "ALB URL: http://stride-alb-1962699315.us-east-1.elb.amazonaws.com"
