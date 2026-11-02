'use strict';
const {processJob} = require('./process-job.cjs');
const {MODES, loadBodyMotions, planBodyMotion} = require('./body-motion.cjs');

/** The native owner retains calibration, locking, rate limits and fail-off. */
class ServoOutput {
  constructor(config, {binary, job = processJob} = {}) {
    this.config = config;
    this.binary = binary;
    this.job = job;
    this.current = null;
    this.stopping = null;
    this.closed = false;
    this.env = {...process.env, GAR_SERVO_STOP_FILE: config.stopFile};
  }

  args(...command) {
    return ['--i2c-config', this.config.i2c, '--servo-config', this.config.calibration, ...command];
  }

  async run(command, timeoutMs) {
    if (this.closed || this.current || this.stopping) return false;
    const current = this.job(this.binary, this.args(...command), {timeoutMs, env: this.env});
    this.current = current;
    try {
      await current.promise;
      return true;
    } finally {
      if (this.current === current) this.current = null;
    }
  }

  neutral() {
    return this.run(['neutral', 'all', '--hold-ms', String(this.config.holdMs), '--ack-all'], 5000);
  }

  perform(mode, options) {
    if (!MODES.includes(mode)) return Promise.reject(new Error(`Unknown body mode: ${mode}`));
    if (mode === 'stop') return this.stop();
    try {
      const plan = planBodyMotion(loadBodyMotions(this.config.directory), mode, options);
      return this.run(plan.args, plan.timeoutMs);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  stop() {
    if (this.stopping) return this.stopping;
    // Block new requests before cancelling. A stop never waits behind a gait.
    this.stopping = this.stopActive().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  async stopActive() {
    const active = this.current;
    active?.cancel();
    if (active) await active.promise.catch(() => {});
    await this.job(this.binary, this.args('off', 'all'), {timeoutMs: 5000, env: this.env}).promise;
    return true;
  }

  async close() {
    if (this.closed) return this.stopping;
    this.closed = true;
    await this.stop();
  }
}
module.exports = {ServoOutput};
