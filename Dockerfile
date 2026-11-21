FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN NODE_OPTIONS=--max-old-space-size=256 npm ci
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=256 npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN NODE_OPTIONS=--max-old-space-size=256 npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "start"]
