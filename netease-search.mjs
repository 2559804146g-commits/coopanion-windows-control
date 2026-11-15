import { randomUUID } from 'node:crypto';
import { normalizeUiText } from './app-control.mjs';

const norm=s=>normalizeUiText(s).replace(/\s+/g,'').toLowerCase();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function parseSongs(observation){
  const nodes=observation.nodes||[],byId=new Map(nodes.map(n=>[n.id,n]));
  const inside=(child,parent)=>{let current=child;for(let i=0;i<30&&current;i++){if(current.parentId===parent.id)return true;current=byId.get(current.parentId);}return false;};
  return nodes.filter(n=>n.role===20&&(/^\d{1,3}\s/.test(n.name)||(/^(?:pause|play)\s/.test(n.name)&&byId.get(n.parentId)?.role===24))&&n.enabled&&!n.offscreen).map(row=>{
    const children=nodes.filter(n=>inside(n,row));const links=children.filter(n=>n.role===30&&n.name);
    const raw=row.name.replace(/^(?:\d{1,3}|pause|play)\s+/,'');
    const title=raw.split(/\s+(?:jymaster|sky|Tag:|MV\s+tagsmall)/)[0].trim();
    const titleNode=children.find(n=>n.role===41&&norm(n.name)===norm(title)&&!n.offscreen&&n.width>0);
    let titleBlock=titleNode;for(let i=0;i<12&&titleBlock&&titleBlock.parentId!==row.id;i++)titleBlock=byId.get(titleBlock.parentId);
    // Album links and performer links can arrive in different tree depths.
    // Identify the performer column below the actual title, not the first link.
    const artistLinks=titleNode&&titleBlock?links.filter(n=>n.x>=titleBlock.x&&n.x<titleBlock.x+titleBlock.width&&n.y>=titleNode.y+titleNode.height/2&&n.y<row.y+row.height*.75).sort((a,b)=>a.x-b.x):[];
    const artist=artistLinks.map(n=>n.name).join('/');
    return {title,artist,duration:row.name.match(/\b\d{2}:\d{2}\s*$/)?.[0]?.trim()||null,rowName:row.name,nodeId:titleNode?.id||null,enabled:!!titleNode};
  }).filter(r=>r.title&&r.duration);
}
export function exactSongMatch(candidate,title,artist){return candidate.enabled&&norm(candidate.title)===norm(title)&&(!artist||norm(candidate.artist)===norm(artist));}
export function explicitSongRequest(text){
  const match=String(text||'').match(/(?:播放|听|放首)\s*([^《》\n，。！？；]{1,40}?)的《([^》\n]{1,120})》/);
  return match?{artist:match[1].trim(),title:match[2].trim()}:null;
}

