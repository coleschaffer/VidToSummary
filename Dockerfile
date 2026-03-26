FROM node:20-slim

# Install FFmpeg, yt-dlp, and deno (JavaScript runtime for yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:${PATH}"

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
