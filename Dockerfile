FROM node:23
WORKDIR /app
ADD ./package.json /app/package.json
ADD ./package-lock.json /app/package-lock.json
RUN npm install
ADD . /app
EXPOSE 3000
ENV NODE_ENV=production
RUN npm run build
CMD ["npm", "run", "start"]