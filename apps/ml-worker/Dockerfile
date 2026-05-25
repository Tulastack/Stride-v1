FROM tensorflow/tensorflow:2.19.0-gpu
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
RUN python -c "import tensorflow_hub as hub; hub.load('https://tfhub.dev/google/movenet/singlepose/thunder/4')"
COPY src/ ./src/
CMD ["python", "-u", "src/worker.py"]
