FROM denoland/deno:2.6.3

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

EXPOSE 5173
WORKDIR /app

# Store Deno cache outside /app so it survives volume mounts (enables offline operation)
ENV DENO_DIR=/deno-dir
ENV NODE_ENV=production

# Copy config files for dependency caching
COPY ./backend/deno.lock /app/deno.lock
COPY ./backend/deno.json /app/deno.json
COPY ./backend/package.json /app/package.json

# Install and cache all dependencies (both JSR and npm packages)
RUN DENO_FUTURE=1 deno install --lock=deno.lock --node-modules-dir=false

# Copy source files
COPY ./myceliasdk /myceliasdk
COPY ./backend . /app/

# Pre-cache all imports from the main entry point to ensure everything is available offline
RUN deno cache --lock=deno.lock server.ts

CMD ["deno", "run", "-A", "server.ts", "serve", "--prod"]
