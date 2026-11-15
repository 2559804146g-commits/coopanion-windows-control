// Runs inside the original pet page. Native controls, skin, microphone and bubbles stay original.
export function createDesktopEcology(api){
  let ws,state=null,shown=true,sound=true,talk=true,volume=100,lastReport=0,lastTarget=null,revision=null,speechKey=null,connectedAt=0,lastPose=null,lastRoam=null,gesture=null,lastDraw=null,actHold=null,originalSpeech=false,lastAudioPolicy=null;
  let originalSounds={},retryAt=0;
  const audioPolicy=()=>{const full=!!state?.voiceOutput?.enabled,quiet=!!state?.ambient?.quiet,key=[full,talk,originalSpeech,sound,quiet,lastRoam].join(':');if(key!==lastAudioPolicy){lastAudioPolicy=key;api.audioPolicy({kinds:{...originalSounds,talk:talk&&!full},speech:originalSpeech&&!full,sound:sound&&!quiet,roam:quiet?'off':lastRoam||api.prefs().roam});}};
  let audio=null,ctx=null,source=null,analyser=null,samples=null,audioEvent=null,energy=0,playing=false,ended=null;
  const send=value=>{if(ws?.readyState===1)ws.send(JSON.stringify(value));};
  const action=value=>send({kind:'action',value});
  const stop=()=>{playing=false;energy=0;if(audio){audio.onended=audio.onplaying=audio.onerror=null;audio.pause();URL.revokeObjectURL(audio.src);audio.removeAttribute('src');audio.load();audio=null;}source?.disconnect();analyser?.disconnect();ctx?.close().catch(()=>{});ctx=source=analyser=null;};
  async function play(e){
    stop();if(!shown||!sound||!talk||volume<=0)return;
    const bytes=Uint8Array.from(atob(e.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    const item=audio=new Audio(url);audioEvent=e;item.volume=Math.max(0,Math.min(1,e.volume*volume/100));
    item.onplaying=()=>{if(audio!==item)return;playing=true;action({action:'voice-report',id:e.id,status:'playing'});};
    item.onended=()=>{if(audio!==item)return;playing=false;energy=0;ended=e.id;action({action:'voice-report',id:e.id,status:'ended'});};
    item.onerror=()=>{if(audio===item){playing=false;action({action:'voice-report',id:e.id,status:'error'});}};
    try{ctx=new AudioContext();source=ctx.createMediaElementSource(item);analyser=ctx.createAnalyser();analyser.fftSize=256;samples=new Uint8Array(analyser.fftSize);source.connect(analyser);analyser.connect(ctx.destination);await ctx.resume();await item.play();}
    catch{if(audio===item)action({action:'voice-report',id:e.id,status:'error'});}
  }
  function presentation(){
    const body=api.body(),prefs=api.prefs();
    send({kind:'presentation',value:{shown,sound,talk,volume,layout:body?.layout,skin:api.skin(),scale:prefs.scale,bubbleSize:prefs.bubbleSize,fontSize:prefs.fontSize,bubbleSpeed:prefs.bubbleSpeed,theme:prefs.theme,roam:prefs.roam,hoverButtons:prefs.hoverButtons,clickThrough:prefs.clickThrough,performance:state?.performance?.kind||null,draw:lastDraw,voice:{playing,ended,energy,id:audioEvent?.id,volume:audio?.volume}}});
  }
  function connect(){
    ws=new WebSocket('ws://127.0.0.1:17830/api/original-pet/socket');
    ws.onopen=()=>{connectedAt=Date.now();speechKey=null;state=null;presentation();};
    ws.onmessage=e=>{try{
      const m=JSON.parse(e.data);
      if(m.type==='state'){
        // Opening the base pet preserves its own remembered position; old targets do not seize it.
        if(!state)revision=m.value.revision;
        state=m.value;
        audioPolicy();
        const effect=state.performance;if(['click','typing'].includes(effect?.kind)&&effect.phase==='act')actHold={...effect,minUntil:Date.now()+180};
        const s=state.speech;
        if(s?.key?.startsWith('desktop:')&&s.at>=connectedAt&&s.key!==speechKey){speechKey=s.key;api.order({t:'say',id:s.key,beats:[{text:s.text,actions:[]}]});}
      }else if(m.type==='audio')void play(m);else if(m.type==='stop')stop();
    }catch{}};
    ws.onclose=()=>{state=null;stop();audioPolicy();setTimeout(connect,1000);};ws.onerror=()=>{};
  }
  connect();
  const result={
    prefs(p){
      if(typeof p.sound==='boolean')sound=p.sound;
      if(p.sounds)originalSounds={...originalSounds,...p.sounds};
      if(typeof p.sounds?.talk==='boolean')talk=p.sounds.talk;
      if(Number.isFinite(p.sounds?.volume))volume=p.sounds.volume;
      if(typeof p.speech?.enabled==='boolean')originalSpeech=p.speech.enabled;
      if(!sound||!talk||volume<=0)stop();else if(audio)audio.volume=Math.max(0,Math.min(1,(audioEvent?.volume??.85)*volume/100));
      if(p.roam!==undefined&&p.roam!==lastRoam){lastRoam=p.roam;revision=state?.revision;lastTarget=null;}
      presentation();
      audioPolicy();
    },
    get readoutEnabled(){return !!state?.voiceOutput?.enabled;},
    get quiet(){return !!state?.ambient?.quiet;},
    soundKinds(kinds){return {...kinds,talk:kinds.talk!==false&&!state?.voiceOutput?.enabled};},
    shown(value){shown=value;if(!shown)stop();presentation();},
    order(m){
      if(['walk','move','walk-stop','act'].includes(m.t)){revision=state?.revision;lastTarget=null;}
      if(m.t==='listen'||m.t==='said'){stop();action({action:'voice-stop'});}
    },
    bodyEvent(kind,d){
      if(kind==='ecology-draw'){lastDraw={...d,at:Date.now()};presentation();return;}
      if(kind==='interrupted'&&d.walkId==='ecology:'+revision&&d.by==='busy'){retryAt=Date.now()+250;return;}
      if(kind==='touch'&&['grab','drop','throw'].includes(d.kind)){lastTarget=null;revision=state?.revision;}
      if(kind==='touch'&&d.kind==='drop'){
        const l=api.body()?.layout,display=state?.displays.find(d=>window.screenX>=d.bounds.x-5&&window.screenX<d.bounds.x+d.bounds.width);
        if(l&&display)action({action:'drag-character',x:l.x+window.screenX,y:(l.y??innerHeight)+window.screenY,displayId:display.id});
      }
    },
    tick(){
      const body=api.body(),l=body?.layout;if(!body||!l||!state)return;
      const now=Date.now(),target=state.target,performance=actHold?.minUntil>now?actHold:state.performance?.until>now?state.performance:null;
      if(playing&&analyser){analyser.getByteTimeDomainData(samples);energy=Math.sqrt(samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/samples.length);if(energy>.012)body.talk();}
      body.set({ecology:performance});
      if(state.gesture?.id!==gesture&&state.gesture?.until>now){gesture=state.gesture.id;body.do(state.gesture.word);}
      const following=lastTarget&&target&&(target.kind!==lastTarget.kind||target.windowId!==lastTarget.windowId||Math.hypot(target.x-window.screenX-lastTarget.x,target.y-window.screenY-lastTarget.y)>8);
      const approach=performance?.windowId&&target?.kind==='window'&&performance.sequence!==lastTarget?.sequence;
      const retry=retryAt>0&&now>=retryAt&&!l.busy;
      if(shown&&!l.pressing&&target&&(revision!==state.revision||following||approach||retry)){
        retryAt=0;revision=state.revision;lastTarget={x:target.x-window.screenX,y:target.y-window.screenY,sequence:performance?.sequence,kind:target.kind,windowId:target.windowId};
        body.set({hold:30,ecologyTarget:lastTarget});body.move({to:'desktopEcologyAnchor'},'ecology:'+revision);
      }
      if(lastTarget&&!l.pressing){
        const distance=Math.hypot(l.x-lastTarget.x,(l.y??innerHeight)-lastTarget.y);
        if(distance<15){const pose=performance?({typing:'determined',click:'determined',observe:'look',verify:'thinking',success:'happy',blocked:'confused'})[performance.kind]:state.target.posture;
          if(pose&&pose!==lastPose){body.do(pose);lastPose=pose;}
        }
      }
      if(now-lastReport>500){
        lastReport=now;const display=state.displays.find(d=>window.screenX>=d.bounds.x-5&&window.screenX<d.bounds.x+d.bounds.width);
        if(display){const x=l.x+window.screenX,y=(l.y??innerHeight)+window.screenY;action({action:'character-report',revision:state.revision,x,y,displayId:display.id,arrived:shown&&!!lastTarget&&Math.hypot(l.x-lastTarget.x,(l.y??innerHeight)-lastTarget.y)<15});}
        presentation();
      }
    },
    debug:()=>({host:'original',connected:ws?.readyState===1,shown,playing,ended,energy,layout:api.body()?.layout,skin:api.skin()})
  };
  window.desktopEcologyDebug=result.debug;return result;
}
