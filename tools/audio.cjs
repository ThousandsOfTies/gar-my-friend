'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {constants} = require('node:fs');
const {loadAudioConfig} = require('../application/audio-config.cjs');
const {loadEffects} = require('../application/effect-config.cjs');
const {processJob} = require('../application/process-job.cjs');
const {AudioSession} = require('../application/audio-session.cjs');
const {SpeechOutput} = require('../application/speech-output.cjs');

async function available(command) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    try { await fs.access(path.join(directory, command), constants.X_OK); return true; }
    catch (error) { if (!['ENOENT','EACCES','ENOTDIR'].includes(error.code)) throw error; }
  }
  return false;
}

async function main(args = process.argv.slice(2)) {
  const [action, value, duration] = args;
  if (!['devices','check','record','play','say'].includes(action) ||
      (['devices','check'].includes(action) && args.length !== 1) ||
      (action === 'record' && (args.length < 2 || args.length > 3 || (duration !== undefined && !/^\d+$/.test(duration)))) ||
      (action === 'play' && args.length !== 2) || (action === 'say' && args.length < 2))
    throw new Error('Usage: audio devices | check | record FILE.wav [1..15 seconds] | play FILE.wav | say TEXT');
  if (!process.env.GAR_HARDWARE_DIR || !process.env.GAR_TOOLS_ROOT)
    throw new Error('Product must set GAR_HARDWARE_DIR and GAR_TOOLS_ROOT');
  const driver = require(path.join(process.env.GAR_TOOLS_ROOT, 'targets/linux-device/runtime/alsa-audio/audio.cjs'));
  if (action === 'devices') { console.log(JSON.stringify(await driver.devices(), null, 2)); return; }
  const config = loadAudioConfig(process.env.GAR_HARDWARE_DIR);
  if (action === 'check') {
    const speech = loadEffects(process.env.GAR_HARDWARE_DIR).speech;
    const commands = Object.fromEntries(await Promise.all(['arecord','aplay','open_jtalk'].map(async name => [name, await available(name)])));
    const cards = await driver.devices();
    console.log(JSON.stringify({platform: process.platform, configured: config, devices: cards, commands,
      speechEnabled: Boolean(speech), note: 'Read-only check; actual capture/playback requires Linux and the selected device.'}, null, 2));
    return;
  }
  if (process.platform !== 'linux') throw new Error('USB audio commands require Linux ALSA');
  let session;
  if (action === 'say') {
    const speech = loadEffects(process.env.GAR_HARDWARE_DIR).speech;
    if (!speech) throw new Error('Enable speech in effects.csv and select playback in audio.csv first');
    session = new SpeechOutput(speech);
  } else session = new AudioSession({audio: new driver.AlsaAudio({job: processJob}), checkWave: driver.checkWave, config});
  const close = () => session.close();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, close);
  try {
    if (action === 'record') {
      console.error('Recording locally now. Ctrl+C cancels and discards an incomplete recording.');
      console.log(await session.record(value, duration === undefined ? 5 : Number(duration)));
    } else if (action === 'play') await session.play(value);
    else await session.say(args.slice(1).join(' '));
  } finally {
    await session.close();
    for (const signal of ['SIGINT','SIGTERM']) process.removeListener(signal, close);
  }
}
module.exports = {main};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
