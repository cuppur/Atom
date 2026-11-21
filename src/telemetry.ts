import type { LastTurn, LiveMeter, TurnUsage } from './types';

export class TurnMeter {
  private bytes=0;
  private samples:{at:number;bytes:number}[]=[];
  readonly view:LiveMeter;
  constructor(estimatedInput:number,contextLimit:number,kind:LastTurn['kind'],private start=Date.now()) {
    this.view={estimatedInput,contextLimit,kind,estimatedOutput:0,lastDeltaAt:null,rate:null};
  }
  push(size:number,now=Date.now()){
    if(!size)return;
    const sample=this.samples.at(-1);
    if(!sample||now-sample.at>=100) this.samples.push({at:now,bytes:this.bytes});
    this.bytes+=size;
    while(this.samples.length>1&&this.samples[1].at<=now-3000)this.samples.shift();
    const first=this.samples[0];
    this.view.estimatedOutput=Math.ceil(this.bytes/3);
    this.view.lastDeltaAt=now;
    this.view.rate=Math.round((this.bytes-first.bytes)/3*1000/Math.max(250,now-first.at));
  }
  complete(usage:TurnUsage,now=Date.now()):LastTurn {
    const {estimatedInput,contextLimit,kind}=this.view;
    const elapsed=Math.max(1,now-this.start);
    return {...usage,estimatedInput,contextLimit,kind,rate:usage.output==null?null:Math.round(usage.output*1000/elapsed)};
  }
}

