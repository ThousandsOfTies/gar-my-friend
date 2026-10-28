'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Product adapter. The shared reader owns GPIO decoding; only the runtime
 * assigns an encoder detent or press to a face action. */
class RotaryInput {
  constructor(root, wiring, onInput, onError) {
    this.ready = false; this.error = null; this.counter = 0; this.closed = false;
    this.chip=wiring.chip;this.lines=[wiring.clock,wiring.data,wiring.switch];
    const args=['--chip',wiring.chip,'--clock',String(wiring.clock),'--data',String(wiring.data),'--switch',String(wiring.switch)];
    if(wiring.bias&&wiring.bias!=='as-is')args.push('--bias',wiring.bias);
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
          if(event.type==='ready'){this.ready=true;this.error=null;console.log('Rotary GPIO ready');}
          else if(event.type==='rotate'||event.type==='press'){
            console.log(`Rotary ${event.type}${event.type==='rotate'?` ${event.direction}`:''}; counter=${event.counter}`);
            onInput({type:'rotary',action:event.type,...(event.type==='rotate'?{direction:event.direction}:{})});
          }
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
