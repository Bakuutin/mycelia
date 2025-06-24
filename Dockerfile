FROM denoland/deno:2.3.6
EXPOSE 5173
WORKDIR /app
COPY . /app
RUN chown -R deno:deno /app
USER deno
RUN deno cache cmd.ts --lock=deno.lock
CMD ["deno", "run", "-A", "cmd.ts", "serve", "--prod"]