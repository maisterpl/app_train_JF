# syntax=docker/dockerfile:1
# Archiwalny serwer Django, zachowany do migracji danych.
# Aktualna lokalna PWA: publikuj wyłącznie web/ (bez kontenera).
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=pip_ca \
    if [ -f /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi; \
    python -m pip install --no-cache-dir -r requirements.txt
RUN useradd --uid 1000 --create-home app && mkdir -p /var/data && chown app:app /var/data
COPY --chown=app:app . .
RUN python manage.py collectstatic --noinput
USER app
EXPOSE 8000
CMD ["sh", "deploy/start.sh"]
