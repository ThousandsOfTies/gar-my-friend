'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { RobotRuntime, ValidationError, validateRecording } = require('../simulation/runtime.cjs');
const { createSimulatorServer, parseArguments } = require('../simulation/server.cjs');
const meaningfulState = runtime => { const state = runtime.state(); delete state.events; delete state.metrics.hostRssBytes; delete state.recording; delete state.replay; return state; };

test('fractional wall-clock boundaries cannot hang scenario or replay scheduling', () => {
  // A subprocess timeout also catches a synchronous infinite loop regression.
  const { spawnSync } = require('node:child_process');
  const script = `
    const assert=require('node:assert/strict');
    const {RobotRuntime}=require('./simulation/runtime.cjs');
    for(let i=1;i<=100;i++){
      const runtime=new RobotRuntime();runtime.advance(i*137.1093);
      runtime.command({type:'record',action:'start'});
      runtime.command({type:'scenario',id:'greeting'});
      runtime.advance(700.71);runtime.command({type:'expression',value:'wink'});
      runtime.advance(3200.3);runtime.command({type:'record',action:'stop'});
      const saved=runtime.exportRecording();
      const replay=new RobotRuntime();replay.command({type:'replay',recording:saved});
      replay.advance(saved.durationMs+1);
      assert.equal(replay.state().replay.running,false);
      assert.equal(replay.state().scenario.running,false);
      assert.equal(replay.state().expression,runtime.state().expression);
    }
  `;
  const result=spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),timeout:5000,encoding:'utf8'});
  assert.equal(result.status,0,result.error?.message||result.stderr);
});

test('runtime shares presets and interpolates interrupted transitions continuously', () => {
  const runtime = new RobotRuntime();
  runtime.command({ type: 'expression', value: 'happy', durationMs: 1000 });
  runtime.advance(400);
  const before = runtime.state().pose;
  assert.notDeepEqual(before, require('../shared/expressions.json').expressions[0].pose);
  runtime.command({ type: 'expression', value: 'sad', durationMs: 500 });
  assert.deepEqual(runtime.state().pose, before);
  runtime.advance(500);
  assert.deepEqual(runtime.state().pose, require('../shared/expressions.json').expressions.find(e => e.id === 'sad').pose);
  const metrics = runtime.state().metrics;
  assert.equal(metrics.frameBytes, 115200); assert.equal(metrics.doubleBufferBytes, 230400);
  assert.equal(metrics.theoreticalTransferMs, 38.4);
  assert.equal(runtime.state().profile.io.physicalWrites, false);
});

test('invalid commands never partially mutate state', () => {
  const runtime = new RobotRuntime();
  for (const command of [
    null, [], { type: 'unknown' }, { type: 'expression', value: 'unknown' },
    { type: 'sensor', pitch: 45, batteryV: 7 }, { type: 'motion', talk: true, gazeX: NaN },
    { type: 'motion', autoBlink: 'true' }, { type: 'joint', id: 'leftHip', angle: 80 },
    { type: 'joint', id: 'leftKnee', angle: -1 }, { type: 'reset', surprise: true },
    { type: 'pause', value: 1 }, { type: 'step', ms: 50 },
  ]) {
    const before = meaningfulState(runtime);
    assert.throws(() => runtime.command(command), ValidationError);
    assert.deepEqual(meaningfulState(runtime), before);
  }
});

test('pausing freezes simulated time and step advances only while paused', () => {
  const runtime = new RobotRuntime();
  runtime.command({ type: 'motion', talk: true });
  runtime.command({ type: 'joint', id: 'leftHip', angle: 40 });
  runtime.command({ type: 'pause', value: true });
  const before = meaningfulState(runtime);
  runtime.advance(500);
  assert.deepEqual(meaningfulState(runtime), before);
  runtime.command({ type: 'step', ms: 100 });
  assert.equal(runtime.state().timeMs, 100);
  assert.equal(runtime.state().joints[0].angle, 8);
  runtime.command({ type: 'pause', value: false });
  runtime.advance(500); assert.equal(runtime.state().joints[0].angle, 40);
});

test('scenario scheduling is deterministic across tick partitions', () => {
  const a = new RobotRuntime(), b = new RobotRuntime();
  a.command({ type: 'scenario', id: 'greeting' }); b.command({ type: 'scenario', id: 'greeting' });
  a.advance(3600); for (let i = 0; i < 72; i++) b.advance(50);
  assert.deepEqual(meaningfulState(a), meaningfulState(b));
  assert.equal(a.state().scenario.running, false);
  assert.equal(a.state().joints[0].angle, 0);
});

