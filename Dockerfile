FROM oven/bun:1-alpine

# Hugging Face Spaces requires a non-root user with UID 1000. The base image
# already assigns it (to `bun`), so only create one when the id is free.
RUN if ! getent passwd 1000 >/dev/null 2>&1; then adduser -u 1000 -D -h /home/user user; fi \
    && mkdir -p /home/user/app /home/user/app/data \
    && chown -R 1000:1000 /home/user

WORKDIR /home/user/app

# Copy package manifests and install dependencies
COPY --chown=1000:1000 package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application files
COPY --chown=1000:1000 . .

USER 1000

ENV HOST=0.0.0.0 \
    PORT=7860 \
    ANALYST_STORAGE=/home/user/app/data/agent_analyst.sqlite \
    HOME=/home/user

EXPOSE 7860

CMD ["bun", "run", "src/backend/api/server.ts"]
