'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {loadBodyMotions, planBodyMotion} = require('../application/body-motion.cjs');
const {ServoOutput} = require('../application/servo-output.cjs');
const {FriendRuntime} = require('../application/friend-runtime.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-body-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const calibration = ['name,channel,role,calibrated', 'rr,3,rear-right,1',
    'fl,0,front-left,1', 'rl,2,rear-left,1', 'fr,1,front-right,1'].join('\n');
  const frames = ['mode,frame,step_ms,hold_ms,front-left,front-right,rear-left,rear-right'];
  for (const [mode, poses] of Object.entries({stand: [[0,0,0,0], [0,0,0,0]],
    lie: [[0,0,0,0], [300,300,-300,-300]],
    forward: [[0,0,0,0], [200,0,-200,0], [0,200,0,-200], [-200,0,200,0], [0,-200,0,200], [0,0,0,0]],
    backward: [[0,0,0,0], [0,-200,0,200], [-200,0,200,0], [0,200,0,-200], [200,0,-200,0], [0,0,0,0]]})) {
    poses.forEach((pose, index) => frames.push([mode,index,600,0,...pose].join(',')));
  }
  fs.writeFileSync(path.join(directory, 'servo-calibration.csv'), calibration);
  fs.writeFileSync(path.join(directory, 'body-motions.csv'), frames.join('\n'));
  return directory;
}

test('forward/backward reverse the phase loop and follow calibration file order', t => {
  const config = loadBodyMotions(fixture(t));
  const forward = planBodyMotion(config, 'forward', {from: 'stand'});
  const backward = planBodyMotion(config, 'backward', {from: 'stand'});
  assert.deepEqual(forward.frames[1], [0,200,-200,0]);
  assert.deepEqual(backward.frames, [...forward.frames].reverse());
  assert.equal(forward.durationMs, 3000);
  assert.equal(forward.timeoutMs, 6000);
  assert.deepEqual(forward.frames.at(-1), [0,0,0,0]);
});

test('rise from lie precedes gait and lying starts at explicitly supplied pose', t => {
  const config = loadBodyMotions(fixture(t));
  const walk = planBodyMotion(config, 'forward', {from: 'lie'});
  assert.deepEqual(walk.frames[0], [-300,300,-300,300]);
  assert.deepEqual(walk.frames[1], [0,0,0,0]);
  assert.equal(walk.durationMs, 3600);
  assert.deepEqual(planBodyMotion(config, 'stand', {from: 'lie'}).frames,
    [[-300,300,-300,300], [0,0,0,0]]);
  assert.deepEqual(planBodyMotion(config, 'lie', {from: 'stand'}).frames.at(-1), [-300,300,-300,300]);
  assert.throws(() => planBodyMotion(config, 'stand'), /actual starting pose/);
  assert.throws(() => planBodyMotion(config, 'shell'), /Unknown body mode/);
  assert.deepEqual(planBodyMotion(null, 'stop').args, ['off','all']);
});

test('body plans reject malformed, uncalibrated and excessive sequences', t => {
  const directory = fixture(t), csv = path.join(directory, 'body-motions.csv');
  const original = fs.readFileSync(csv, 'utf8');
  fs.writeFileSync(csv, original.replace('200,0,-200,0', '1001,0,-200,0'));
  assert.throws(() => loadBodyMotions(directory), /-1000..1000/);
  fs.writeFileSync(csv, original.replace('forward,1,', 'forward,2,'));
  assert.throws(() => loadBodyMotions(directory), /contiguous/);
  fs.writeFileSync(csv, original);
  const config = loadBodyMotions(directory);
  config.motions.get('forward').stepMs = 5000;
  config.motions.get('forward').holdMs = 1000;
  assert.throws(() => planBodyMotion(config, 'forward', {from: 'lie'}), /finite sequence limit/);
  const calibration = path.join(directory, 'servo-calibration.csv');
  fs.writeFileSync(calibration, fs.readFileSync(calibration, 'utf8').replace('rr,3,rear-right,1', 'rr,3,rear-right,0'));
  assert.throws(() => loadBodyMotions(directory), /calibrated/);
});

test('stop preempts motion, blocks new requests during off and allows a later command', async t => {
  const directory = fixture(t), calls = [];
  let rejectMotion, completeOff;
  const servo = new ServoOutput({directory, i2c:'/i2c.csv', calibration:'/servo.csv', stopFile:'/run/body.stop'}, {
    binary: '/gar-servoctl', job(binary, args, options) {
      calls.push({binary,args,options});
      if (args.includes('sequence')) return {promise: new Promise((resolve,reject) => { rejectMotion = reject; }), cancel() { rejectMotion(new Error('cancelled')); }};
      return {promise: new Promise(resolve => { completeOff = resolve; }), cancel() {}};
    },
  });
  const moving = servo.perform('forward', {from:'stand'});
  const rejected = assert.rejects(moving, /cancelled/);
  assert.equal(await servo.perform('backward', {from:'stand'}), false);
  const stopped = servo.perform('stop');
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await servo.perform('lie', {from:'stand'}), false);
  assert.deepEqual(calls[1].args.slice(-2), ['off','all']);
  completeOff();
  assert.equal(await stopped, true);
  assert.ok(calls.every(call => call.options.env.GAR_SERVO_STOP_FILE === '/run/body.stop'));
  const later = servo.perform('stand', {from:'lie'});
  const laterRejected = assert.rejects(later, /cancelled/);
  const closing = servo.close();
  await laterRejected;
  await new Promise(resolve => setImmediate(resolve));
  completeOff();
  await closing;
  assert.equal(await servo.perform('forward', {from:'stand'}), false);
});

test('FriendRuntime offers body modes without changing encoder face selection', async () => {
  const calls = [], friend = new FriendRuntime({servo: {perform: async (...args) => { calls.push(args); return true; }}});
  assert.equal(await friend.command('lie', {from:'stand'}), true);
  assert.deepEqual(calls, [['lie',{from:'stand'}]]);
  const withoutServo = new FriendRuntime();
  await assert.rejects(withoutServo.command('forward', {from:'stand'}), /disabled/);
});
