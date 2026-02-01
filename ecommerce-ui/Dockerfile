FROM node:20-alpine AS client-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci --legacy-peer-deps

COPY client ./
RUN npm run build


FROM node:20-alpine AS server-deps
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev


FROM node:20-alpine
WORKDIR /app

COPY server /app/server

COPY --from=server-deps /app/server/node_modules /app/server/node_modules

COPY --from=client-build /app/client/build /app/client/build

ENV NODE_ENV=production
EXPOSE 4000

WORKDIR /app/server
CMD ["node", "server.js"]