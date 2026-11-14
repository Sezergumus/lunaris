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
cd "$(dirname "$0")/.."

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/api"
cp api/Dockerfile "$STAGE/Dockerfile"
cp requirements.txt lunar_terrain.py "$STAGE/"
cp api/__init__.py api/main.py api/requirements.txt api/start.sh "$STAGE/api/"

# Two instances at most and two computations each keep a traffic spike from costing money.
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source "$STAGE" \
  --allow-unauthenticated --memory 2Gi --cpu 2 --concurrency 8 --max-instances 2 --timeout 120 \
  --set-env-vars "LUNAR_TERRAIN_URL=$TERRAIN_URL,LUNAR_TERRAIN_REMOTE_SLOPE=1,LUNARIS_CORS_ORIGINS=${LUNARIS_CORS_ORIGINS:-*}"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)'
