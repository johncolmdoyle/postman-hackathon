# Define custom function directory
ARG FUNCTION_DIR="/function"

FROM node:12-buster as build-image

ARG FUNCTION_DIR

# Install aws-lambda-cpp build dependencies
RUN apt-get update && \
    apt-get install -y \
    g++ \
    make \
    cmake \
    unzip \
    libcurl4-openssl-dev \
    traceroute

RUN mkdir -p ${FUNCTION_DIR}

WORKDIR ${FUNCTION_DIR}
COPY src/package.json ${FUNCTION_DIR}
RUN npm install aws-lambda-ric
RUN npm install
COPY src/* ${FUNCTION_DIR}

ENTRYPOINT ["/usr/local/bin/npx", "aws-lambda-ric"]
CMD ["app.handler"]

#ENTRYPOINT ["node"]
#CMD ["app.js"]