test('manual joint input cancels scenario and stop remains latched until reset', () => {
  const runtime = new RobotRuntime();
  runtime.command({ type: 'scenario', id: 'greeting' }); runtime.advance(700);
  runtime.command({ type: 'joint', id: 'leftHip', angle: -20 });
  assert.equal(runtime.state().scenario.running, false);
  runtime.advance(300); runtime.command({ type: 'stop' });
  const joints = runtime.state().joints;
  runtime.advance(3000); assert.deepEqual(runtime.state().joints, joints);
  assert.throws(() => runtime.command({ type: 'joint', id: 'leftHip', angle: 0 }), /停止中/);
  assert.throws(() => runtime.command({ type: 'scenario', id: 'greeting' }), /停止中/);
  const cleanRecording = new RobotRuntime().exportRecording();
  assert.throws(() => runtime.command({ type: 'replay', recording: cleanRecording }), /停止中/);
  assert.equal(runtime.state().stopped, true);
  runtime.command({ type: 'sensor', pitch: 0 }); assert.equal(runtime.state().stopped, true);
  runtime.command({ type: 'reset' }); assert.equal(runtime.state().stopped, false);
});

test('simulated sensors drive face and tilt protection, without electrical claims', () => {
  const runtime = new RobotRuntime();
  runtime.command({ type: 'sensor', batteryV: 3.3 }); assert.equal(runtime.state().expression, 'sleepy');
  runtime.command({ type: 'sensor', batteryV: 4, distanceMm: 60 }); assert.equal(runtime.state().expression, 'surprised');
  runtime.command({ type: 'scenario', id: 'balance' }); runtime.advance(1500);
  assert.equal(runtime.state().stopped, true); assert.equal(runtime.state().sensors.pitch, 35);
  assert.equal(runtime.state().scenario.running, false);
});

test('recording replays pause, step, scenarios and interrupted poses deterministically', () => {
  const runtime = new RobotRuntime();
  runtime.command({ type: 'expression', value: 'sad' }); runtime.advance(200);
  runtime.command({ type: 'record', action: 'start' });
  runtime.command({ type: 'scenario', id: 'greeting' }); runtime.advance(350);
  runtime.command({ type: 'pause', value: true }); runtime.advance(150);
  runtime.command({ type: 'step', ms: 100 }); runtime.advance(200);
  runtime.command({ type: 'pause', value: false }); runtime.advance(650);
  runtime.command({ type: 'joint', id: 'rightHip', angle: -15 }); runtime.advance(250);
  runtime.command({ type: 'sensor', pitch: 45 }); runtime.advance(100);
  runtime.command({ type: 'record', action: 'stop' });
  const saved = runtime.exportRecording(); const expected = meaningfulState(runtime);
  validateRecording(saved);
  const replayed = new RobotRuntime(); replayed.command({ type: 'replay', recording: saved }); replayed.advance(saved.durationMs);
  assert.deepEqual(meaningfulState(replayed), expected);
  assert.equal(replayed.state().replay.running, false);
});

test('invalid recordings are rejected before live state changes', () => {
  const runtime = new RobotRuntime(); runtime.command({ type: 'expression', value: 'happy' }); runtime.advance(200);
  const before = meaningfulState(runtime);
  const invalid = runtime.exportRecording(); invalid.durationMs = 100; invalid.commands.push({ atMs: 50, command: { type: 'step', ms: 50 } });
  assert.throws(() => runtime.command({ type: 'replay', recording: invalid }), /一時停止/);
  assert.deepEqual(meaningfulState(runtime), before);
  const broken = runtime.exportRecording(); broken.initial.joints[0].id = 'rightHip';
  assert.throws(() => runtime.command({ type: 'replay', recording: broken }), /並び/);
  assert.deepEqual(meaningfulState(runtime), before);
  const unsafe = runtime.exportRecording(); unsafe.initial.sensors.pitch = 45;
  assert.throws(() => runtime.command({ type: 'replay', recording: unsafe }), /停止状態がありません/);
  assert.deepEqual(meaningfulState(runtime), before);
});

