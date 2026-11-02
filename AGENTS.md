# gar-my-friend application

This repository owns GarMyFriend face behavior, expression data, animation,
rendering, and application-level GPIO/SPI input and output. Keep the executable
application in `application/`, the portable renderer in `firmware/`, and its
canonical expression data in `shared/`.

The application runs independently of a WebPanel or Bridge. Do not import
Product simulation servers or put expression selection in a hardware bridge.
The historical `preview/` is an optional face-design tool, not the Product panel.

Physical wiring, part numbers, GPIO line assignments, SPI bus/speed, deployment,
and simulator composition belong to a Product such as
`GarMyFriend-OrangePiZero2W`. Read its GPIO/SPI CSV files through
`GAR_HARDWARE_DIR`; do not add board-specific defaults or parallel pin JSON.

The Product supplies its pinned gar-tools checkout through `GAR_TOOLS_ROOT`
when building, `GAR_BUILD_DIR` for build output, and `GAR_BIN_DIR` at runtime.
Keep generic hardware decoding and reusable drivers in gar-tools.

Optional face/body/speech coordination belongs in application/. Reuse the pinned `dependencies/gar-servo-pet` native controller without removing its guards. Product CSVs select outputs and calibration; missing effects.csv must remain face-only. Speech synthesis uses piped text and argument arrays, never shell execution. Voice/dictionary files are external.
