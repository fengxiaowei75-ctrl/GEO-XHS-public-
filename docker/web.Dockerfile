FROM node:22-bookworm-slim

WORKDIR /opt/xhs-sync/web

COPY web/package*.json ./
RUN npm ci

COPY web/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
