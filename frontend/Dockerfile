FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Node.js inspector を有効にして起動（ポート 9229）
# VSCode から「Next.js: attach to Docker container」でアタッチ可能
CMD ["npm", "run", "dev:debug"]
