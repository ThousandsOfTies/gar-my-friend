'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

/** Explicit local audio checks. No ambient recording, recognition or upload. */
class AudioSession {
  constructor({audio, checkWave, config}) {
    this.audio = audio; this.checkWave = checkWave; this.config = config;
    this.pending = null; this.current = null; this.closed = false;
  }
  start(operation) {
    if (this.closed || this.pending) return Promise.reject(new Error('Audio session is closed or busy'));
    const work = Promise.resolve().then(() => {
      if (this.closed) throw new Error('Audio session closed');
      return operation();
    });
    this.pending = work;
    return work.finally(() => { this.current = null; this.pending = null; });
  }
  record(destination, seconds = 5) {
    if (!this.config.capture) throw new Error('Select the capture device in audio.csv first');
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15)
      throw new Error('Recording duration must be 1..15 seconds');
    const target = path.resolve(destination);
    return this.start(async () => {
      try { await fs.lstat(target); throw new Error('Recording destination already exists'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // On the destination filesystem: link publishes only a completed recording, without overwriting.
      const directory = await fs.mkdtemp(path.join(path.dirname(target), '.friend-recording-'));
      const wave = path.join(directory, 'capture.wav');
      try {
        await fs.writeFile(wave, '', {flag: 'wx', mode: 0o600});
        if (this.closed) throw new Error('Audio session closed');
        this.current = this.audio.record(wave, this.config.capture, seconds);
        await this.current.promise;
        if (this.closed) throw new Error('Audio session closed');
        await this.checkWave(wave, 44 + 16000 * 2 * seconds + 4096);
        if (this.closed) throw new Error('Audio session closed');
        await fs.link(wave, target);
        return target;
      } finally { await fs.rm(directory, {recursive: true, force: true}); }
    });
  }
  play(file) {
    if (!this.config.playback) throw new Error('Select the playback device in audio.csv first');
    const wave = path.resolve(file);
    return this.start(async () => {
      await this.checkWave(wave);
      if (this.closed) throw new Error('Audio session closed');
      this.current = this.audio.play(wave, this.config.playback);
      await this.current.promise;
    });
  }
  async close() {
    this.closed = true;
    this.current?.cancel();
    await this.pending?.catch(() => {});
  }
}
module.exports = {AudioSession};
