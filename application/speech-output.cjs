'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {processJob}=require('./process-job.cjs');

/** Local Japanese TTS -> WAV -> ALSA. No cloud key or network required. */
class SpeechOutput {
  constructor(config,{job=processJob,onSpeaking=()=>{}}={}){this.config=config;this.job=job;this.onSpeaking=onSpeaking;this.current=null;this.pending=null;this.closed=false;}
  async say(text){
    if(typeof text!=='string'||!text.trim()||text.length>300||text.includes('\0'))throw new Error('Speech text must contain 1..300 characters');
    if(this.closed||this.pending)return false;
    const work=this.run(text);this.pending=work;
    try{await work;return true;}finally{if(this.pending===work)this.pending=null;}
  }
  async run(text){
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gar-friend-speech-'));
    try{
      if(this.closed)return;
      const wave=path.join(directory,'speech.wav'),config=this.config;
      this.current=this.job('open_jtalk',['-x',config.dictionary,'-m',config.voice,'-r',String(config.speed),'-ow',wave],{input:text+'\n',timeoutMs:15000});
      await this.current.promise;
      if(this.closed)return;
      const file=await fs.open(wave,'r');
      try{
        const stat=await file.stat(),header=Buffer.alloc(12);
        await file.read(header,0,12,0);
        if(stat.size<44||stat.size>16*1024*1024||header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WAVE')throw new Error('TTS did not produce a bounded WAV file');
      }finally{await file.close();}
      this.current=this.job('aplay',['-q','-D',config.device,wave],{timeoutMs:30000});
      this.onSpeaking(true);
      await this.current.promise;
    }finally{
      this.current=null;this.onSpeaking(false);
      await fs.rm(directory,{recursive:true,force:true});
    }
  }
  async close(){
    if(this.closed)return;this.closed=true;this.current?.cancel();
    await this.pending?.catch(()=>{});
    this.onSpeaking(false);
  }
}
module.exports={SpeechOutput};
