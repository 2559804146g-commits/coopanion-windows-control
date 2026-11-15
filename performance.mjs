import { randomUUID } from 'node:crypto';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Transient embodiment of real execution. Never stored as memories or receipts.
export class PerformanceDirector {
  constructor({ changed=()=>{}, clock=Date.now, delay=wait }={}) { Object.assign(this,{changed,clock,delay}); this.current=null; this.history=[]; this.sequence=0; this.context=null; }
  cue(kind, details={}, duration=1800) {
    const event={id:randomUUID(),sequence:++this.sequence,kind,phase:'act',at:this.clock(),until:this.clock()+duration,...this.context,...details};
    this.current=event;this.history.push(event);this.history=this.history.slice(-160);this.changed(event);return event;
  }
  snapshot(){return this.current?.until>this.clock()?this.current:null;}
  task(event){
    if(event.phase==='start'){this.context={taskId:event.task.id,stepId:event.step.id};this.cue('thinking',{label:event.step.title},1200);}
    else {this.cue(event.result?.verified?'success':event.result?.deferred?'waiting':event.result?.blocked?'blocked':'verify',{label:event.step.title},1800);this.context=null;}
  }
  async perform(kind, details, operation) {
    const action=this.cue(kind,{...details,phase:'prepare'},30000);
    // One short anticipation before dispatch; outcomes still come only from the app.
    if(kind==='click')await this.delay(220);
    else if(kind==='typing')await this.delay(280);
    if(this.current?.id===action.id)this.cue(kind,{...details,id:action.id,phase:'act'},30000);
    try {const result=await operation();this.cue('verify',{...details,actionId:action.id},1200);return result;}
    catch(error){this.cue('blocked',{...details,actionId:action.id},1800);throw error;}
  }
}
