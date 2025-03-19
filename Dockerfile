FROM denoland/deno:2.2.4
WORKDIR /app
USER deno
ADD ./deno.json /app/deno.json
ADD ./deno.lock /app/deno.lock
RUN deno install --lock
ADD . /app
EXPOSE 3000
RUN deno task build
CMD ["deno", "task", "start"]