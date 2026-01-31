FROM node:20-slim

# Install FFmpeg and yt-dlp for video downloading/processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages yt-dlp \
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
