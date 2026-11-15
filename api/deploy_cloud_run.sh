#!/bin/sh
# Publish the terrain service to Google Cloud Run.
#
#   api/deploy_cloud_run.sh <project-id> [<region>] [<service>]
#
# Needs `gcloud auth login` first. The container carries no terrain files: the service
# reads them by range requests from LUNAR_TERRAIN_URL (default below: a public Cloud
# Storage bucket in the same region holding LDEM_60S_60MPP_ADJ.TIF and
# LDSM_60S_60MPP_ADJ.TIF; https://huggingface.co/datasets/KeremGull/lunaris-lola is a mirror). Cloud Build builds api/Dockerfile from a staging
# directory that holds only what the image needs.
set -e
PROJECT="$1"
REGION="${2:-europe-west1}"
SERVICE="${3:-lunaris-terrain}"
[ -n "$PROJECT" ] || { echo "usage: $0 <project-id> [<region>] [<service>]"; exit 1; }
TERRAIN_URL="${LUNAR_TERRAIN_URL:-https://storage.googleapis.com/lunaris-lola-601609650151}"
MAX_JOBS="${LUNARIS_MAX_JOBS:-2}"
cd "$(dirname "$0")/.."

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/api"
cp api/Dockerfile "$STAGE/Dockerfile"
cp requirements.txt lunar_terrain.py "$STAGE/"
cp api/__init__.py api/main.py api/requirements.txt api/start.sh "$STAGE/api/"

# Five instances at most (ten computations at once) keep a traffic spike from costing much.
# Cloud Run's request concurrency must equal the service's own job limit (LUNARIS_MAX_JOBS):
# with a higher value Cloud Run hands one instance requests it can only refuse with 429, and
# it starts the second instance only when the first is near that higher value. With equal
# values a third request goes to another instance, and beyond that Cloud Run queues it.
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source "$STAGE" \
  --allow-unauthenticated --memory 2Gi --cpu 2 --concurrency "$MAX_JOBS" --max-instances 5 --timeout 120 \
  --set-env-vars "LUNAR_TERRAIN_URL=$TERRAIN_URL,LUNAR_TERRAIN_REMOTE_SLOPE=1,LUNARIS_MAX_JOBS=$MAX_JOBS,LUNARIS_CORS_ORIGINS=${LUNARIS_CORS_ORIGINS:-*}"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)'
