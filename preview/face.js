/* Shared geometry contract: firmware/FaceCore.h. No bitmap face assets. */
(function (root) {
  'use strict';
  const palette = root.FacePresets.palette;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function mixColor(a, b, t) {
    const aa = a.match(/[a-f0-9]{2}/gi).map(x => parseInt(x, 16));
    const bb = b.match(/[a-f0-9]{2}/gi).map(x => parseInt(x, 16));
    return '#' + aa.map((v, i) => Math.round(v + (bb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function blend(a, b, progress) {
    const t = clamp(progress, 0, 1), s = t * t * (3 - 2 * t);
    return Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * s]));
  }
  function draw(ctx, pose, options = {}) {
    const p = { ...pose };
    const blink = clamp(options.blink || 0, 0, 1);
    p.leftOpen *= 1 - blink; p.rightOpen *= 1 - blink;
    p.mouthOpen = clamp(p.mouthOpen + (options.talk || 0), 0, 38);
    const width = ctx.canvas.width, height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.scale(width / 240, height / 240);
    ctx.beginPath(); ctx.arc(120, 120, 120, 0, 2 * Math.PI); ctx.clip();
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 240, 240);
    function ellipse(x, y, rx, ry, fill) {
      ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    const cheek = mixColor(palette.background, palette.cheek, clamp(p.cheek, 0, 1));
    ellipse(53, 131, 13, 8, cheek); ellipse(187, 131, 13, 8, cheek);
    const curvePoints = (cx, rx, middle, half) => {
      const top = [], bottom = [];
      for (let i = 0; i <= 24; i++) {
        const u = -1 + i / 12;
        const y = middle(u), h = half(u);
        top.push([cx + u * rx, y - h]); bottom.push([cx + u * rx, y + h]);
      }
      return { top, bottom };
    };
    function path(points, close = false) {
      ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      if (close) ctx.closePath();
    }
    function strip(top, bottom) {
      ctx.fillStyle = palette.ink;
      path([...top, ...bottom.slice().reverse()], true); ctx.fill();
    }
    const gazeX = clamp(options.gazeX || 0, -8, 8);
    const gazeY = clamp(options.gazeY || 0, -8, 8);
    for (const [cx, side, open] of [[78 + gazeX, 1, p.leftOpen], [162 + gazeX, -1, p.rightOpen]]) {
      const thickness = Math.max(1.5, p.eyeRy * open * (1 - p.happyEye) + 1.5 * p.happyEye);
      const points = curvePoints(cx, p.eyeRx,
        u => p.eyeY + gazeY - p.happyEye * (1 - blink) * 8 * (1 - u * u) + p.tilt * side * u,
        u => thickness * Math.sqrt(Math.max(0, 1 - u * u)));
      strip(points.top, points.bottom);
    }
    ellipse(120, 125, 8, 5, palette.ink);
    const mouth = curvePoints(120, p.mouthW / 2,
      u => p.mouthY + p.mouthCurve * (1 - u * u),
      u => p.mouthOpen / 2 * Math.sqrt(Math.max(0, 1 - u * u)));
    strip(mouth.top, mouth.bottom);
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    path(mouth.top); ctx.stroke(); path(mouth.bottom); ctx.stroke();
    ctx.restore();
  }
  root.FaceRenderer = { draw, blend, palette };
})(typeof window !== 'undefined' ? window : globalThis);
