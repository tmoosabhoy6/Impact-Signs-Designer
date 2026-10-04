# Plaque Proof Studio: one container serving the API and the web app.
FROM node:22-bookworm-slim
# Poppler: reads customer PDF/.ai logos and sketches, and renders proof previews.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080 DATA_DIR=/var/data
EXPOSE 8080
CMD ["npm", "start"]
