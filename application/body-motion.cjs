'use strict';
const path = require('node:path');
const {readCsv, integer} = require('./hardware.cjs');

const MODES = Object.freeze(['forward', 'backward', 'stop', 'lie', 'stand']);
const ROLES = ['front-left', 'front-right', 'rear-left', 'rear-right'];

function position(value) {
  if (!/^-?\d+$/.test(value || '') || !Number.isSafeInteger(Number(value)) || Math.abs(Number(value)) > 1000) {
    throw new Error('Body positions must be integers in -1000..1000');
  }
  return Number(value);
}

/** Product-owned keyframes, mapped to native calibration-file order. */
function loadBodyMotions(directory) {
  const servos = readCsv(path.join(directory, 'servo-calibration.csv'));
  if (servos.length !== 4 || new Set(servos.map(s => s.role)).size !== 4 ||
      servos.some(s => !ROLES.includes(s.role)) || new Set(servos.map(s => s.name)).size !== 4 ||
      new Set(servos.map(s => s.channel)).size !== 4) {
    throw new Error('Body modes require exactly four distinct calibrated leg roles/channels');
  }
  if (servos.some(s => s.calibrated !== '1')) throw new Error('Body modes require calibrated servos');
  const motions = new Map();
  for (const row of readCsv(path.join(directory, 'body-motions.csv'))) {
    if (!MODES.includes(row.mode) || row.mode === 'stop') throw new Error('Unknown body mode in CSV');
    const frame = integer(row.frame, 0, 11, 'body frame');
    const stepMs = integer(row.step_ms, 250, 5000, 'body step');
    const holdMs = integer(row.hold_ms, 0, 1000, 'body hold');
    if (!motions.has(row.mode)) motions.set(row.mode, {stepMs, holdMs, frames: []});
    const motion = motions.get(row.mode);
    if (frame !== motion.frames.length || stepMs !== motion.stepMs || holdMs !== motion.holdMs) {
      throw new Error('Body frames must be contiguous with one timing per mode');
    }
    motion.frames.push(servos.map(servo => position(row[servo.role])));
  }
  for (const mode of MODES.filter(mode => mode !== 'stop')) {
    const motion = motions.get(mode);
    if (!motion || motion.frames.length < 2) throw new Error(`Missing body frames: ${mode}`);
  }
  const stand = motions.get('stand').frames.at(-1), lie = motions.get('lie').frames.at(-1);
  const same = (a, b) => a.every((value, index) => value === b[index]);
  for (const [mode, motion] of motions) {
    if (!same(motion.frames[0], stand)) throw new Error(`${mode} must start at the stand pose`);
    if (['forward', 'backward'].includes(mode) && !same(motion.frames.at(-1), stand)) {
      throw new Error('Walking patterns must finish at stand');
    }
  }
  if (same(stand, lie)) throw new Error('Stand and lie poses must differ');
  return {servos, motions, poses: {stand, lie}};
}

function planBodyMotion(config, mode, {from} = {}) {
  if (!MODES.includes(mode)) throw new Error(`Unknown body mode: ${mode}`);
  if (mode === 'stop') return {mode, args: ['off', 'all'], timeoutMs: 5000};
  if (!['stand', 'lie'].includes(from)) throw new Error('Specify the actual starting pose: from=stand or from=lie');
  const motion = config.motions.get(mode);
  const frames = motion.frames.map(frame => [...frame]);
  frames[0] = [...config.poses[from]];
  if (from === 'lie' && ['forward', 'backward'].includes(mode)) frames.splice(1, 0, [...config.poses.stand]);
  const durationMs = (frames.length - 1) * (motion.stepMs + motion.holdMs);
  if (frames.length > 12 || durationMs > 30000) throw new Error('Body motion exceeds the finite sequence limit');
  return {
    mode, from, frames, durationMs,
    args: ['sequence', '--positions', frames.flat().join(','), '--step-ms', String(motion.stepMs),
      '--hold-ms', String(motion.holdMs), '--ack-all', '--ack-position-known'],
    timeoutMs: durationMs + 3000,
  };
}

module.exports = {MODES, loadBodyMotions, planBodyMotion};
