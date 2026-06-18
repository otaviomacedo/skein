FROM public.ecr.aws/docker/library/node:20-slim
WORKDIR /app
COPY product-service.ts .
RUN npx esbuild product-service.ts --bundle --platform=node --target=node20 --outfile=index.js --format=cjs --external:@aws-sdk/*
RUN npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
EXPOSE 80
CMD ["node", "index.js"]
