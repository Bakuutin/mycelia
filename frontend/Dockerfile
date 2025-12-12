# ---------- Builder (Deno) ----------
FROM denoland/deno:2.5.6 AS builder

ENV DENO_DIR=/deno-dir
ENV NODE_ENV=production

WORKDIR /app

# Copy lockfiles and config first for better caching
COPY ./frontend/deno.json ./frontend/deno.lock ./frontend/package.json ./frontend/package-lock.json ./

# Pre-resolve npm packages Vite needs into node_modules via Deno
RUN deno cache --node-modules-dir --lock=deno.lock --reload npm:vite

# Copy the rest of the source
COPY ./frontend .
COPY ./interfaces ../interfaces
# Build static assets using Deno task (runs: deno run -A npm:vite build)
RUN deno task build

# ---------- Runtime (Nginx) ----------
FROM nginx:1.27-alpine AS runtime

USER root
RUN adduser -D -H -u 10001 appuser \
  && mkdir -p /var/cache/nginx \
  && chown -R appuser:appuser /var/cache/nginx /var/run /var/log/nginx

COPY --from=builder /app/dist /usr/share/nginx/html
COPY ./frontend/nginx.conf /etc/nginx/nginx.conf

USER appuser
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
