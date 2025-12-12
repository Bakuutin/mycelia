FROM denoland/deno:alpine

WORKDIR /app
ENV NODE_ENV=production

# For healthchecks
RUN apk add --no-cache curl

COPY deno.lock /app/deno.lock
COPY deno.json /app/deno.json
RUN DENO_FUTURE=1 deno install --lock=deno.lock

COPY . /app

# Allow sourcing generated credentials (MYCELIA_TOKEN / MYCELIA_CLIENT_ID)
RUN chmod +x /app/docker/entrypoint.sh

EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=10 \
  CMD curl -fsS "http://127.0.0.1:5173/health" >/dev/null || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["deno", "run", "-A", "server.ts", "serve", "--prod"]
