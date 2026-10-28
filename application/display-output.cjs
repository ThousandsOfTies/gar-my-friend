'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');

/** The application writes its frames to the native SPI/GPIO output process. */
class DisplayOutput {
  constructor(root,onError){
    this.closed=false;this.busy=false;this.next=null;
    this.child=spawn(path.join(root,'build/device-output'),[],{cwd:root,stdio:['pipe','pipe','pipe']});
    let pending='',detail='';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{
      pending+=chunk;
      while(pending.includes('\n')){
        const end=pending.indexOf('\n');pending=pending.slice(end+1);
        this.busy=false;this.flush();
      }
    });
    this.child.stderr.on('data',chunk=>{detail=String(chunk).trim();});
    this.child.on('error',onError);this.child.stdin.on('error',error=>{if(!this.closed)onError(error);});
    this.child.on('close',code=>{if(!this.closed)onError(new Error(detail||`Display output exited (${code})`));});
  }
  submit(frame){this.next=frame;this.flush();}
  flush(){
    if(this.closed||this.busy||!this.next||!this.child.stdin.writable)return;
    const {pose,effects}=this.next;this.next=null;this.busy=true;
    const keys=['eyeRx','eyeRy','eyeY','leftOpen','rightOpen','happyEye','tilt','mouthY','mouthW','mouthCurve','mouthOpen','cheek'];
    this.child.stdin.write([...keys.map(key=>pose[key]),effects.gazeX,effects.gazeY,1-effects.blink,effects.talk].join(' ')+'\n');
  }
  close(){this.closed=true;this.child.kill('SIGTERM');}
}
module.exports={DisplayOutput};
