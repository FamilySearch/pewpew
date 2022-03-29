#!/bin/bash
set -e
set -x

printusage() {
  if ! [[ -z "$1" ]] ; then
    echo "$@"
  fi
  echo Usage:
  echo "    $0 <v0.5.X>[-previewX]"
  exit 1
}

if [[ -z "$1" ]] ; then
  printusage Must provide a tag version
fi


echo git tag -d "$1"
echo git push --delete origin "$1"

git tag -a "$1" -m "$1

${@:2}"

git push origin "$1"
