'use strict';
const path = require('node:path');
const {readCsv} = require('../application/hardware.cjs');
const {loadEffects} = require('../application/effect-config.cjs');
const {MODES, loadBodyMotions, planBodyMotion} = require('../application/body-motion.cjs');
const {ServoOutput} = require('../application/servo-output.cjs');

async function main(args = process.argv.slice(2)) {
  const usage = 'Usage: body.cjs forward|backward|stop|lie|stand [--from stand|lie] [--dry-run]';
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const mode = args.shift();
  if (!MODES.includes(mode)) throw new Error(usage);
  let from, dryRun = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--from' && from === undefined && args.length) from = args.shift();
    else if (arg === '--dry-run' && !dryRun) dryRun = true;
    else throw new Error(usage);
  }
  if (mode === 'stop' && from !== undefined) throw new Error('stop does not take --from');
  const directory = process.env.GAR_HARDWARE_DIR;
  if (!directory) throw new Error('GAR_HARDWARE_DIR must select the Product CSV directory');
  const plan = planBodyMotion(mode === 'stop' ? null : loadBodyMotions(directory), mode, {from});
  if (dryRun) { console.log(JSON.stringify(plan, null, 2)); return plan; }
  if (process.platform !== 'linux') throw new Error('Hardware body commands require Linux; use --dry-run on this PC');
  let config;
  if (mode === 'stop') {
    // Stopping remains possible even when output enablement or gait data is bad.
    const row = readCsv(path.join(directory, 'effects.csv')).find(row => row.kind === 'servo');
    if (!row?.stop_file || !path.isAbsolute(row.stop_file)) throw new Error('Missing servo stop-file path');
    config = {i2c: path.join(directory, 'i2c.csv'), calibration: path.join(directory, 'servo-calibration.csv'), stopFile: row.stop_file};
  } else {
    config = loadEffects(directory).servo;
    if (!config) throw new Error('Enable the servo row in Product effects.csv before hardware motion');
  }
  const binary = path.join(process.env.GAR_BIN_DIR || path.resolve(__dirname, '../build'), 'gar-servoctl');
  const servo = new ServoOutput(config, {binary});
  let interrupted = false;
  const stop = () => { interrupted = true; servo.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  try {
    if (mode === 'stop') await servo.stop();
    else await servo.perform(mode, {from});
    if (interrupted) throw new Error('Body command interrupted');
    console.log(`${mode}: complete; outputs off`);
  } finally {
    await servo.close();
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {main};
