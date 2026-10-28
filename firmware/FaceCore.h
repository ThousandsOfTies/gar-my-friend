#ifndef ROBOFACE_FACE_CORE_H
#define ROBOFACE_FACE_CORE_H

#include <cmath>
#include <cstdint>

// Hardware-independent C++11 face geometry. Coordinates are in a 240 x 240
// square; the caller clears the background and transfers its frame to a display.
// A Surface implements float-coordinate primitives with RGB565 colors:
//   fillEllipse(cx, cy, rx, ry, color)
//   fillTriangle(x1, y1, x2, y2, x3, y3, color)
//   line(x1, y1, x2, y2, width, color)
// line() should use round caps. Clip/round to integer pixels in the adapter.
namespace roboface {

struct Pose {
    float eyeRx, eyeRy, eyeY;
    float leftOpen, rightOpen, happyEye, tilt;
    float mouthY, mouthW, mouthCurve, mouthOpen, cheek;
};

enum Expression {
    Neutral, Happy, Sad, Angry, Surprised, Blank, Sleepy, Wink,
    ExpressionCount
};

// Generated from ../shared/expressions.json. Regenerate with
// python shared/generate_presets.py after changing the shared poses.
#include "FacePresets.inc"

inline float clamp(float value, float low, float high) {
    return value < low ? low : (value > high ? high : value);
}

inline float mix(float a, float b, float t) { return a + (b - a) * t; }

inline Pose interpolate(const Pose& a, const Pose& b, float t) {
    t = clamp(t, 0.0f, 1.0f);
    Pose p;
#define ROBOFACE_MIX(field) p.field = mix(a.field, b.field, t)
    ROBOFACE_MIX(eyeRx); ROBOFACE_MIX(eyeRy); ROBOFACE_MIX(eyeY);
    ROBOFACE_MIX(leftOpen); ROBOFACE_MIX(rightOpen); ROBOFACE_MIX(happyEye);
    ROBOFACE_MIX(tilt); ROBOFACE_MIX(mouthY); ROBOFACE_MIX(mouthW);
    ROBOFACE_MIX(mouthCurve); ROBOFACE_MIX(mouthOpen); ROBOFACE_MIX(cheek);
#undef ROBOFACE_MIX
    return p;
}

inline const Pose& preset(Expression expression) {
    const unsigned index = static_cast<unsigned>(expression);
    return kPresets[index < ExpressionCount ? index : 0];
}

class Transition {
public:
    explicit Transition(const Pose& initial = preset(Neutral))
        : from_(initial), to_(initial), started_(0), duration_(0) {}

    Pose sample(std::uint32_t nowMs) const {
        // Unsigned elapsed arithmetic supports a wrapping millisecond clock.
        const std::uint32_t elapsed = nowMs - started_;
        if (!duration_ || elapsed >= duration_) return to_;
        const float t = static_cast<float>(elapsed) / duration_;
        return interpolate(from_, to_, t * t * (3.0f - 2.0f * t));
    }

