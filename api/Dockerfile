# Terrain service image. Build from the repository root:
#   docker build -f api/Dockerfile -t lunaris-api .
#   docker run -p 7860:7860 -v "$PWD/data/lola:/data/lola" lunaris-api
# Without a mounted volume, set LUNARIS_TERRAIN_URLS so the files are fetched at start.
# api/deploy_cloud_run.sh publishes it to Google Cloud Run with LUNAR_TERRAIN_URL instead.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl libexpat1 && rm -rf /var/lib/apt/lists/*
# libexpat1: needed by the GDAL inside the rasterio wheel, absent from the slim image.
# Runs as an ordinary user; the terrain directory must be writable for start.sh.
RUN useradd -m -u 1000 user && mkdir -p /data/lola /app && chown -R user:user /data/lola /app
WORKDIR /app
COPY --chown=user requirements.txt ./
COPY --chown=user api/requirements.txt api/
RUN pip install --no-cache-dir -r api/requirements.txt
COPY --chown=user lunar_terrain.py ./
COPY --chown=user api/ api/
USER user
ENV LUNAR_TERRAIN_DIR=/data/lola PORT=7860
EXPOSE 7860
CMD ["sh", "api/start.sh"]
