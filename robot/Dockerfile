FROM node:18.20.8 

WORKDIR /app

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm \
    npm install

COPY server.js ./server.js

EXPOSE 3000

CMD ["npm", "start"]
