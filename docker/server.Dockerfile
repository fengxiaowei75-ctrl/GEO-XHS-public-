FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /opt/xhs-sync

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY server/ /opt/xhs-sync/server/

CMD [
    "python",
    "/opt/xhs-sync/server/scripts/GEO/watch_geo_note_ingest_queue.py",
    "--watch",
    "--enqueue-existing",
    "--poll-interval",
    "30",
    "--batch-size",
    "1",
    "--job-timeout",
    "1200",
    "--child-timeout",
    "180",
    "--child-retries",
    "1",
    "--detail-concurrency",
    "4",
    "--image-concurrency",
    "4"
]
