import {randomUUID,createHash} from 'node:crypto';

// Persistent intentions belong to the shared persona, not a random action timer.
export class LifeRuntime {
  constructor(store,{clock=Date.now}={}) {
    this.store=store;this.clock=clock;store.state.life||={intentions:[],lastOpportunity:0,recentContexts:[],opportunities:[]};
    if(!store.state.life.initialCuriosity){
      store.state.life.initialCuriosity=true;
      store.state.life.intentions.push({id:randomUUID(),title:'认识现在生活的桌面',reason:'先看看有哪些允许使用的应用、现在正在进行什么，再决定自己想做的小事。',source:'initial-curiosity',status:'ready',createdAt:clock(),taskId:null});store.save();
    }
  }
  snapshot(){const s=this.store.state.life;return {intentions:s.intentions.slice(-12),lastOpportunity:s.lastOpportunity};}
  intend({title,reason},actor='model') {
    if(actor!=='model')throw new Error('自己的打算由同一角色提出');
    title=String(title||'').trim().slice(0,120);reason=String(reason||'').trim().slice(0,500);
    if(!title||!reason)throw new Error('需要说明想做什么和实际缘由');
    const list=this.store.state.life.intentions,old=list.find(i=>i.title===title&&!['done','abandoned'].includes(i.status));if(old)return old;
    if(list.filter(i=>!['done','abandoned'].includes(i.status)).length>=6)throw new Error('先完成或整理已有打算');
    const intention={id:randomUUID(),title,reason,status:'ready',createdAt:this.clock(),taskId:null};list.push(intention);this.store.state.life.intentions=list.slice(-30);this.store.save();return intention;
  }
  settle(tasks){
    let changed=false;
    for(const i of this.store.state.life.intentions){if(!i.taskId)continue;const t=tasks.find(t=>t.id===i.taskId);if(!t)continue;const status=t.status==='succeeded'?'done':t.status==='cancelled'?'resting':['blocked','uncertain','paused'].includes(t.status)?'waiting':'doing';if(status!==i.status){i.status=status;i.updatedAt=this.clock();changed=true;}}
    if(changed)this.store.save();
  }
  opportunity({autonomy,quiet,idleMs,connected,busy,tasks,music,resources}) {
    const now=this.clock(),s=this.store.state.life;
    if(now<(this.quietUntil||0))return null;
    const ready=s.intentions.find(i=>i.status==='ready');
    const firstCuriosity=ready?.source==='initial-curiosity'&&!ready.lastOpportunity;
    if(!autonomy||quiet||!connected||busy||(idleMs??0)<45000||tasks.some(t=>!['succeeded','cancelled'].includes(t.status))||(!firstCuriosity&&now-s.lastOpportunity<1200000))return null;
    const today=new Date(now).toISOString().slice(0,10);s.opportunities=s.opportunities.filter(at=>new Date(at).toISOString().slice(0,10)===today);if(s.opportunities.length>=4)return null;
    const context={intention:ready?.id||null,ownFiles:resources.filter(r=>r.category!=='验收').map(r=>r.id),song:music.available?[music.title,music.artist,music.status]:null};
    const fingerprint=createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0,20);
    if(s.recentContexts.includes(fingerprint))return null;
    // First acquaintance is one genuine opportunity. Later invitations need a
    // changed song, own document or a deliberately saved personal intention.
    if(!ready&&s.opportunities.length&&context.ownFiles.length===0&&!context.song)return null;
    s.lastOpportunity=now;if(ready)ready.lastOpportunity=now;s.opportunities.push(now);s.recentContexts.push(fingerprint);s.recentContexts=s.recentContexts.slice(-40);this.store.save();
    return {intention:ready||null,fingerprint,context};
  }
}
