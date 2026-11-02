'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {AudioSession} = require('../application/audio-session.cjs');
const {loadAudioConfig} = require('../application/audio-config.cjs');
const {loadEffects} = require('../application/effect-config.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'friend-audio-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  return directory;
}

test('audio selection stays unconfigured until explicit setup and speech shares playback', async t => {
  const directory = await fixture(t);
  assert.deepEqual(loadAudioConfig(directory),{capture:null,playback:null});
  await fs.writeFile(path.join(directory,'audio.csv'),'direction,device\ncapture,\nplayback,\n');
  assert.deepEqual(loadAudioConfig(directory),{capture:null,playback:null});
  await fs.writeFile(path.join(directory,'effects.csv'),'kind,enabled,device,dictionary,voice,speed\nspeech,1,default,/dic,/voice,1\n');
  assert.throws(() => loadEffects(directory),/explicit ALSA playback/);
  await fs.writeFile(path.join(directory,'audio.csv'),'direction,device\ncapture,"plughw:CARD=Mic,DEV=0"\nplayback,"plughw:CARD=Speaker,DEV=0"\n');
  assert.equal(loadEffects(directory).speech.device,'plughw:CARD=Speaker,DEV=0');
  assert.equal(loadAudioConfig(directory).capture,'plughw:CARD=Mic,DEV=0');
  await fs.writeFile(path.join(directory,'audio.csv'),'direction,device\nplayback,default\nplayback,default\n');
  assert.throws(() => loadAudioConfig(directory),/duplicate/);
  await fs.unlink(path.join(directory,'audio.csv'));
  assert.equal(loadEffects(directory).speech.device,'default','Legacy Products keep their existing configuration');
});

test('only a completed local recording is published; files are never overwritten', async t => {
  const directory = await fixture(t), destination = path.join(directory,'record.wav');
  const calls = [];
  const session = new AudioSession({config:{capture:'mic',playback:'speaker'},
    checkWave:async file => { assert.equal(await fs.readFile(file,'utf8'),'recording'); },
    audio:{record(file,device,seconds) {
      calls.push({device,seconds});
      return {promise:fs.writeFile(file,'recording'),cancel(){}};
    },play(file,device) { calls.push({file,device}); return {promise:Promise.resolve(),cancel(){}}; }}});
  assert.equal(await session.record(destination,3),destination);
  assert.equal(await fs.readFile(destination,'utf8'),'recording');
  await assert.rejects(session.record(destination,3),/already exists/);
  assert.equal(calls.length,1,'Do not activate the microphone for an already occupied destination');
  assert.equal(await fs.readFile(destination,'utf8'),'recording');
  await session.play(destination);
  assert.equal(calls.at(-1).device,'speaker');
  assert.deepEqual(await fs.readdir(directory),['record.wav']);
  await session.close();
  await assert.rejects(session.record(path.join(directory,'closed.wav')),/closed/);
});

test('cancellation discards partial recordings and prevents concurrent playback', async t => {
  const directory = await fixture(t), target = path.join(directory,'cancel.wav');
  let started, reject;
  const ready = new Promise(resolve => { started = resolve; });
  const session = new AudioSession({config:{capture:'mic',playback:'speaker'},checkWave:async()=>{},
    audio:{record() { started(); return {promise:new Promise((resolve,fail) => {reject=fail;}),cancel(){reject(new Error('cancelled'));}}; },
      play(){throw new Error('must not play');}}});
  const pending = session.record(target); pending.catch(()=>{}); await ready;
  await assert.rejects(session.play(target),/busy/);
  await session.close();
  await assert.rejects(pending,/cancelled/);
  assert.deepEqual(await fs.readdir(directory),[]);
});

test('unconfigured devices, invalid duration and failed WAV validation do not play or publish', async t => {
  const directory = await fixture(t), target = path.join(directory,'bad.wav');
  const absent = new AudioSession({config:{capture:null,playback:null}});
  assert.throws(() => absent.record(target),/Select the capture/);
  assert.throws(() => absent.play(target),/Select the playback/);
  let plays = 0;
  const session = new AudioSession({config:{capture:'mic',playback:'speaker'},checkWave:async()=>{throw new Error('invalid WAV');},
    audio:{record(){return {promise:Promise.resolve(),cancel(){}};},play(){plays++;}}});
  assert.throws(() => session.record(target,16),/1..15/);
  await assert.rejects(session.record(target),/invalid WAV/);
  await assert.rejects(session.play(target),/invalid WAV/);
  assert.equal(plays,0); assert.deepEqual(await fs.readdir(directory),[]);
});
