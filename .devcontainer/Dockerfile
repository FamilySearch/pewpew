FROM rust:1.52

# versions (according to their git tag) of different tools to download
# https://github.com/EmbarkStudios/cargo-deny/releases
ARG CARGO_DENY_VER=0.12.1
# https://github.com/rust-lang/mdBook/releases
ARG MDBOOK_VER=v0.4.20
# https://github.com/rustwasm/wasm-pack/releases
ARG WASM_PACK_VER=v0.11.0
# https://nodejs.org/
ARG NODE_MAJOR_VER=16

ARG USER=pewpew

# create the user
RUN useradd -m -s /bin/bash -r -U $USER
USER $USER
WORKDIR /home/$USER

# install rustfmt and clippy
RUN rustup component add rustfmt clippy

# install cargo-deny
RUN curl -sSL https://github.com/EmbarkStudios/cargo-deny/releases/download/$CARGO_DENY_VER/cargo-deny-$CARGO_DENY_VER-x86_64-unknown-linux-musl.tar.gz \
    | tar -xz --strip-components=1 -C $CARGO_HOME/bin --no-anchored cargo-deny

# install mdbook
RUN curl -sSL https://github.com/rust-lang/mdBook/releases/download/$MDBOOK_VER/mdbook-$MDBOOK_VER-x86_64-unknown-linux-gnu.tar.gz \
    | tar -xz -C $CARGO_HOME/bin

# install wasm-pack
RUN curl -sSL https://github.com/rustwasm/wasm-pack/releases/download/$WASM_PACK_VER/wasm-pack-$WASM_PACK_VER-x86_64-unknown-linux-musl.tar.gz \
    | tar -xz --strip-components=1 -C $CARGO_HOME/bin --no-anchored wasm-pack

# install node
RUN mkdir .node \
    && SHALINE=$(curl -sSL https://nodejs.org/download/release/latest-v$NODE_MAJOR_VER.x/SHASUMS256.txt \
        | grep "linux-x64.tar.xz") \
    && FILENAME=$(echo $SHALINE | cut -d ' ' -f2) \
    && curl -sSL https://nodejs.org/download/release/latest-v$NODE_MAJOR_VER.x/$FILENAME > $FILENAME \
    && echo "$SHALINE\n" | shasum -sc - \
    && tar -xJf $FILENAME --strip-components=1 -C .node/ \
    && rm $FILENAME \
    && find .node \
        -not -wholename '.node' \
        -not -wholename '.node/bin*' \
        -not -wholename '.node/lib*' -delete

ENV PATH=$PATH:/home/$USER/.node/bin
# ENV GIT_EDITOR="code --wait"
# ENV GIT_EXTERNAL_DIFF='code --wait --diff $LOCAL $REMOTE'

RUN git config --global core.editor "code --wait" \
    && git config --global diff.tool vscode \
    && git config --global difftool.vscode.cmd 'code --wait --diff $LOCAL $REMOTE' \
    && git config --global merge.tool vscode \
    && git config --global mergetool.vscode.cmd 'code --wait $MERGED'