test('recording automatically ends at one hour and remains replayable after long uptime', () => {
  const runtime = new RobotRuntime();
  for (let hour = 0; hour < 25; hour++) runtime.advance(3600000);
  runtime.command({ type: 'record', action: 'start' }); runtime.command({ type: 'expression', value: 'happy' });
  runtime.advance(3600000); runtime.advance(1000);
  assert.equal(runtime.state().recording.active, false);
  const recording = runtime.exportRecording(); assert.equal(recording.durationMs, 3600000);
  assert.ok(recording.initial.timeMs > 86400000);
  assert.doesNotThrow(() => validateRecording(recording));
});

test('recording event limit never blocks the stop command', () => {
  const runtime = new RobotRuntime(); runtime.command({ type: 'record', action: 'start' });
  for (let i = 0; i < 5000; i++) runtime.command({ type: 'blink' });
  assert.equal(runtime.state().recording.active, false);
  assert.equal(runtime.exportRecording().commands.length, 5000);
  runtime.command({ type: 'stop' }); assert.equal(runtime.state().stopped, true);
});

test('returned state and bounded event history cannot mutate runtime', () => {
  const runtime = new RobotRuntime();
  for (let i = 0; i < 140; i++) runtime.command({ type: 'blink' });
  const state = runtime.state(); assert.equal(state.events.length, 100);
  state.joints[0].angle = 60; state.profile.display.width = 4; state.events.length = 0;
  assert.equal(runtime.state().joints[0].angle, 0); assert.equal(runtime.state().profile.display.width, 240);
  assert.equal(runtime.state().events.length, 100);
});

function request(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }); req.on('error', reject); if (body !== undefined) req.write(body); req.end();
  });
}
test('localhost API validates commands, identity, origins and static path boundaries', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-face-api-'));
  fs.mkdirSync(path.join(fixture, 'simulator')); fs.mkdirSync(path.join(fixture, 'preview')); fs.mkdirSync(path.join(fixture, 'private'));
  fs.writeFileSync(path.join(fixture, 'simulator', 'index.html'), '<!doctype html><title>test</title>');
  fs.writeFileSync(path.join(fixture, 'private', 'secret.js'), 'private content');
  let symlinkCreated = false;
  try { fs.symlinkSync(path.join(fixture, 'private'), path.join(fixture, 'simulator', 'escape'), 'junction'); symlinkCreated = true; } catch {}
  const server = createSimulatorServer({ root: fixture, autoAdvance: false, buildId: 'test-build', instanceId: 'test-instance' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(fixture, { recursive: true, force: true }); });
  const health = JSON.parse((await request(port, '/health')).text);
  assert.equal(health.product, 'orange-pi-face-lab'); assert.equal(health.buildId, 'test-build'); assert.equal(health.instanceId, 'test-instance'); assert.equal(health.pid, process.pid);
  assert.equal((await request(port, '/')).status, 200);
  assert.equal((await request(port, '/api/scenarios')).status, 200);
  const commandRequest = command => request(port, '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  assert.equal((await commandRequest({ type: 'expression', value: 'happy' })).status, 200);
  assert.equal(JSON.parse((await request(port, '/api/state')).text).expression, 'happy');
  assert.equal((await commandRequest({ type: 'sensor', pitch: 45, batteryV: 9 })).status, 400);
  assert.equal(JSON.parse((await request(port, '/api/state')).text).stopped, false);
  assert.equal((await request(port, '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{"type":"reset"}' })).status, 403);
  assert.equal((await request(port, '/api/command', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await request(port, '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'broken' })).status, 400);
  assert.equal((await request(port, '/health', { headers: { Host: 'untrusted.example' } })).status, 403);
  for (const url of ['/simulator/../private/secret.js', '/simulator/%2e%2e/private/secret.js', '/simulator/%5c..%5cprivate%5csecret.js']) assert.equal((await request(port, url)).status, 403);
  assert.equal((await request(port, '/simulation/runtime.cjs')).status, 404);
  if (symlinkCreated) assert.equal((await request(port, '/simulator/escape/secret.js')).status, 403);
  const oversized = await request(port, '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
});

test('CLI only accepts simulation and bounded explicit arguments', () => {
  assert.equal(parseArguments([]).port, 8773);
  assert.throws(() => parseArguments(['--mode', 'hardware']), /実機I\/Oは未実装/);
  assert.throws(() => parseArguments(['--port', '8773;delete']), /port/);
  assert.throws(() => parseArguments(['--unknown', 'x']), /未対応/);
});
