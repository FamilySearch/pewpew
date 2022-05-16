# Modified from https://github.com/emk/rust-musl-builder/blob/a980e27da6c6b629301844637e6139053a49e842/Dockerfile
# Use Ubuntu 18.04 LTS as our base image.
FROM ubuntu:20.04

# for libressl
# ARG OPENSSL_VERSION=3.0.2
ARG OPENSSL_VERSION=1.1.1h

RUN apt-get -qq update && \
    apt-get -qq install -y \
        build-essential \
        curl \
        musl-dev \
        musl-tools \
        gcc-multilib-arm-linux-gnueabihf \
        gcc-arm-linux-gnueabihf \
        gcc-aarch64-linux-gnu \
    && apt-get -qq clean && rm -rf /var/lib/apt/lists/*

RUN ls /usr/include/linux && \
    mkdir -p /usr/local/musl/include && \
    ln -s /usr/include/linux /usr/local/musl/include/linux && \
    ln -s /usr/include/x86_64-linux-gnu/asm /usr/local/musl/include/asm && \
    ln -s /usr/include/asm-generic /usr/local/musl/include/asm-generic && \
    cd /tmp && \
    export URL_VERSION=`echo $OPENSSL_VERSION | tr . _` && \
    curl -L "https://github.com/openssl/openssl/archive/OpenSSL_$URL_VERSION.tar.gz" | \
    tar xzf - --strip-components 1 && \
    env CC=musl-gcc ./Configure no-shared no-zlib -fPIC --prefix=/usr/local/musl -DOPENSSL_NO_SECURE_MEMORY linux-x86_64 && \
    env C_INCLUDE_PATH=/usr/local/musl/include/ make --quiet depend && \
    env C_INCLUDE_PATH=/usr/local/musl/include/ make --quiet && \
    make --quiet install && \
    rm /usr/local/musl/include/linux /usr/local/musl/include/asm /usr/local/musl/include/asm-generic && \
    rm -r /tmp/*

# libressl
# RUN ls /usr/include/linux && \
#     mkdir -p /usr/local/musl/include && \
#     ln -s /usr/include/linux /usr/local/musl/include/linux && \
#     ln -s /usr/include/x86_64-linux-gnu/asm /usr/local/musl/include/asm && \
#     ln -s /usr/include/asm-generic /usr/local/musl/include/asm-generic && \
#     cd /tmp && \
#     curl -sSL "https://ftp.openbsd.org/pub/OpenBSD/LibreSSL/libressl-$OPENSSL_VERSION.tar.gz" | \
#     tar xzf - --strip-components 1 && \
#     env CC=musl-gcc ./configure --disable-shared --with-pic --prefix=/usr/local/musl && \
#     env C_INCLUDE_PATH=/usr/local/musl/include/ make --quiet && \
#     make --quiet install && \
#     rm /usr/local/musl/include/linux /usr/local/musl/include/asm /usr/local/musl/include/asm-generic && \
#     rm -r /tmp/*

ENV OPENSSL_DIR=/usr/local/musl/ \
    OPENSSL_INCLUDE_DIR=/usr/local/musl/include/ \
    DEP_OPENSSL_INCLUDE=/usr/local/musl/include/ \
    OPENSSL_LIB_DIR=/usr/local/musl/lib/ \
    OPENSSL_STATIC=1 \
    TARGET=musl \
    PATH="/root/.cargo/bin:${PATH}" \
    RUSTUP_HOME="/root/.rustup"

RUN curl https://sh.rustup.rs -sSf | \
    sh -s -- -y --profile minimal \
    && rustup target add x86_64-unknown-linux-musl \
    && rustup target add aarch64-unknown-linux-musl \
    && rustup target add armv7-unknown-linux-musleabihf \
    && cargo install cross
