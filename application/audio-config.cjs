'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {readCsv} = require('./hardware.cjs');

function loadAudioConfig(directory) {
  const result = {capture: null, playback: null};
  const file = path.join(directory, 'audio.csv');
  if (!fs.existsSync(file)) return result;
  const seen = new Set();
  for (const row of readCsv(file)) {
    if (!Object.hasOwn(result, row.direction) || seen.has(row.direction))
      throw new Error('Invalid or duplicate audio direction');
    seen.add(row.direction);
    if (row.device && !/^[a-zA-Z0-9_:,=.-]{1,128}$/.test(row.device))
      throw new Error('Invalid ALSA device in audio.csv');
    result[row.direction] = row.device || null;
  }
  return result;
}
module.exports = {loadAudioConfig};
