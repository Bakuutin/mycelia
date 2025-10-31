FROM denoland/deno:2.5.6
EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production
COPY deno.lock /app/deno.lock
COPY deno.json /app/deno.json
RUN DENO_FUTURE=1 deno install --lock=deno.lock
COPY . /app
RUN deno run -A npm:@remix-run/dev vite:build
CMD ["deno", "run", "-A", "server.ts", "serve", "--prod"]
