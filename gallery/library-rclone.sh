#!/bin/bash
# rclone against the library bucket's S3 endpoint, as the remote "r2library", with a scoped token in
# ~/.config/dinodreamer/r2-library.env (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: Object Read & Write on
# dinodreamer-library only). The keys go into rclone's environment only; nothing is printed or written to
# rclone.conf.
#   gallery/library-rclone.sh size r2library:dinodreamer-library/<prefix>/
set -euo pipefail
set -a; . "$HOME/.config/dinodreamer/r2-library.env"; set +a
export RCLONE_CONFIG_R2LIBRARY_TYPE=s3 RCLONE_CONFIG_R2LIBRARY_PROVIDER=Cloudflare RCLONE_CONFIG_R2LIBRARY_REGION=auto \
  RCLONE_CONFIG_R2LIBRARY_ENDPOINT=https://ca9d38a784a1dbc033775ecfd6551682.r2.cloudflarestorage.com \
  RCLONE_CONFIG_R2LIBRARY_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_R2LIBRARY_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2LIBRARY_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
exec rclone "$@"