export class NeteaseSearch {
  constructor({apps,music,store}){Object.assign(this,{apps,music,store});this.results=new Map();}
  appId(){const id=this.store.state.musicAppId;if(!id)throw new Error('尚未选择网易云音乐');this.apps.access(id,true);return id;}
  requestMismatch(song,ctx){
    const request=this.store.state.requests?.find(r=>r.id===ctx.task?.requestId),expected=explicitSongRequest(request?.text);
    return expected&&(norm(song.title)!==norm(expected.title)||norm(song.artist)!==norm(expected.artist))?`参数与原始请求不一致，请逐字保留歌名「${expected.title}」和歌手「${expected.artist}」，不要改写或替换版本`:null;
  }
  remember(observation,title,artist){
    const results=parseSongs(observation).map(song=>{
      const resultId=randomUUID();this.results.set(resultId,{...song,resultId,snapshotId:observation.snapshotId,windowId:observation.windowId,appId:observation.appId,at:Date.now()});
      const {nodeId,rowName,...item}=song;return {...item,resultId,exactMatch:exactSongMatch(song,title,artist)};
    });
    if(this.results.size>100){const latest=new Set(results.map(r=>r.resultId));for(const id of this.results.keys())if(!latest.has(id))this.results.delete(id);}
    const exact=results.filter(r=>r.exactMatch);const bestMatch=exact[0]||null;
    return {query:[title,artist].filter(Boolean).join(' '),results,bestMatch,matchingVersions:exact.length,visibleOnly:true,observationTruncated:observation.truncated,note:bestMatch?'找到精确匹配，按网易云排序选择首项；尚未播放':'当前可见结果没有精确匹配，不自动改放翻唱或其他歌手'};
  }
  async search({title,artist=''},ctx){
    const mismatch=this.requestMismatch({title,artist},ctx);if(mismatch)return {ok:false,blocked:true,accepted:false,reason:mismatch};
    const appId=this.appId();const query=[title.trim(),artist.trim()].filter(Boolean).join(' ');
    return this.apps.session(async api=>{
      const windowId=await api.ensureWindow(appId,ctx);ctx.step.windowStateBefore={active:api.target(appId,windowId).active,windowId};this.store.save();let observation=await api.observe(appId,windowId);
      const editable=observation.nodes.filter(n=>n.role===42&&n.enabled&&!n.readOnly&&!n.protectedValue&&!n.offscreen);
      if(editable.length!==1)return {ok:false,blocked:true,reason:'没有识别到唯一的网易云搜索框，保留任务并重新观察'};
      if(ctx.interrupted())return {ok:false,blocked:true,reason:'任务已被打断'};
      const changed=await api.setText({appId,snapshotId:observation.snapshotId,nodeId:editable[0].id,text:query});
      if(!changed.verified)return changed;
      observation=changed.observation;const field=observation.nodes.find(n=>n.role===42&&n.value===query);
      if(!field||ctx.interrupted())return {ok:false,blocked:true,reason:'搜索框状态改变或任务已被打断'};
      const searchButton=observation.nodes.find(n=>n.role===43&&n.name==='search'&&n.enabled&&!n.offscreen);
      let submitted=searchButton?await api.invoke({appId,snapshotId:observation.snapshotId,nodeId:searchButton.id,expectText:query}):null;
      if(!submitted?.verified){observation=submitted?.observation||observation;const currentField=observation.nodes.find(n=>n.role===42&&n.value===query);if(!currentField)return {ok:false,blocked:true,reason:'搜索输入状态已变化'};submitted=await api.invoke({appId,snapshotId:observation.snapshotId,nodeId:currentField.id,expectText:query,enter:true});}
      if(!submitted.verified)return submitted;
      observation=submitted.observation;
      const tab=observation.nodes.find(n=>n.role===37&&n.name==='单曲'&&n.enabled&&!n.offscreen);
      if(!tab)return {ok:false,blocked:true,reason:'未发现实际单曲分页，不能把推荐内容当作搜索结果'};
      if(ctx.interrupted())return {ok:false,blocked:true,reason:'任务已被打断，搜索进度保留'};
      const listed=await api.invoke({appId,snapshotId:observation.snapshotId,nodeId:tab.id,expectText:'标题'});
      if(!listed.verified)return listed;
      observation=listed.observation;
      if(!parseSongs(observation).some(r=>exactSongMatch(r,title,artist))){await delay(400);observation=await api.observe(appId,windowId);}
      return {ok:true,verified:true,output:this.remember(observation,title,artist)};
    });
  }
  async play({resultId},ctx){
    const target=this.results.get(resultId);if(!target)return {ok:false,blocked:true,reason:'搜索结果已失效，请重新搜索；不能凭旧行号播放'};
    const mismatch=this.requestMismatch(target,ctx);if(mismatch)return {ok:false,blocked:true,accepted:false,reason:mismatch};
    this.appId();
    ctx.step.targetSong={title:target.title,artist:target.artist};this.store.save();
    const matches=state=>state?.available&&norm(state.title)===norm(target.title)&&norm(state.artist)===norm(target.artist)&&state.status==='Playing';
    const current=await this.music.run('status');if(matches(current.state))return {ok:true,verified:true,output:{state:current.state,alreadyPlaying:true}};
    if(ctx.interrupted())return {ok:false,blocked:true,reason:'任务已被打断'};
    return this.apps.session(async api=>{
      const result=await api.activateSong(target);if(!result.accepted)return {ok:false,blocked:true,reason:result.error||'未能选择该歌曲'};
      for(let i=0;i<8;i++){await delay(400);const observed=await this.music.run('status');if(matches(observed.state))return {ok:true,verified:true,output:{state:observed.state,selected:{title:target.title,artist:target.artist},controlTransport:result.transport}};if(ctx.interrupted())break;}
      return {ok:false,accepted:true,verified:false,reason:'已选择歌曲，但尚未核验对应歌手的实际播放；不重复点击，也不绕过版权或登录限制'};
    });
  }
  async recoverPlay(step){const expected=step.targetSong;if(!expected)return null;this.appId();const r=await this.music.run('status');return r.state?.status==='Playing'&&norm(r.state.title)===norm(expected.title)&&norm(r.state.artist)===norm(expected.artist)?{ok:true,verified:true,output:{state:r.state,recoveredFromObservation:true}}:null;}
}
