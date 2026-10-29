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
