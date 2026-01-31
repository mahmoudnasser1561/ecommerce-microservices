FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY auth_api.js ./

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003
CMD ["node", "auth_api.js"]
