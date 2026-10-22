FROM oven/bun:1.2-alpine

# Hugging Face Spaces requires a non-root user with UID 1000
RUN adduser -u 1000 -D -h /home/user user

WORKDIR /home/user/app

# Copy package manifests and install dependencies
COPY --chown=user:user package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application files
COPY --chown=user:user . .

# Ensure storage directory for SQLite exists and has write permissions
RUN mkdir -p /home/user/app/data && chown -R user:user /home/user/app/data

USER 1000

ENV HOST=0.0.0.0 \
    PORT=7860 \
    ANALYST_STORAGE=/home/user/app/data/agent_analyst.sqlite \
    HOME=/home/user

EXPOSE 7860

CMD ["bun", "run", "src/prototype/server.ts"]
