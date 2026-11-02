'use strict';
const {FaceRuntime}=require('./face-runtime.cjs');
const {reactions}=require('../shared/reactions.json');

/** The application coordinates face, body and speech, independently of a panel. */
class FriendRuntime {
  constructor({face=new FaceRuntime(),servo=null,speech=null,onError=console.error}={}){this.face=face;this.servo=servo;this.speech=speech;this.onError=onError;this.closed=false;}
  input(event){
    if(this.closed)return;
    this.face.input(event);
    if(event.action==='press'){
      const reaction=reactions[this.face.expressionId];
      if(this.servo)this.servo.neutral().catch(this.onError);
      if(this.speech&&reaction)this.speech.say(reaction.text).catch(this.onError);
    }
  }
  advance(ms){this.face.advance(ms);}
  // Local controls and future LLM tools share a bounded semantic interface.
  async command(mode, options){
    if(this.closed)return false;
    if(!this.servo)throw new Error('Servo output is disabled');
    return this.servo.perform(mode, options);
  }
  frame(){return this.face.frame();}
  async close(){if(this.closed)return;this.closed=true;await Promise.all([this.servo?.close(),this.speech?.close()].map(promise=>Promise.resolve(promise).catch(this.onError)));}
}
module.exports={FriendRuntime};