    void setTarget(const Pose& target, std::uint32_t nowMs,
                   std::uint32_t durationMs = 450) {
        // Sample first: an interrupted transition continues without a jump.
        from_ = sample(nowMs);
        to_ = target;
        started_ = nowMs;
        duration_ = durationMs;
    }

private:
    Pose from_, to_;
    std::uint32_t started_, duration_;
};

struct Effects {
    float gazeX, gazeY, blink, talkOpen;
    Effects() : gazeX(0), gazeY(0), blink(1), talkOpen(0) {}
};

struct Palette {
    std::uint32_t background, ink, cheek; // 0xRRGGBB
    Palette() : background(kBackgroundRgb), ink(kInkRgb), cheek(kCheekRgb) {}
};

inline std::uint16_t rgb565(std::uint32_t rgb) {
    return static_cast<std::uint16_t>(
        ((rgb >> 8) & 0xf800) | ((rgb >> 5) & 0x07e0) | ((rgb >> 3) & 0x001f));
}

inline std::uint32_t blendRgb(std::uint32_t a, std::uint32_t b, float t) {
    t = clamp(t, 0.0f, 1.0f);
    std::uint32_t result = 0;
    for (unsigned shift = 0; shift <= 16; shift += 8) {
        const float channel = mix(static_cast<float>((a >> shift) & 255),
                                  static_cast<float>((b >> shift) & 255), t);
        result |= static_cast<std::uint32_t>(channel + 0.5f) << shift;
    }
    return result;
}

namespace detail {
const int Segments = 24;

inline float edge(float u) {
    const float n = 1.0f - u * u;
    return std::sqrt(n > 0.0f ? n : 0.0f);
}

template<class Surface>
void eye(Surface& surface, const Pose& p, const Effects& e, float cx,
         float side, float openness, std::uint16_t color) {
    const float blink = clamp(e.blink, 0.0f, 1.0f);
    const float originalHappy = clamp(p.happyEye, 0.0f, 1.0f);
    const float happy = originalHappy * blink;
    const float open = clamp(openness, 0.0f, 1.0f) * blink;
    const float rx = clamp(p.eyeRx, 1.0f, 24.0f);
    const float height = clamp(p.eyeRy, 0.0f, 30.0f) * open * (1.0f - originalHappy)
                         + 1.5f * originalHappy;
    const float half = height < 1.5f ? 1.5f : height;
    cx += clamp(e.gazeX, -8.0f, 8.0f);
    const float cy = p.eyeY + clamp(e.gazeY, -8.0f, 8.0f);
    float previousX = 0, previousTop = 0, previousBottom = 0;
    for (int i = 0; i <= Segments; ++i) {
        const float u = -1.0f + 2.0f * i / Segments;
        const float x = cx + rx * u;
        const float middle = cy - happy * 8.0f * (1.0f - u * u) + p.tilt * side * u;
        const float top = middle - half * edge(u);
        const float bottom = middle + half * edge(u);
        if (i) {
            surface.fillTriangle(previousX, previousTop, x, top, x, bottom, color);
            surface.fillTriangle(previousX, previousTop, x, bottom,
                                 previousX, previousBottom, color);
        }
        previousX = x; previousTop = top; previousBottom = bottom;
    }
}

template<class Surface>
void mouth(Surface& surface, const Pose& p, const Effects& e, std::uint16_t color) {
    const float halfWidth = clamp(p.mouthW, 1.0f, 70.0f) * 0.5f;
    const float opening = clamp(p.mouthOpen + e.talkOpen, 0.0f, 38.0f);
    float previousX = 0, previousTop = 0, previousBottom = 0;
    for (int i = 0; i <= Segments; ++i) {
        const float u = -1.0f + 2.0f * i / Segments;
        const float x = 120.0f + halfWidth * u;
        const float middle = p.mouthY + p.mouthCurve * (1.0f - u * u);
        const float top = middle - opening * 0.5f * edge(u);
        const float bottom = middle + opening * 0.5f * edge(u);
        if (i) {
            if (opening > 0) {
                surface.fillTriangle(previousX, previousTop, x, top, x, bottom, color);
                surface.fillTriangle(previousX, previousTop, x, bottom,
                                     previousX, previousBottom, color);
                surface.line(previousX, previousBottom, x, bottom, 3.0f, color);
            }
            surface.line(previousX, previousTop, x, top, 3.0f, color);
        }
        previousX = x; previousTop = top; previousBottom = bottom;
    }
}
} // namespace detail

template<class Surface>
void render(Surface& surface, const Pose& pose, const Effects& effects = Effects(),
            const Palette& palette = Palette()) {
    const std::uint16_t ink = rgb565(palette.ink);
    const std::uint16_t blush = rgb565(blendRgb(palette.background, palette.cheek, pose.cheek));
    surface.fillEllipse(53.0f, 131.0f, 13.0f, 8.0f, blush);
    surface.fillEllipse(187.0f, 131.0f, 13.0f, 8.0f, blush);
    detail::eye(surface, pose, effects, 78.0f, 1.0f, pose.leftOpen, ink);
    detail::eye(surface, pose, effects, 162.0f, -1.0f, pose.rightOpen, ink);
    surface.fillEllipse(120.0f, 125.0f, 8.0f, 5.0f, ink);
    detail::mouth(surface, pose, effects, ink);
}

} // namespace roboface
#endif
