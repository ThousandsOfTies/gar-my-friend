'use strict';
const {expressions}=require('../shared/expressions.json');
const copy=value=>structuredClone(value);

/** Application behavior only. No HTTP, WebPanel or simulator dependencies. */
class FaceRuntime {
  constructor(){
    this.timeMs=0;this.index=0;this.pose=copy(expressions[0].pose);
    this.transition={from:this.pose,to:this.pose,start:0};this.blinkAt=-10000;this.nextBlink=2400;
  }
  input({action,direction}){
    if(action==='rotate'){
      if(direction!==1&&direction!==-1)throw new Error('Invalid rotary direction');
      this.index=(this.index+direction+expressions.length)%expressions.length;
      this.transition={from:copy(this.pose),to:copy(expressions[this.index].pose),start:this.timeMs};
    }else if(action==='press'){
      this.blinkAt=this.timeMs;this.nextBlink=this.timeMs+3000;
    }else throw new Error('Invalid rotary action');
  }
  advance(ms){
    if(!Number.isFinite(ms)||ms<0)throw new Error('Invalid elapsed time');
    this.timeMs+=ms;
    const t=Math.min(1,(this.timeMs-this.transition.start)/450),smooth=t*t*(3-2*t);
    this.pose=t===1?copy(this.transition.to):Object.fromEntries(Object.keys(this.pose).map(key=>[key,this.transition.from[key]+(this.transition.to[key]-this.transition.from[key])*smooth]));
    if(this.timeMs>=this.nextBlink){this.blinkAt=this.nextBlink;this.nextBlink=this.timeMs+3000;}
  }
  frame(){
    const elapsed=this.timeMs-this.blinkAt;
    return {pose:copy(this.pose),effects:{gazeX:0,gazeY:0,talk:0,blink:elapsed>=0&&elapsed<180?Math.sin(Math.PI*elapsed/180):0}};
  }
}
module.exports={FaceRuntime};
