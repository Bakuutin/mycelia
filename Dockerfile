FROM denoland/deno:2.3.1
WORKDIR /app
USER deno
ADD ./deno.json /app/deno.json
ADD ./deno.lock /app/deno.lock
RUN deno install --lock
ADD . /app
EXPOSE 3000
CMD ["deno", "run", "-A", "--env", "cmd.ts", "serve"]