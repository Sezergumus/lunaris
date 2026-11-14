# Terrain service image. Build from the repository root:
#   docker build -f api/Dockerfile -t lunaris-api .
#   docker run -p 7860:7860 -v "$PWD/data/lola:/data/lola" lunaris-api
# Without a mounted volume, set LUNARIS_TERRAIN_URLS so the files are fetched at start.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
COPY api/requirements.txt api/
RUN pip install --no-cache-dir -r api/requirements.txt
COPY lunar_terrain.py ./
COPY api/ api/
ENV LUNAR_TERRAIN_DIR=/data/lola PORT=7860
EXPOSE 7860
CMD ["api/start.sh"]
