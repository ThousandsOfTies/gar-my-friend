'use strict';

function pause(milliseconds,signal){
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,milliseconds);signal.addEventListener('abort',finish,{once:true});
    if(signal.aborted)finish();
  });
}

/** Renew credentials/session without replaying commands or interrupting the face. */
class ManagedLive{
  constructor({credentials,createSession,onStatus=()=>{},onFailure=()=>{},initialMuted=false,retry=true,wait=pause}){
    Object.assign(this,{credentials,createSession,onStatus,onFailure,retry,wait});
    this.abort=new AbortController();this.closed=false;this.muted=Boolean(initialMuted);
  }
  start(){if(this.running)throw new Error('Managed Live already started');this.running=this.loop();return this;}
  setMuted(value){this.muted=Boolean(value);this.current?.setMuted(this.muted);}
  async loop(){
    let delay=1000;
    while(!this.closed){
      let refresh;
      try{
        this.onStatus('authenticating');
        const credentials=await this.credentials(this.abort.signal);if(this.closed)break;
        const ended=new Promise(resolve=>{this.connectionEnded=resolve;});
        this.current=this.createSession({onFailure:()=>this.connectionEnded?.(),onStatus:state=>this.onStatus(state)});
        this.current.setMuted(this.muted);
        await this.current.start(credentials);if(this.closed)break;
        delay=1000;
        const remaining=Date.parse(credentials.expiresAt)-Date.now()-10000;
        refresh=setTimeout(()=>this.connectionEnded?.(),Math.max(1000,remaining));
        await ended;
      }catch{
        // Credentials/provider errors are deliberately not interpolated into logs.
      }finally{
        clearTimeout(refresh);await this.current?.close();this.current=null;this.connectionEnded=null;
      }
      if(this.closed)break;
      if(!this.retry){this.closed=true;this.onFailure(new Error('Live session ended; confirm the body pose before restarting'));break;}
      this.onStatus('retrying');await this.wait(delay,this.abort.signal);delay=Math.min(60000,delay*2);
    }
  }
  async close(){
    if(this.closing)return this.closing;
    this.closed=true;this.abort.abort();this.connectionEnded?.();
    this.closing=(async()=>{await this.current?.close();await this.running;})();return this.closing;
  }
}
module.exports={ManagedLive};
