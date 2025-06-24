FROM denoland/deno:2.3.6
WORKDIR /app
ADD . /app
RUN deno cache cmd.ts --lock=deno.lock
USER deno
EXPOSE 3000
CMD ["deno", "run", "-A", "cmd.ts", "serve"]