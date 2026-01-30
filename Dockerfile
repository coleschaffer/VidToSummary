FROM node:20-slim

# Install FFmpeg for video trimming
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create uploads and temp directories
RUN mkdir -p uploads temp

EXPOSE 3000

CMD ["node", "server.js"]
