'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Product adapter. The shared reader owns GPIO decoding; only the runtime
 * assigns an encoder detent or press to a face action. */
class RotaryInput {
  constructor(root, onInput, onError) {
    this.ready = false; this.error = null; this.counter = 0; this.closed = false;
    const rows = fs.readFileSync(path.join(root,'hardware/gpio.csv'),'utf8').trim().split(/\r?\n/).map(row=>row.split(','));
    const headers=rows.shift();
    const mapping=Object.fromEntries(rows.map(row=>{
      const value=Object.fromEntries(headers.map((key,index)=>[key,row[index]]));return [value.name,value];
    }));
    const lines=['encoder_a','encoder_b','encoder_sw'].map(name=>mapping[name]);
    if(lines.some(row=>!row||row.direction!=='input'||!/^\d+$/.test(row.line)||Number(row.line)>4095) ||
      new Set(lines.map(row=>row.line)).size!==3 || new Set(lines.map(row=>row.chip)).size!==1 || !/^\/dev\/gpiochip\d+$/.test(lines[0].chip)) throw new Error('ロータリーのGPIO設定を確認してください');
    this.chip=lines[0].chip;this.lines=lines.map(row=>Number(row.line));
    const args=['--chip',this.chip,'--clock',lines[0].line,'--data',lines[1].line,'--switch',lines[2].line];
    this.child=spawn(path.join(root,'build/gar_rotary_input'),args,{cwd:root,stdio:['ignore','pipe','pipe']});
    let pending='';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{
      pending+=chunk;
      for(;;){
        const end=pending.indexOf('\n');if(end<0)break;
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        try{
          const event=JSON.parse(line);this.counter=event.counter;
          if(event.type==='ready'){this.ready=true;this.error=null;}
          else if(event.type==='rotate'||event.type==='press')onInput({type:'rotary',action:event.type,...(event.type==='rotate'?{direction:event.direction}:{})});
        }catch(error){this.error=error.message;}
      }
    });
    this.child.stderr.on('data',chunk=>{this.error=String(chunk).trim().slice(-300);});
    this.child.on('error',onError);
    this.child.on('close',code=>{if(!this.closed)onError(new Error(this.error||`GPIO input exited (${code})`));});
  }
  close(){this.closed=true;this.child.kill('SIGTERM');}
}
module.exports={RotaryInput};
