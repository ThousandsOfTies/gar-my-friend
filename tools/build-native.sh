#!/bin/sh
# The Product supplies shared tools and chooses the compiler/output directory.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
: "$GAR_TOOLS_ROOT"
: "$GAR_BUILD_DIR"
RUNTIME="$GAR_TOOLS_ROOT/targets/linux-device/runtime"
OUTPUT="$GAR_BUILD_DIR"
mkdir -p "$OUTPUT"
CC=${CC:-gcc}
CXX=${CXX:-g++}
"$CXX" -std=c++11 -Wall -Wextra -Werror -O2 -I "$RUNTIME" "$ROOT/application/device-output.cpp" -o "$OUTPUT/device-output"
"$CC" -std=c11 -Wall -Wextra -Werror -O2 "$RUNTIME/rotary-input/rotary_input.c" -o "$OUTPUT/gar_rotary_input"
if [ "${GAR_BUILD_SERVO:-0}" = 1 ]; then
  SERVO="$ROOT/dependencies/gar-servo-pet"
  test -f "$SERVO/src/main.c" || { echo 'Initialize recursive application submodules' >&2; exit 1; }
  "$CC" -std=c11 -D_POSIX_C_SOURCE=200809L -Wall -Wextra -Werror -Wpedantic -O2 \
    -I "$SERVO/src" "$SERVO/src/main.c" "$SERVO/src/config.c" "$SERVO/src/motion.c" "$SERVO/src/pca9685.c" \
    -o "$OUTPUT/gar-servoctl"
fi
