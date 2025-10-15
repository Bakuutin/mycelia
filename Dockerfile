FROM denoland/deno:2.3.7
EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production
COPY . /app
RUN chown -R deno:deno /app
USER deno
RUN deno cache server.ts --lock=deno.lock
RUN deno run -A npm:@remix-run/dev vite:build
CMD ["deno", "run", "-A", "server.ts", "serve", "--prod"]
