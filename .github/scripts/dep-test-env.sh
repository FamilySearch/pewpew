#!/usr/bin/env bash
# Prepares a fresh runner so `npm ci` and the validate commands in
# .github/dependency-update.json can run. Used by both halves of the monthly
# node dependency update: the deterministic workflow and the repair agent's
# pre-agent steps. Mirrors pr-ppaas.yml and pr-guide.yml exactly.
#
# Why this exists: the WebAssembly packages are BUILD OUTPUTS, not committed
# (lib/config-wasm/pkg, controller/lib/hdr-histogram-wasm and
# guide/results-viewer-react/lib/hdr-histogram-wasm are all gitignored), and
# `@fs/config-wasm` is a root workspace member, so the root workspace cannot
# even `npm ci` until they exist. That makes the Rust toolchain a prerequisite
# of the node update, which is not obvious from package.json alone.
#
# Idempotent: rerunning rebuilds the wasm (about a minute) and rewrites the
# same .env. Needs curl, tar and rustup (present on GitHub-hosted runners).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WASM_PACK_VERSION=0.15.0   # pinned to what pr-ppaas.yml / pr-guide.yml install

rustup toolchain install stable --profile minimal --no-self-update
rustup target add wasm32-unknown-unknown --toolchain stable

if ! command -v wasm-pack >/dev/null 2>&1 \
   || [ "$(wasm-pack --version 2>/dev/null | awk '{print $2}')" != "$WASM_PACK_VERSION" ]; then
  mkdir -p "$HOME/bin"
  ARCH=$(uname -m)
  curl -sSL "https://github.com/wasm-bindgen/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-${ARCH}-unknown-linux-musl.tar.gz" \
    | tar -xz --strip-components=1 -C "$HOME/bin" --no-anchored wasm-pack
  export PATH="$HOME/bin:$PATH"
fi
# Later workflow steps run in fresh shells; make ~/bin visible to them too.
[ -z "${GITHUB_PATH:-}" ] || echo "$HOME/bin" >> "$GITHUB_PATH"
wasm-pack --version

# The three builds CI performs before installing. Order does not matter; each
# writes only into its -d target (all gitignored).
(cd lib/hdr-histogram-wasm && wasm-pack build --release -t bundler -d "$ROOT/controller/lib/hdr-histogram-wasm" --scope fs)
(cd lib/hdr-histogram-wasm && wasm-pack build --release -t bundler -d "$ROOT/guide/results-viewer-react/lib/hdr-histogram-wasm" --scope fs)
(cd lib/config-wasm && wasm-pack build --release -t nodejs --scope fs)

# Controller unit tests read these from .env (.env.production overrides .env,
# but NOT .env.local or the environment). Placeholder values, same as CI: the
# unit tests mock AWS and never reach these endpoints.
ENV_FILE=controller/.env
: > "$ENV_FILE"
{
  echo 'PEWPEWCONTROLLER_UNITTESTS_S3_BUCKET_NAME=unit-test-bucket'
  echo 'PEWPEWCONTROLLER_UNITTESTS_S3_BUCKET_URL=https://unit-test-bucket.s3.amazonaws.com'
  echo 'PEWPEWCONTROLLER_UNITTESTS_S3_KEYSPACE_PREFIX=unittests/'
  echo 'PEWPEWCONTROLLER_UNITTESTS_S3_REGION_ENDPOINT=s3-us-east-1.amazonaws.com'
  echo 'APPLICATION_NAME=pewpewcontroller'
  echo 'AGENT_ENV=unittests'
  echo 'AGENT_DESC=c5n.large'
  echo 'PEWPEWAGENT_UNITTESTS_SQS_SCALE_OUT_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/unittests/sqs-scale-out'
  echo 'PEWPEWAGENT_UNITTESTS_SQS_SCALE_IN_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/unittests/sqs-scale-in'
  echo 'PEWPEWCONTROLLER_UNITTESTS_SQS_COMMUNICATION_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/unittests/sqs-communication'
} >> "$ENV_FILE"

echo "dep-test-env: wasm packages built, controller/.env written"
