FROM python:3.11-slim
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
# worker.py imports its siblings as `src.*`; running `python src/worker.py` puts
# /app/src (not /app) on sys.path, so /app must be added explicitly or the
# container dies at startup with "No module named 'src'". docker-compose sets
# the same value, which is why this only failed on ECS.
ENV PYTHONPATH=/app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
# Unprivileged runtime user; model weights cache under $HOME/.cache
RUN useradd -m worker && chown -R worker:worker /app
USER worker
CMD ["python", "-u", "src/worker.py"]
