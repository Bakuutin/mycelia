FROM denoland/deno:2.5.6
EXPOSE 5173
WORKDIR /app
ENV NODE_ENV=production
COPY ./backend/deno.lock /app/deno.lock
COPY ./backend/deno.json /app/deno.json
RUN DENO_FUTURE=1 deno install --lock=deno.lock
COPY ./interfaces /interfaces
COPY ./backend . /app/
CMD ["deno", "run", "-A", "server.ts", "serve", "--prod"]
