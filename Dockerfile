FROM node:alpine


WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
# If you are building your code for production
# RUN npm ci --omit=dev

RUN mkdir -p /hubs/admin/ && cd /hubs
COPY package.json ./
COPY package-lock.json ./
RUN npm ci
COPY admin/package.json admin/
COPY admin/package-lock.json admin/
RUN cd admin && npm ci --legacy-peer-deps && cd ..

COPY . .


EXPOSE 8080



CMD ["npm", "run", "local"]
