'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {readCsv,integer}=require('./hardware.cjs');

/** Optional Product outputs. Older face-only Products need no new config. */
function loadEffects(directory){
  const file=path.join(directory,'effects.csv');
  if(!fs.existsSync(file))return {servo:null,speech:null};
  const rows=readCsv(file),byKind=new Map();
  for(const row of rows){
    if(!['servo','speech'].includes(row.kind)||byKind.has(row.kind)||!['0','1'].includes(row.enabled))throw new Error('Invalid or duplicate effect configuration');
    byKind.set(row.kind,row);
  }
  const servo=byKind.get('servo'),speech=byKind.get('speech');
  const result={servo:null,speech:null};
  if(servo?.enabled==='1'){
    for(const name of ['i2c.csv','servo-calibration.csv'])if(!fs.existsSync(path.join(directory,name)))throw new Error(`Missing servo config: ${name}`);
    if(!servo.stop_file||!path.isAbsolute(servo.stop_file))throw new Error('Servo needs an explicit writable stop-file path');
    result.servo={i2c:path.join(directory,'i2c.csv'),calibration:path.join(directory,'servo-calibration.csv'),holdMs:integer(servo.hold_ms,0,1000,'servo hold'),stopFile:servo.stop_file};
  }
  if(speech?.enabled==='1'){
    if(!speech.dictionary||!speech.voice||!speech.device||!/^[a-zA-Z0-9_:,=.-]{1,128}$/.test(speech.device))throw new Error('Speech needs dictionary, voice and ALSA device');
    const speed=Number(speech.speed);
    if(!Number.isFinite(speed)||speed<0.5||speed>2)throw new Error('Speech speed must be between 0.5 and 2');
    result.speech={dictionary:speech.dictionary,voice:speech.voice,device:speech.device,speed};
  }
  return result;
}
module.exports={loadEffects};
