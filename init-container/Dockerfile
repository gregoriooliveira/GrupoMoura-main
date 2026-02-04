FROM node:18.20.8 

WORKDIR /instrumentation

RUN npm install @opentelemetry/auto-instrumentations-node

# Copia o pacote para um path que será montado
CMD ["cp", "-r", "/instrumentation/node_modules", "/shared-instrumentation/"]