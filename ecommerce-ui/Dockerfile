FROM node:14

WORKDIR /app

COPY server /app/server

WORKDIR /app/server

RUN npm install


WORKDIR /app

COPY client /app/client

WORKDIR /app/client

RUN npm install

RUN npm run build


WORKDIR /app/server

EXPOSE 4000

CMD ["node", "server.js"]