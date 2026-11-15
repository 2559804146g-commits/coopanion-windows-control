import {createWhaleFigure} from '/figure-assets/whale/figure.js';
import {createRig} from '/figure-assets/kit/rig.js';

const ns='http://www.w3.org/2000/svg';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Extend the existing articulated artwork; arms and tail are its real rig parts.
export async function createActingFigure(read,{reduced=()=>false}={}) {
  let current=null,typing=0,last=performance.now(),keypad,touchpad,keys=[],activeKey=-1;
  const frame=()=>{const now=Date.now();current=read();if(current?.until<=now)current=null;return current;};
  const figure=await createWhaleFigure(new URL('/figure-assets/whale/',location.origin),{scheme:'deepseek-maid',kit:{createRig(...args){
    const rig=createRig(...args),render=rig.render;
    rig.render=(st,options)=>{
      const c=current,age=c?(Date.now()-c.at)/1000:0,motion=reduced()?0:1;
      if(c?.kind==='listening')st.neck={...st.neck,a:(st.neck?.a||0)+Math.sin(performance.now()*.0018)*2*motion};
      if(typing>.005){
        const tapping=c?.kind==='typing'&&c.phase==='act'?Math.sin(performance.now()*.024)*3*motion:0;
        st.armNear={...st.armNear,a:st.armNear.a*(1-typing)+(-29+tapping)*typing};
        st.armFar={...st.armFar,a:st.armFar.a*(1-typing)+(-37-tapping)*typing};
        st.waist={...st.waist,a:(st.waist?.a||0)+typing*3};
      }
      if(c?.kind==='click'&&age<.85){
        const stroke=c.phase==='prepare'?42*Math.min(1,age/.22):-58*Math.exp(-age*7)+14*Math.exp(-age*2);
        st.tail={...st.tail,a:(st.tail?.a||0)+stroke*motion};
        st.body={...st.body,ty:(st.body?.ty||0)+(c.phase==='act'?Math.sin(Math.min(1,age/.32)*Math.PI)*2:0)*motion};
      }
      render(st,options);
    };return rig;
  }}});
  const draw=figure.draw;
  figure.draw=(root,face,body)=>{
    frame();const now=performance.now(),dt=Math.min(.06,(now-last)/1000);last=now;
    const want=current?.kind==='typing'?1:0;typing+=(want-typing)*(1-Math.exp(-dt*13));
    draw(root,face,body);
    if(!keypad){
      keypad=document.createElementNS(ns,'g');keypad.setAttribute('aria-hidden','true');keypad.setAttribute('class','acting-keyboard');
      keypad.innerHTML='<path d="M108 182L181 176L204 198L126 205Z" fill="#f0eee8" stroke="#263f71" stroke-width="1.8" stroke-linejoin="round"/><path d="M126 205L204 198L204 203L126 211L108 188L108 182" fill="#557da9" stroke="#263f71" stroke-width="1.5" stroke-linejoin="round"/><path d="M135 201L178 197" stroke="#8aabc4" stroke-width="3.5" stroke-linecap="round"/>';
      for(let r=0;r<3;r++)for(let col=0;col<9;col++){const k=document.createElementNS(ns,'path'),x=116+col*7.5+r*4.8,y=185+r*4.8-col*.62;k.setAttribute('d',`M${x} ${y}l5.4 -.4 3 2.8-5.5 .5Z`);k.setAttribute('fill','#809eb8');keys.push(k);keypad.append(k);}
    }
    if(keypad.parentNode!==root)root.append(keypad);
    if(!touchpad){touchpad=document.createElementNS(ns,'g');touchpad.setAttribute('aria-hidden','true');touchpad.innerHTML='<path d="M6 237L55 233L67 245L17 250Z" fill="#dbe6ef" stroke="#345681" stroke-width="1.5"/><path d="M17 250L67 245L67 249L17 254L6 241L6 237" fill="#6089ac" stroke="#345681" stroke-width="1.3"/><path class="tail-contact" d="M19 229L16 221M26 227L28 217M32 231L40 226" fill="none" stroke="#efb977" stroke-width="2.5" stroke-linecap="round"/>';}
    if(touchpad.parentNode!==root)root.append(touchpad);
    const click=current?.kind==='click'&&(Date.now()-current.at)<850;
    touchpad.style.opacity=click?'1':'0';touchpad.querySelector('.tail-contact').style.opacity=click&&current.phase==='act'?'1':'0';
    keypad.style.opacity=String(typing);keypad.setAttribute('transform',`translate(0 ${reduced()?0:(1-typing)*14})`);
    const index=current?.kind==='typing'&&current.phase==='act'&&!reduced()?Math.floor(now/85)%keys.length:-1;
    if(index!==activeKey){if(keys[activeKey])keys[activeKey].setAttribute('fill','#809eb8');if(keys[index])keys[index].setAttribute('fill','#f2ba77');activeKey=index;}
    root.dataset.action=current?.kind||'idle';root.dataset.actionPhase=current?.phase||'idle';
  };
  return figure;
}
