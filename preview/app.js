(function () {
  'use strict';
  const data = window.FacePresets;
  const entries = data.expressions;
  const byId = Object.fromEntries(entries.map(x => [x.id, x]));
  const $ = id => document.getElementById(id);
  const canvas = $('face'), ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let selected = entries[0].id, current = { ...entries[0].pose }, from = { ...current };
  let duration = 450, time = 0, transitionAt = -duration, lastFrame = null;
  let paused = reduced, talk = false, autoBlink = !reduced, demo = false;
  let blinkAt = -1000, nextBlink = 2400, nextDemo = 3000;
  const select = id => {
    if (!byId[id]) return;
    selected = id; from = { ...current }; transitionAt = time;
    if (paused || reduced) {
      current = { ...byId[id].pose }; from = { ...current }; transitionAt = time - duration;
    }
    document.querySelectorAll('[data-expression]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.expression === id)));
    const entry = byId[id];
    $('expression-number').textContent = String(entries.indexOf(entry) + 1).padStart(2, '0');
    $('expression-name').textContent = entry.label;
    $('expression-en').textContent = entry.id.toUpperCase();
    canvas.setAttribute('aria-label', `${entry.label}のロボットの顔`);
    render();
  };
  function render() {
    const blinkTime = time - blinkAt;
    const blink = blinkTime >= 0 && blinkTime < 180 ? Math.sin(Math.PI * blinkTime / 180) : 0;
    const mouth = talk ? (Math.sin(time / 98) * 0.5 + 0.5) * (Math.sin(time / 263) * 0.3 + 0.7) * 17 : 0;
    FaceRenderer.draw(ctx, current, { blink, talk: mouth });
  }
  function updatePause() {
    $('pause').textContent = paused ? '再生' : '一時停止';
    $('play-status').textContent = paused ? '一時停止中' : 'アニメーション中';
    document.querySelector('.stage').classList.toggle('paused', paused);
  }
  entries.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'expression'; button.dataset.expression = entry.id;
    button.setAttribute('aria-pressed', String(entry.id === selected));
    const thumb = document.createElement('canvas'); thumb.width = 120; thumb.height = 120;
    thumb.setAttribute('aria-hidden', 'true'); FaceRenderer.draw(thumb.getContext('2d'), entry.pose);
    const label = document.createElement('span'); label.textContent = entry.label;
    button.append(thumb, label); button.addEventListener('click', () => {
      demo = false; $('demo').setAttribute('aria-pressed', 'false'); select(entry.id);
    });
    $('expressions').append(button);
  });
  $('pause').addEventListener('click', () => { paused = !paused; updatePause(); });
  $('blink').addEventListener('click', () => {
    if (paused) { paused = false; updatePause(); }
    blinkAt = time; nextBlink = time + 2800;
  });
  $('demo').addEventListener('click', () => {
    demo = !demo; nextDemo = time + 2200;
    if (demo) { paused = false; updatePause(); select(entries[(entries.findIndex(x => x.id === selected) + 1) % entries.length].id); }
    $('demo').setAttribute('aria-pressed', String(demo));
  });
  $('talk').addEventListener('change', event => { talk = event.target.checked; render(); });
  $('auto-blink').checked = autoBlink;
  $('auto-blink').addEventListener('change', event => {
    autoBlink = event.target.checked; nextBlink = time + 1600;
    if (!autoBlink) blinkAt = -1000;
    render();
  });
  $('duration').addEventListener('input', event => {
    // Restart from the visible pose so changing speed never jumps backward.
    from = { ...current }; transitionAt = time;
    duration = Number(event.target.value); $('duration-value').value = `${duration} ms`;
  });
  $('save').addEventListener('click', () => {
    const content = { schemaVersion: 1, display: { controller: 'GC9A01', width: 240, height: 240 }, expression: selected, pose: byId[selected].pose, palette: FaceRenderer.palette, animation: { transitionMs: duration, autoBlink, talkDemo: talk } };
    const blob = new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'robot-face-settings.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('save-status').textContent = '設定を書き出しました。';
  });
  function frame(stamp) {
    const delta = lastFrame === null ? 0 : Math.min(80, stamp - lastFrame); lastFrame = stamp;
    if (!paused && !document.hidden) {
      time += delta;
      current = FaceRenderer.blend(from, byId[selected].pose, (time - transitionAt) / duration);
      if (autoBlink && time >= nextBlink) { blinkAt = time; nextBlink = time + 2600 + Math.random() * 2200; }
      if (demo && time >= nextDemo) { select(entries[(entries.findIndex(x => x.id === selected) + 1) % entries.length].id); nextDemo = time + 2500; }
      render();
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { lastFrame = null; });
  updatePause(); select(selected); requestAnimationFrame(frame);
})();
