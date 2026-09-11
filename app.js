import { EXTRA_SHADERS, EXTRA_THEMES, EXTRA_PRESETS, TEXT_EFFECTS, THREE_TEXT, advanceClock, clockValue, safeNumber } from './effects.js';

/* ─────── Monitor identity & shared state ─────── */
const urlParams = new URLSearchParams(location.search);
const monitorIndex = (urlParams.get('monitor') === '2' ? 2 : 1);
const isMonitor2 = monitorIndex === 2;
document.getElementById('monitorBadge').textContent = 'Monitor ' + monitorIndex;

const LS = {
  get: (k,d)=>{ try{const v = localStorage.getItem(k); return v===null?d:v;}catch{return d;} },
  set: (k,v)=>{ try{ localStorage.setItem(k, String(v)); }catch(e){} }
};

let monitor1Width = parseFloat(LS.get('away_m1_width', innerWidth));
let monitor2Width = parseFloat(LS.get('away_m2_width', 0));
let monitor1Height = parseFloat(LS.get('away_m1_height', innerHeight));
let monitor2Height = parseFloat(LS.get('away_m2_height', innerHeight));
if(isMonitor2){ monitor2Width = innerWidth; monitor2Height = innerHeight; LS.set('away_m2_width', innerWidth); LS.set('away_m2_height', innerHeight); }
else { monitor1Width = innerWidth; monitor1Height = innerHeight; LS.set('away_m1_width', innerWidth); LS.set('away_m1_height', innerHeight); }

let sharedEpoch = parseFloat(LS.get('away_epoch', '0'));
if(!sharedEpoch){ sharedEpoch = Date.now(); LS.set('away_epoch', sharedEpoch); }

// Stable epoch for shader/particle time — never reset, so visuals never jump.
let visualEpoch = parseFloat(LS.get('away_vepoch', '0'));
if(!visualEpoch){ visualEpoch = Date.now(); LS.set('away_vepoch', visualEpoch); }

// Wrap the shared visual clock. u_t is a float32 on the GPU: once the
// persisted epoch is days old, sin/fract in the noise shaders run out of
// mantissa and the backgrounds fall apart into blocky, jerky garbage.
// Both windows wrap on the same shared epoch, so they stay frame-identical
// and the (rare) wrap jump happens on both screens in the same millisecond.
const T_WRAP_MS = 3600e3;
let motionClock={at:Date.now(),value:((Date.now()-visualEpoch)%T_WRAP_MS)/1000,speed:safeNumber(LS.get('away_motion','1'),.15,2.5,1),paused:LS.get('away_paused',matchMedia('(prefers-reduced-motion: reduce)').matches?'1':'0')==='1'};
let tickerClock={at:Date.now(),value:(Date.now()-sharedEpoch)/1000*safeNumber(LS.get('away_speed','140'),15,400,140),speed:safeNumber(LS.get('away_speed','140'),15,400,140),paused:motionClock.paused};
let quality=LS.get('away_quality','auto');
if(!['auto','eco','high'].includes(quality))quality='auto';
let fontRevision=0,stage=null,stageLoading=false,stageUnavailable=false,stageLost=false,lastFrame=0,lastStageKey='';
function sharedVisualT(){return clockValue(motionClock,Date.now())%3600;}
function tickerNow(){return clockValue(tickerClock,Date.now());}


/* Monitor-2 liveness. If the second window dies without its beforeunload
   (crash, killed tab, closed browser) the primary would keep a stale m2
   width forever and squash every background into half the world. m2 stamps
   a heartbeat; m1 discards its width when the heartbeat goes stale. */
const M2_FRESH_MS = 10000;
if(isMonitor2){
  LS.set('away_m2_seen', Date.now());
  setInterval(()=>LS.set('away_m2_seen', Date.now()), 3000);
}else{
  const seen = parseFloat(LS.get('away_m2_seen','0'));
  if(monitor2Width > 0 && (!seen || Date.now()-seen > M2_FRESH_MS)){
    monitor2Width = 0; monitor2Height = 0;
    LS.set('away_m2_width', 0); LS.set('away_m2_height', 0);
  }
  setInterval(()=>{
    if(monitor2Width > 0){
      const s = parseFloat(LS.get('away_m2_seen','0'));
      if(!s || Date.now()-s > M2_FRESH_MS){
        monitor2Width = 0; monitor2Height = 0;
        LS.set('away_m2_width', 0); LS.set('away_m2_height', 0);
        rebuildTicker(); pWorldChanged();
      }
    }
  }, 4000);
}

/* Motion studio controls. The original away display and dual-monitor protocol stay intact. */
function renderLetters(){
  msg.replaceChildren();msg.setAttribute('aria-label','Away message');
  let i=0;
  for(const part of origText.split(/(\s+)/)){
    if(/^\s+$/.test(part)){msg.append(document.createTextNode(part));continue;}
    const word=document.createElement('span');word.className='letter-word';
    const glyphs=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(part)].map(s=>s.segment):Array.from(part);
    for(const character of glyphs){const span=document.createElement('span');span.className='letter';span.textContent=character;span.style.setProperty('--i',i++);word.append(span);}
    msg.append(word);
  }
}
function saveMessage(){
  LS.set('away_msg',origText);document.getElementById('messageInput').value=origText;
  document.getElementById('messageCount').textContent=Array.from(origText).length+' / 280';
  rebuildTicker();pTextDirty=true;broadcast('message',{text:origText});
}
function receiveMessage(text){
  stopAnims();origText=String(text).slice(0,280);msg.textContent=origText;
  document.getElementById('messageInput').value=origText;document.getElementById('messageCount').textContent=Array.from(origText).length+' / 280';
  rebuildTicker();pTextDirty=true;startJsAnim(curAnim);
}
function refreshFallback(){
  const root=document.documentElement;
  root.style.setProperty('--a',document.getElementById('cShd').value);
  root.style.setProperty('--b',document.getElementById('cShdB').value);
  root.style.setProperty('--c',document.getElementById('cShdC').value);
}
function refreshSelection(){
  document.querySelectorAll('#bgList button').forEach((b,i)=>{b.classList.toggle('on',cur===i);b.setAttribute('aria-pressed',cur===i);});
  for(const [selector,key,value] of [['#animSeg','a',curAnim],['#scrollSeg','s',curScroll],['#pmodeSeg','p',pMode]]){
    document.querySelectorAll(selector+' button').forEach(b=>{const on=(b.dataset[key]||'')===value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  }
  document.querySelectorAll('#swList button').forEach(b=>{
    const th=THEMES.find(t=>t[0]===b.dataset.theme);
    const on=th&&th[3]===document.getElementById('cShd').value&&th[4]===document.getElementById('cShdB').value&&th[5]===document.getElementById('cShdC').value;
    b.classList.toggle('on',!!on);b.setAttribute('aria-pressed',!!on);
  });
  document.getElementById('sceneName').textContent=SHADERS[cur]?.name||'Away';
  document.getElementById('lookName').textContent=SHADERS[cur]?.name||'Away';
  const hint=document.getElementById('typeHint');
  if(hint)hint.textContent=curAnim==='a-sculpt'?'Sculpture uses a bold geometric typeface. Other 3D effects use your selected typeface.':curScroll?'Scrolling uses your selected typeface. Turn scrolling off to see centered 3D effects.':'3D effects use a centered message. Scrolling uses your selected typeface.';
  syncToggleStates();
}
function syncToggleStates(){document.querySelectorAll('.tgl').forEach(b=>b.setAttribute('aria-checked',b.classList.contains('on')));}
function togglePanel(open=!panel.classList.contains('open')){
  panel.classList.toggle('open',open);panel.inert=!open;document.body.classList.toggle('popen',open);
  const button=document.getElementById('tog');button.setAttribute('aria-expanded',open);button.setAttribute('aria-label',open?'Close studio':'Open studio');
  if(!open){document.activeElement?.blur();bumpIdle();}else{document.querySelector('.studio-tabs [aria-selected=true]').focus();}
}
function setMotion(speed,paused){
  const now=Date.now();motionClock=advanceClock(motionClock,now,safeNumber(speed,.15,2.5,1),!!paused);
  tickerClock=advanceClock(tickerClock,now,tickerSpeed,!!paused);
  applyMotionUI();broadcast('motion',{clock:motionClock,ticker:tickerClock});
}
function receiveMotion(data){
  if(!data?.clock||!data?.ticker)return;
  if(![data.clock.at,data.clock.value,data.clock.speed,data.ticker.at,data.ticker.value,data.ticker.speed].every(Number.isFinite))return;
  motionClock={...data.clock,speed:safeNumber(data.clock.speed,.15,2.5,1)};tickerClock={...data.ticker};applyMotionUI();
}
function applyMotionUI(){
  document.body.classList.toggle('motion-paused',motionClock.paused);
  document.documentElement.style.setProperty('--motion-speed',motionClock.speed);
  document.getElementById('motionR').value=motionClock.speed;document.getElementById('motionVal').textContent=motionClock.speed.toFixed(2)+'×';
  document.getElementById('pauseBtn').textContent=motionClock.paused?'Resume motion':'Pause motion';
  document.getElementById('dockPause').innerHTML=(motionClock.paused?'Resume':'Pause')+'<span>C</span>';
  document.getElementById('engineStatus').textContent=motionClock.paused?'Paused':!gl?'Compatibility':'Live';
  LS.set('away_motion',motionClock.speed);LS.set('away_paused',motionClock.paused?'1':'0');
}
function toggleMotion(){setMotion(motionClock.speed,!motionClock.paused);}
function frameStage(time){
  const background=SHADERS[cur]?.three??-1;
  const effect=THREE_TEXT.includes(curAnim)&&!curScroll&&document.activeElement!==msg&&pMode!=='text'?curAnim:'';
  const active=background>=0||effect;
  if(active&&!stage&&!stageLoading&&!stageUnavailable){
    stageLoading=true;
    import('./three-stage.js').then(({createStage})=>{
      stage=createStage(document.getElementById('threeCanvas'));stageUnavailable=!stage;
    }).catch(e=>{stageUnavailable=true;console.warn('Dimensional effects unavailable:',e.message);}).finally(()=>{stageLoading=false;});
  }
  if(stage&&!stageLost){
    const cs=getComputedStyle(msg);
    try{
      stage.frame({background,effect,text:origText,time,font:cs.fontFamily,fontRevision,fontSize:parseFloat(cs.fontSize),ink:document.getElementById('cInk').value,accent:document.getElementById('cAcc').value,colors:['cShd','cShdB','cShdC'].map(id=>document.getElementById(id).value),width:innerWidth,height:innerHeight,dpr:DPR,world:worldDims(),offset:monitorOffsetX(),panelWidth:document.body.classList.contains('popen')&&innerWidth>850?panel.getBoundingClientRect().width:0});
      document.body.classList.toggle('three-text-active',!!effect);
    }catch(e){stage.dispose();stage=null;stageUnavailable=true;document.body.classList.remove('three-text-active');console.warn('Dimensional effects paused:',e.message);}
  }else{document.body.classList.remove('three-text-active');}
  if(!gl||stageUnavailable||stageLost){
    const notice=document.getElementById('renderNotice');notice.hidden=false;
    notice.textContent=!gl?'Compatibility mode: animated color gradients are keeping your screen running. WebGL backgrounds and particles need hardware acceleration.':'3D effects are unavailable in this browser. Your message and other backgrounds still work.';
  }
}

let tickerSpeed = parseFloat(LS.get('away_speed', '140'));

function worldDims(){
  const w = (monitor1Width||innerWidth) + (monitor2Width||0);
  const h = Math.max(monitor1Height||innerHeight, monitor2Height||innerHeight);
  return {w, h};
}
function monitorOffsetX(){ return isMonitor2 ? (monitor1Width||0) : 0; }

/* ─────── Broadcast Channel Setup ─────── */
let bc = null;
try{
  bc = new BroadcastChannel('away_dual_sync');
  bc.onmessage = (e)=>{
    const {type,data} = e.data;
    if(type==='message') receiveMessage(data.text);
    if(type==='motion') receiveMotion(data);
    if(type==='animation') applyAnimFromSync(data);
    if(type==='scroll') applyScrollFromSync(data);
    if(type==='style') applyStyleFromSync(data);
    if(type==='size') applySizeFromSync(data);
    if(type==='font') applyFontFromSync(data);
    if(type==='shader') applyShaderFromSync(data);
    if(type==='width'){
      if(data.monitor===1){ monitor1Width = data.w; monitor1Height = data.h; }
      else { monitor2Width = data.w; monitor2Height = data.h; }
      rebuildTicker();
      pWorldChanged();
    }
    if(type==='click'){
      ckX = data.x; ckY = data.y;
      ckT = performance.now()/1000 - (Date.now() - data.t)/1000;
    }
    if(type==='mouse'){ if(data.monitor !== monitorIndex){ remoteMouse = data; } }
    if(type==='epoch'){ sharedEpoch = data.epoch; }
    if(type==='speed'){ tickerSpeed = data.speed; }
    if(type==='tempo'){ tickerClock=advanceClock(tickerClock,Date.now(),data.speed); sharedEpoch = data.epoch; tickerSpeed = data.speed; const spdR=document.getElementById('spdR'); const spdVal=document.getElementById('spdVal'); if(spdR){spdR.value=data.speed;spdVal.textContent=Math.round(data.speed);} }
    if(type==='backat'){ backAtTime = data.t || ''; const inp=document.getElementById('backAt'); if(inp) inp.value = backAtTime; updateCountdown(); }
    if(type==='fx'){ applyFx(data.grain, data.vignette, false); }
    if(type==='particles'){ setPMode(data.mode, data.morphStart, true); }
    if(type==='pdensity'){ setPDensity(data.d, true); }
    if(type==='cycle'){ setShuffle(data.on, true); }
    if(type==='audio'){ remoteBass = data.b; remoteBassAt = performance.now(); }
    if(type==='hello'){
      // a sibling came online — re-publish our state
      publishWidth();
      if(!isMonitor2){
        broadcast('message',{text: origText});
        broadcast('motion',{clock:motionClock,ticker:tickerClock});
        broadcast('epoch',{epoch: sharedEpoch});
        broadcast('speed',{speed: tickerSpeed});
        broadcast('scroll',{scroll: curScroll, epoch: sharedEpoch});
        broadcast('animation',{anim: curAnim});
        broadcast('shader',{index: cur});
        broadcast('particles',{mode: pMode, morphStart: pMorphStart});
        broadcast('pdensity',{d: LS.get('away_pdensity','mid')});
        broadcast('style', styleSnapshot());
        broadcast('fx',{grain:document.body.classList.contains('fx-grain'), vignette:document.body.classList.contains('fx-vignette')});
        broadcast('size',{fontSize: msg.style.fontSize ? parseInt(msg.style.fontSize) : null});
        broadcast('backat',{t: backAtTime});
        broadcast('cycle',{on: shuffleOn});
        const cs = getComputedStyle(msg);
        broadcast('font',{font: cs.fontFamily});
      }
    }
  };
}catch(err){
  console.warn('BroadcastChannel not available:', err);
}

function broadcast(type, data){
  if(bc) bc.postMessage({type, data});
}

function publishWidth(){
  const k_w = isMonitor2 ? 'away_m2_width' : 'away_m1_width';
  const k_h = isMonitor2 ? 'away_m2_height' : 'away_m1_height';
  if(isMonitor2){monitor2Width=innerWidth;monitor2Height=innerHeight;}else{monitor1Width=innerWidth;monitor1Height=innerHeight;}
  LS.set(k_w, innerWidth); LS.set(k_h, innerHeight);
  broadcast('width', {monitor: monitorIndex, w: innerWidth, h: innerHeight});
}

function showStatus(msg){
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  setTimeout(()=>{ bar.textContent = 'Ready'; }, 2000);
}

/* ─────── WebGL Boilerplate ─────── */
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl',{antialias:false});
let glLost=false;
gl?.getExtension('OES_standard_derivatives');
document.body.classList.toggle('no-webgl',!gl);

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const COMMON = `precision highp float;
uniform vec2 u_r;uniform vec2 u_world;uniform vec2 u_off;uniform float u_t;uniform vec2 u_m;uniform vec3 u_c;uniform vec3 u_c2;uniform vec3 u_c3;uniform float u_au;uniform vec3 u_ck;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){
  vec2 i=floor(p),f=fract(p);
  float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+vec2(1,1));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
`;

const SHADERS=[
{name:'Gradient Drift',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=uv;q.x*=ar;float t=u_t*.06;float w=fbm(q*1.6+t+(u_m-.5)*1.2);float g=uv.y*.6+uv.x*.2+w*.5;float cd=distance(uv,u_ck.xy);g+=sin(cd*32.-u_ck.z*7.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.22;float s=smoothstep(.05,1.05,g);vec3 col=mix(u_c*.48,u_c*1.18,s);col=mix(col,u_c2,s*s*.14);col+=u_c3*(1.-s)*.07;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Grid Field',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=uv;p.x*=ar;vec2 m=u_m;m.x*=ar;vec2 d=p-m;float dl=length(d);p-=normalize(d+1e-4)*exp(-dl*4.5)*.06;float cd=distance(uv,u_ck.xy);float rg=exp(-abs(cd-u_ck.z*.35)*22.)*exp(-u_ck.z*2.2);vec2 gv=abs(fract(p*26.)-.5);float dot=smoothstep(.46,.5,max(gv.x,gv.y));float ink=mix(.9,.32,(1.-dot)*.5);vec3 col=u_c*ink+u_c2*rg*.5;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Soft Noise',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=uv;q.x*=ar;float t=u_t*.04;float v=fbm(q*3.+vec2(t,t*.7))+fbm(q*7.-t)*.3;float ld=distance(uv,u_m);v=mix(v,v*1.6-.2,exp(-ld*ld*9.)*.7);float cd=distance(uv,u_ck.xy);v+=exp(-cd*cd*38.)*exp(-u_ck.z*1.8)*.38;float sv=smoothstep(.2,.85,v);vec3 col=mix(u_c*.72,u_c*1.14,sv);col=mix(col,u_c2,pow(sv,3.)*.16);col+=u_c3*(1.-sv)*.05;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Contour Lines',ext:true,src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=uv;q.x*=ar;vec2 m=u_m;m.x*=ar;float t=u_t*.05;float f=fbm(q*2.2+vec2(t*.6,t));f+=exp(-dot(q-m,q-m)*5.)*.24;float cd=distance(uv,u_ck.xy);f+=exp(-cd*cd*18.)*exp(-u_ck.z*2.)*.28;float l=f*16.;float e=fract(l);float w=fwidth(l)*1.5;float c=smoothstep(0.,w,e)*smoothstep(1.,1.-w,e);vec3 col=u_c*mix(.94,.36,1.-c)+u_c2*(1.-c)*.14;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Mono Liquid',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=uv;q.x*=ar;vec2 m=u_m;m.x*=ar;float t=u_t*.12;float md=distance(q,m);vec2 dp=q+(q-m)*exp(-md*3.5)*.18;float cd=distance(uv,u_ck.xy);float sh=sin(cd*40.-u_ck.z*9.)*exp(-cd*4.5)*exp(-u_ck.z*2.5);float s=fbm(dp*2.4+vec2(t,t*.5))+fbm(dp*5.-t*.7)*.4+sh*.3;float mt=pow(abs(sin(s*5.+t)),1.5);vec3 col=mix(u_c*.4,u_c*1.3,mt);col=mix(col,u_c2,pow(mt,4.)*.28);col+=u_c3*(1.-mt)*.05;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Liquid Chrome',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);vec2 m=vec2(u_m.x*ar,u_m.y);float t=u_t*.09;float n1=fbm(p*1.8+vec2(t*.6,t*.4));float n2=fbm(p*3.2-vec2(t*.3,t*.5));float n3=fbm(p*5.5+vec2(t*.7,-t*.3));vec2 dp=vec2(n1-.5,n2-.5)*.38;float md=length(p-m);dp+=(p-m)/max(md,.01)*exp(-md*3.5)*.16;float cd=length(uv-u_ck.xy);float sw=sin(cd*44.-u_ck.z*10.)*exp(-cd*5.)*exp(-u_ck.z*2.5);dp+=vec2(sw)*.07;float env=fbm((uv+dp)*2.5+vec2(t*.2));float v=n1*.42+n2*.33+n3*.25;v=smoothstep(.18,.82,v+env*.28);vec3 dark=mix(vec3(.04,.045,.06),u_c3,.12);vec3 mid=mix(vec3(.5,.54,.6),u_c,.3);vec3 bright=mix(vec3(.9,.93,.96),u_c,.18);vec3 col=mix(dark,mid,smoothstep(0.,.5,v));col=mix(col,bright,smoothstep(.5,1.,v));float iv=n3*2.+t*.14;float ir=pow(max(0.,1.-abs(fract(iv)-.5)*4.),2.);vec3 iri=vec3(.5+.5*sin(iv*6.28),.5+.5*sin(iv*6.28+2.09),.5+.5*sin(iv*6.28+4.19));col=mix(col,iri,ir*.2);float ca=fbm(uv*8.+t)*.015;col.r=mix(col.r,fbm((uv+dp+ca)*2.5+vec2(t*.2)),v*.3);gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Mesh Gradient',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float t=u_t*.1;vec2 p0=vec2(.15+sin(t*.7)*.12,.22+cos(t*.5)*.15);vec2 p1=vec2(.85+sin(t*.4)*.08,.25+cos(t*.9)*.18);vec2 p2=vec2(.5+sin(t*.55)*.2,.82+cos(t*.3)*.08);vec2 p3=vec2(.1+sin(t*.35)*.08,.72+cos(t*.6)*.12);vec2 p4=vec2(.75+sin(t*.8)*.12,.62+cos(t*.45)*.1);vec3 c0=mix(vec3(.85),u_c,.8);vec3 c1=mix(vec3(.8),u_c2,.62);vec3 c2=mix(vec3(.8),u_c3,.58);vec3 c3=mix(u_c,u_c3,.45)*.92;vec3 c4=mix(u_c2,u_c,.5)*.96;vec3 cm=u_c;float w0=1./max(dot(uv-p0,uv-p0),.0001);float w1=1./max(dot(uv-p1,uv-p1),.0001);float w2=1./max(dot(uv-p2,uv-p2),.0001);float w3=1./max(dot(uv-p3,uv-p3),.0001);float w4=1./max(dot(uv-p4,uv-p4),.0001);float wm=1./max(dot(uv-u_m,uv-u_m),.0001)*.32;float tot=w0+w1+w2+w3+w4+wm;vec3 col=(c0*w0+c1*w1+c2*w2+c3*w3+c4*w4+cm*wm)/tot;float cd=length(uv-u_ck.xy);col+=sin(cd*26.-u_ck.z*6.)*exp(-cd*4.)*exp(-u_ck.z*2.)*.055;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Aurora',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=vec2(uv.x*ar,uv.y);float t=u_t*.08;float n1=fbm(q*2.+vec2(t,0.));float n2=fbm(q*3.5-vec2(t*.7,t*.3));float band1=.55+sin(q.x*2.5+t)*.12+n1*.14;float band2=.42+sin(q.x*3.7-t*1.2)*.1+n2*.1;float band3=.68+cos(q.x*2.1+t*.6)*.09+n1*.12;float d1=exp(-pow((uv.y-band1)*5.5,2.));float d2=exp(-pow((uv.y-band2)*7.,2.));float d3=exp(-pow((uv.y-band3)*6.,2.));vec3 a1=u_c2;vec3 a2=mix(u_c2,u_c3,.55);vec3 a3=u_c3;vec3 base=mix(vec3(.02,.025,.06),mix(vec3(.06,.04,.12),u_c3*.22,.5),uv.y);vec3 col=base+a1*d1*.95+a2*d2*.8+a3*d3*.7;col+=u_c*.06*n1;float md=distance(uv,u_m);col+=u_c*.15*exp(-md*md*4.);float cd=distance(uv,u_ck.xy);col+=sin(cd*36.-u_ck.z*8.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.22;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Starfield',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);float t=u_t*.04;vec3 col=vec3(.012,.018,.038);for(float i=0.;i<4.;i++){float s=1.6+i*1.4;vec2 q=p*s+vec2(t*(.5+i*.25),sin(t*.4+i)*.04);vec2 id=floor(q);vec2 f=fract(q)-.5;float r=h(id+i*17.);if(r>.86){float d=length(f);float br=exp(-d*24.)*(.45+.55*sin(u_t*(.7+r*2.5)+r*30.));col+=u_c*br*(1.3-i*.22);}}col+=u_c*.05*fbm(p*1.3+vec2(t*.4,0.));col+=u_c3*.05*fbm(p*.8-vec2(t*.3,0.));float md=distance(uv,u_m);col+=u_c2*.15*exp(-md*md*6.);float cd=distance(uv,u_ck.xy);col+=sin(cd*40.-u_ck.z*9.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.22;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Nebula',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 q=vec2(uv.x*ar,uv.y);float t=u_t*.03;float n1=fbm(q*2.4+vec2(t,-t*.6));float n2=fbm(q*4.-vec2(t*.8,t*.4)+n1);float n3=fbm(q*7.+vec2(n2,n1)*1.3+vec2(t*.5,0.));vec3 col=vec3(.012,.014,.03);col+=u_c*smoothstep(.32,.95,n1)*.42;col+=u_c2*smoothstep(.42,.9,n2)*.5;col+=u_c3*smoothstep(.45,.95,n3)*.55;col+=vec3(1.)*pow(max(n3,0.),7.)*.3;float md=distance(uv,u_m);col+=u_c2*.16*exp(-md*md*5.);float cd=distance(uv,u_ck.xy);col+=sin(cd*36.-u_ck.z*8.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.18;col+=u_c3*u_au*.25*n2;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Silk Flow',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);float t=u_t*.07;vec2 m=vec2(u_m.x*ar,u_m.y);float md=distance(p,m);p+=(p-m)*exp(-md*3.)*.1;float a=fbm(p*1.7+vec2(t*.6,-t*.3));float b=fbm(p*2.3-vec2(t*.4,t*.5)+a*1.6);float s=.5+.5*sin((p.x+p.y)*4.+b*7.-t*2.);float s2=.5+.5*sin((p.x-p.y)*3.-a*6.+t*1.4);vec3 col=mix(u_c3*.22,u_c,pow(s,2.2));col=mix(col,u_c2,pow(s2,3.)*.6);col+=vec3(1.)*pow(s*s2,9.)*.22;col*=.55+.45*fbm(p*1.2+b);float cd=distance(uv,u_ck.xy);col+=sin(cd*40.-u_ck.z*9.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.16;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Lava Lamp',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);float t=u_t*.14;float f=0.;for(int i=0;i<7;i++){float fi=float(i);vec2 b=vec2((.5+sin(t*(.33+fi*.11)+fi*2.4)*.36)*ar,.5+cos(t*(.26+fi*.09)+fi*1.7)*.4);float rad=.075+.045*sin(fi*3.1+t*.6);f+=rad*rad/max(dot(p-b,p-b),1e-5);}vec2 m=vec2(u_m.x*ar,u_m.y);f+=.006/max(dot(p-m,p-m),1e-4);float cd=distance(uv,u_ck.xy);f+=exp(-cd*8.)*exp(-u_ck.z*2.)*.6;float body=smoothstep(.95,1.2,f);float rim=smoothstep(.55,.95,f)-body;vec3 col=u_c3*.13+u_c3*uv.y*.09;col=mix(col,u_c*.92,body);col+=u_c2*rim*.8;col+=u_c2*smoothstep(2.,3.6,f)*.3;col+=u_c2*u_au*.25*body;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Bokeh Drift',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);vec3 col=u_c3*.09+mix(u_c3,u_c,uv.y)*.07;for(int L=0;L<3;L++){float fl=float(L);float sc=2.6+fl*1.9;float dir=(L==1)?-1.:1.;vec2 q=p*sc+vec2(u_t*(.05+fl*.03)*dir,sin(u_t*.04+fl*2.1)*.25);vec2 id=floor(q);vec2 f=fract(q)-.5;float rn=h(id+fl*31.7);vec2 off=(vec2(h(id+7.1),h(id+13.7))-.5)*.6;float d=length(f-off);float rad=.10+rn*.16;float tw=.35+.65*(.5+.5*sin(u_t*(.25+rn*.9)+rn*40.));float glow=exp(-pow(d/rad,2.)*3.5)*tw;vec3 bc=rn>.66?u_c:(rn>.33?u_c2:u_c3);col+=bc*glow*(.34-fl*.09);}float md=distance(uv,u_m);col+=u_c2*.09*exp(-md*md*6.);float cd=distance(uv,u_ck.xy);col+=sin(cd*30.-u_ck.z*7.)*exp(-cd*4.)*exp(-u_ck.z*2.2)*.13;col+=u_c2*u_au*.15;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Stained Glass',src:`vec3 vor(vec2 p,float t){vec2 ip=floor(p);vec2 fp=fract(p);float md=8.;float m2=8.;vec2 mo=vec2(0.);for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 o=vec2(h(ip+g+3.1),h(ip+g+17.7));o=.5+.38*sin(t+o*6.2831);float dd=length(g+o-fp);if(dd<md){m2=md;md=dd;mo=ip+g;}else if(dd<m2){m2=dd;}}}return vec3(md,m2,h(mo*.13+7.7));}
void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y);vec3 v=vor(p*4.2+vec2(u_t*.06,0.),u_t*.4);float edge=1.-smoothstep(.0,.09,v.y-v.x);vec3 cell=mix(u_c3*.4,u_c,v.z);cell=mix(cell,u_c2,step(.72,v.z)*.65);vec3 col=cell*(.38+.55*(1.-v.x));col+=u_c2*edge*.7;col+=vec3(1.)*pow(max(1.-v.x,0.),8.)*.1;float md2=distance(uv,u_m);col+=u_c*.1*exp(-md2*md2*6.);float cd=distance(uv,u_ck.xy);col+=sin(cd*34.-u_ck.z*8.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.18;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Code Rain',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;float cols=floor(64.*ar);float ci=floor(uv.x*cols);float rn=h(vec2(ci,3.7));float sp=.05+rn*.13;float hp=fract(rn*7.3-u_t*sp);float d=fract(uv.y-hp);float len=.15+h(vec2(ci,9.1))*.35;float tr=exp(-d/len*5.5);float fx=fract(uv.x*cols);float cm=smoothstep(0.,.16,fx)*smoothstep(1.,.84,fx);float cell=floor(uv.y*90.);float g=step(.32,h(vec2(ci*7.1,cell+floor(mod(u_t,600.)*(6.+rn*8.)))));vec3 col=u_c3*.045;col+=u_c2*tr*g*cm;col+=mix(u_c2,vec3(1.),.7)*smoothstep(.03,.0,d)*g*cm;col+=u_c*.02;float md=distance(uv,u_m);col+=u_c2*.07*exp(-md*md*7.);float cd=distance(uv,u_ck.xy);col+=u_c2*exp(-cd*6.)*exp(-u_ck.z*2.5)*.3;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Hyperdrive',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 c=mix(vec2(.5),u_m,.35);vec2 d=uv-c;d.x*=ar;float r=max(length(d),1e-4);float a=atan(d.y,d.x);float seg=floor(a*38.197);float rn=h(vec2(seg,1.3));float rn2=h(vec2(seg,7.7));float sp=1.1+rn*2.3;float s=fract(.12/r-u_t*sp*.5+rn2*9.7);float star=pow(s,16.)*smoothstep(.015,.18,r);vec3 tint=mix(u_c2,u_c,rn);vec3 col=u_c3*.05+tint*star*(.55+.85*rn2);col+=u_c3*exp(-r*4.)*.45;col+=vec3(1.)*exp(-r*18.)*.5;col*=1.+u_au*.5;float cd=distance(uv,u_ck.xy);col+=sin(cd*40.-u_ck.z*10.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.18;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Retro Sun',ext:true,src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;float hor=.42;vec3 sky=mix(u_c3*.22,u_c3,pow(clamp((uv.y-hor)/(1.-hor),0.,1.),.75));sky=mix(sky,u_c2*.85,pow(max(1.-abs(uv.y-hor)*3.2,0.),2.)*.5);vec2 sc=vec2(.5,hor+.17);vec2 sd=uv-sc;sd.x*=ar;float sr=length(sd);vec3 suncol=mix(u_c,u_c2,clamp((sc.y-uv.y)*3.2+.5,0.,1.));float sun=smoothstep(.155,.15,sr);float bands=step(.3,fract(uv.y*36.+u_t*.7));sun*=mix(1.,bands,smoothstep(sc.y+.02,sc.y-.1,uv.y)*.95);vec3 col;if(uv.y>hor){col=mix(sky,suncol,sun);col+=u_c*.22*exp(-sr*6.)*(1.-sun*.6);}else{float py=hor-uv.y;float pz=.022/max(py,.002);float gx=(uv.x-.5)*pz*230.;float gz=pz*30.+u_t*3.;float wx=fwidth(gx)*1.3;float wz=fwidth(gz)*1.3;float lx=smoothstep(.5-min(wx,.45),.5,abs(fract(gx)-.5));float lz=smoothstep(.5-min(wz,.45),.5,abs(fract(gz)-.5));float grid=max(lx,lz)*clamp(py*9.,0.,1.);vec3 fl=mix(u_c3*.1,u_c3*.26,clamp(py*2.,0.,1.));col=fl+u_c2*grid*.85;col+=u_c*.3*exp(-py*8.);}float cd=distance(uv,u_ck.xy);col+=sin(cd*30.-u_ck.z*7.)*exp(-cd*4.5)*exp(-u_ck.z*2.3)*.14;col+=u_c2*u_au*.2;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
{name:'Plasma',src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float ar=u_r.x/u_r.y;vec2 p=vec2(uv.x*ar,uv.y)*3.;float t=u_t*.3;vec2 m=vec2(u_m.x*ar,u_m.y)*3.;float md=length(p-m);p+=(p-m)*exp(-md*1.1)*.3;float v=sin(p.x+t)+sin(p.y+t*.8)+sin(p.x+p.y+t*.55)+sin(length(p-vec2(1.5*ar,1.5))*2.2-t*1.1);v*=.25;float w=v*3.1416;vec3 col=u_c*(.42+.42*sin(w))+u_c2*(.38+.38*sin(w+2.094))+u_c3*(.38+.38*sin(w+4.188));col*=.62;col=pow(col,vec3(1.6))*1.5;float cd=distance(uv,u_ck.xy);col+=sin(cd*34.-u_ck.z*8.)*exp(-cd*5.)*exp(-u_ck.z*2.5)*.18;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`},
];

SHADERS.push(...EXTRA_SHADERS);
// Rewrite shader sources to sample in world UV so the pattern spans across both monitors.
SHADERS.forEach(s=>{
  s.src = s.src
    .replace(/gl_FragCoord\.xy\s*\/\s*u_r/g, '(gl_FragCoord.xy+u_off)/u_world')
    .replace(/u_r\.x\s*\/\s*u_r\.y/g, 'u_world.x/u_world.y');
});

function mk(type,src){
  const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error);}
  return shader;
}
function mkProg(fsrc){
  const p=gl.createProgram(),v=mk(gl.VERTEX_SHADER,VERT),f=mk(gl.FRAGMENT_SHADER,fsrc);
  gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(error);}
  return p;
}
let buf=null,progs=[];
function initGL(){
  if(!gl)return;
  buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  progs=new Array(SHADERS.length);
}
function programFor(index){
  if(progs[index])return progs[index];
  const s=SHADERS[index];let frag=COMMON;
  if(s.ext)frag='#extension GL_OES_standard_derivatives : enable\n'+frag;
  try{
    const p=mkProg(frag+s.src),loc={pos:gl.getAttribLocation(p,'p')};
    for(const key of ['r','world','off','t','m','c','c2','c3','au','ck'])loc[key]=gl.getUniformLocation(p,'u_'+key);
    return progs[index]={p,loc};
  }catch(e){
    console.warn('Background unavailable:',s.name,e.message);
    if(index!==6)return progs[index]=programFor(6);
    glLost=true;document.body.classList.add('no-webgl');return null;
  }
}
initGL();

// A long-running fullscreen app WILL eventually hit a GPU reset; without
// these handlers the background goes permanently black.
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();glLost=true;document.body.classList.add('no-webgl');});
canvas.addEventListener('webglcontextrestored',()=>{glLost=false;document.body.classList.remove('no-webgl');gl.getExtension('OES_standard_derivatives');initGL();resize();});

let cur=18;
let DPR=1;
function renderDPR(){const budget=quality==='eco'?1100000:quality==='high'?4200000:2300000;return Math.min(devicePixelRatio||1,quality==='high'?2:quality==='eco'?1:1.5,Math.sqrt(budget/(innerWidth*innerHeight)));}
function resize(){DPR=renderDPR();canvas.width=innerWidth*DPR;canvas.height=innerHeight*DPR;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';}
addEventListener('resize',resize);resize();

// mouse stored in world UV (0..1 spanning both monitors)
const mouse={x:.5,y:.5,tx:.5,ty:.5};
let remoteMouse=null, lastMouseBroadcast=0;
let ckX=.5,ckY=.5,ckT=-99;
function localToWorldUV(cx, cy){
  const wd = worldDims();
  return {x: (cx + monitorOffsetX()) / wd.w, y: 1 - cy / wd.h};
}
addEventListener('pointermove',e=>{
  const wuv = localToWorldUV(e.clientX, e.clientY);
  mouse.tx = wuv.x; mouse.ty = wuv.y;
  const now = performance.now();
  if(now - lastMouseBroadcast > 40){ lastMouseBroadcast = now; broadcast('mouse',{monitor:monitorIndex, x:wuv.x, y:wuv.y}); }
});
addEventListener('pointerdown',e=>{
  if(e.target.closest('#panel,#tog,#dock,[contenteditable]'))return;
  const wuv = localToWorldUV(e.clientX, e.clientY);
  ckX = wuv.x; ckY = wuv.y; ckT = performance.now()/1000;
  broadcast('click', {x:ckX, y:ckY, t:Date.now()});
});

let sCol=[.81,.79,.75],sCol2=[.31,.89,.63],sCol3=[.48,.36,1.];
let bri=1,sat=1;
let bass=0,remoteBass=0,remoteBassAt=0,lastAudioB=0,lastGrade='__init__';
var CYCLE_MS=30000; // var so tests can shorten the auto-cycle period
let shuffleOn=false;
let analyser=null,audioData=null,audioStream=null,audioCtx=null;

/* ═══════════ 3D PARTICLE ENGINE ═══════════
   All motion is computed on the GPU as a pure function of shared
   time + per-particle seeds, so every window derives identical
   world-space positions and the cloud crosses the seam seamlessly. */
const pCanvas=document.getElementById('pgl');
const pg=pCanvas.getContext('webgl',{antialias:false,alpha:true,depth:false});

const P_VERT=`
attribute vec3 aA;attribute vec3 aB;attribute vec3 aSeed;
uniform float uT;uniform float uMorph;uniform float uFree;
uniform vec2 uWorld;uniform vec2 uOff;uniform vec2 uRes;uniform float uDPR;
uniform vec2 uMouse;uniform vec3 uCk;uniform float uSpin;uniform float uSway;uniform float uSize;
varying float vDepth;varying float vTw;
vec3 freePos(vec3 s,float t){
  float sp=.13+s.x*.22;
  vec3 p;
  p.x=.5+sin(t*sp+s.y*6.283)*(.3+.12*sin(t*.05+s.z*6.283))+sin(t*.11)*.13;
  p.y=.5+sin(t*sp*1.31+s.z*6.283)*(.26+.1*cos(t*.07+s.x*6.283))+cos(t*.08)*.09;
  p.z=sin(t*sp*.83+s.x*6.283)*.5;
  return vec3(p.x*uWorld.x,p.y*uWorld.y,p.z*uWorld.y*.55);
}
void main(){
  float stag=clamp((uMorph-aSeed.z*.35)/.65,0.,1.);
  float e=stag*stag*(3.-2.*stag);
  vec3 shape=mix(aA,aB,e);
  shape.x+=sin(uT*(.5+aSeed.x)+aSeed.y*40.)*4.;
  shape.y+=cos(uT*(.4+aSeed.y)+aSeed.z*40.)*4.;
  shape.z+=sin(uT*(.6+aSeed.z)+aSeed.x*40.)*7.;
  vec3 pos=mix(shape,freePos(aSeed,uT),uFree);
  vec2 c=uWorld*.5;
  float ang=uT*uSpin+sin(uT*.42)*uSway;
  vec3 q=vec3(pos.x-c.x,pos.y-c.y,pos.z);
  float ca=cos(ang),sa=sin(ang);
  float rx=q.x*ca-q.z*sa;
  float rz=q.x*sa+q.z*ca;
  float f=1.15*uWorld.y+.35*uWorld.x;
  float per=f/(f+rz);
  vec2 sp2=vec2(rx*per+c.x,q.y*per+c.y);
  vec2 dm=sp2-uMouse;float dl=length(dm);
  sp2+=(dm/max(dl,.001))*exp(-dl/170.)*54.;
  vec2 ckp=uCk.xy*uWorld;float cd=distance(sp2,ckp);
  sp2+=((sp2-ckp)/max(cd,.001))*sin(cd*.022-uCk.z*6.)*exp(-cd*.0022)*exp(-uCk.z*.9)*26.;
  vec2 local=sp2-uOff;
  vec2 ndc=(local/uRes)*2.-1.;ndc.y=-ndc.y;
  gl_Position=vec4(ndc,0.,1.);
  gl_PointSize=max(1.,(1.1+2.3*aSeed.y)*per*per*uSize*uDPR);
  vDepth=clamp(per*per,0.,1.);
  vTw=.5+.5*sin(uT*(1.+aSeed.y*3.)+aSeed.x*40.);
}`;
const P_FRAG=`precision mediump float;
varying float vDepth;varying float vTw;
uniform vec3 uC1;uniform vec3 uC2;
void main(){
  vec2 uv=gl_PointCoord*2.-1.;float d=dot(uv,uv);
  if(d>1.)discard;
  float a=exp(-d*2.4)*(.3+.7*vTw)*mix(.28,1.,vDepth);
  vec3 col=mix(uC2,uC1,vDepth);
  gl_FragColor=vec4(col*a,a);
}`;

function pmk(type,src){const s=pg.createShader(type);pg.shaderSource(s,src);pg.compileShader(s);if(!pg.getShaderParameter(s,pg.COMPILE_STATUS))console.error(pg.getShaderInfoLog(s));return s;}
let pProg=null,pLoc=null,bufA=null,bufB=null,bufSeed=null;
function initPGL(){
  if(!pg)return;
  pProg=(()=>{const p=pg.createProgram();pg.attachShader(p,pmk(pg.VERTEX_SHADER,P_VERT));pg.attachShader(p,pmk(pg.FRAGMENT_SHADER,P_FRAG));pg.linkProgram(p);return p;})();
  pLoc={
    aA:pg.getAttribLocation(pProg,'aA'),aB:pg.getAttribLocation(pProg,'aB'),aSeed:pg.getAttribLocation(pProg,'aSeed'),
    uT:pg.getUniformLocation(pProg,'uT'),uMorph:pg.getUniformLocation(pProg,'uMorph'),uFree:pg.getUniformLocation(pProg,'uFree'),
    uWorld:pg.getUniformLocation(pProg,'uWorld'),uOff:pg.getUniformLocation(pProg,'uOff'),uRes:pg.getUniformLocation(pProg,'uRes'),
    uDPR:pg.getUniformLocation(pProg,'uDPR'),uMouse:pg.getUniformLocation(pProg,'uMouse'),uCk:pg.getUniformLocation(pProg,'uCk'),
    uSpin:pg.getUniformLocation(pProg,'uSpin'),uSway:pg.getUniformLocation(pProg,'uSway'),uSize:pg.getUniformLocation(pProg,'uSize'),
    uC1:pg.getUniformLocation(pProg,'uC1'),uC2:pg.getUniformLocation(pProg,'uC2'),
  };
  bufA=pg.createBuffer();bufB=pg.createBuffer();bufSeed=pg.createBuffer();
  if(pSeeds){ // context restore: re-upload the particle state we still hold in JS
    pg.bindBuffer(pg.ARRAY_BUFFER,bufSeed);pg.bufferData(pg.ARRAY_BUFFER,pSeeds,pg.STATIC_DRAW);
    pg.bindBuffer(pg.ARRAY_BUFFER,bufA);pg.bufferData(pg.ARRAY_BUFFER,pTargA,pg.DYNAMIC_DRAW);
    pg.bindBuffer(pg.ARRAY_BUFFER,bufB);pg.bufferData(pg.ARRAY_BUFFER,pTargB,pg.DYNAMIC_DRAW);
  }
}

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

const P_DENS={lo:3000,mid:9000,hi:16000};
let pCount=0,pSeeds=null,pTargA=null,pTargB=null;
let pMode='off',pMorphStart=0,pFreeFrom=0,pFreeTo=0,pFreeStart=0;
let pCycleIdx=-1,pTextDirty=true;
const P_CYCLE=['sphere','torus','helix','galaxy','wave','text'];
initPGL();
pCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();});
pCanvas.addEventListener('webglcontextrestored',()=>{initPGL();pResize();});

function pAlloc(n){
  if(!pg)return;
  pCount=n;
  pSeeds=new Float32Array(n*3);
  const r=mulberry32(1234567);
  for(let i=0;i<n*3;i++)pSeeds[i]=r();
  pTargA=new Float32Array(n*3);
  pTargB=new Float32Array(n*3);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufSeed);pg.bufferData(pg.ARRAY_BUFFER,pSeeds,pg.STATIC_DRAW);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufA);pg.bufferData(pg.ARRAY_BUFFER,pTargA,pg.DYNAMIC_DRAW);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufB);pg.bufferData(pg.ARRAY_BUFFER,pTargB,pg.DYNAMIC_DRAW);
}

/* ── deterministic shape generators (world px, y-down) ── */
function genShape(kind,n){
  const wd=worldDims();
  const cx=wd.w/2,cy=wd.h/2;
  const R=Math.min(wd.h*.36,wd.w*.22);
  const out=new Float32Array(n*3);
  const r=mulberry32(kind.length*7919+42);
  const GA=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<n;i++){
    let x=cx,y=cy,z=0;
    if(kind==='sphere'){
      const k=i+.5,ph=Math.acos(1-2*k/n),th=GA*i;
      x=cx+R*Math.sin(ph)*Math.cos(th);y=cy+R*Math.sin(ph)*Math.sin(th)*.92;z=R*Math.cos(ph);
    }else if(kind==='torus'){
      const u=(i/n)*Math.PI*2*7.13,v=r()*Math.PI*2,r2=R*.34;
      x=cx+(R*.78+r2*Math.cos(v))*Math.cos(u);
      y=cy+(R*.78+r2*Math.cos(v))*Math.sin(u)*.6;
      z=r2*Math.sin(v)+(R*.78+r2*Math.cos(v))*Math.sin(u)*.5;
    }else if(kind==='helix'){
      const strand=i%3,tt=i/n,ang=tt*Math.PI*6+strand*(Math.PI*2/3);
      x=cx+(tt-.5)*wd.w*.72;
      y=cy+Math.sin(ang)*wd.h*.2+(r()-.5)*8;
      z=Math.cos(ang)*wd.h*.2+(r()-.5)*8;
    }else if(kind==='galaxy'){
      const arm=i%3,tt=Math.pow(r(),.6),ang=tt*4.4+arm*(Math.PI*2/3)+(r()-.5)*.5*(1-tt);
      const rad=tt*R*1.18;
      x=cx+Math.cos(ang)*rad;y=cy+Math.sin(ang)*rad*.55;
      z=Math.sin(ang)*rad*.75+(r()-.5)*R*.12*(1-tt);
    }else if(kind==='wave'){
      const cols=Math.ceil(Math.sqrt(n*wd.w/wd.h)),rows=Math.ceil(n/cols);
      const gx=i%cols,gy=Math.floor(i/cols);
      x=(gx+.5)/cols*wd.w;y=cy+((gy+.5)/rows-.5)*wd.h*.5;
      z=Math.sin(gx/cols*Math.PI*4)*Math.cos(gy/rows*Math.PI*2)*wd.h*.14;
    }
    out[i*3]=x;out[i*3+1]=y;out[i*3+2]=z;
  }
  return out;
}

function genText(n){
  const wd=worldDims();
  const scale=Math.min(1,900/wd.w);
  const cw=Math.max(64,Math.round(wd.w*scale)),ch=Math.max(64,Math.round(wd.h*scale));
  const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;
  const c2=cv.getContext('2d',{willReadFrequently:true});
  const mEl=document.getElementById('msg');
  const txt=(origText||'').trim()||'AWAY';
  const fam=getComputedStyle(mEl).fontFamily;
  let fs=ch*.5;
  c2.font='600 '+fs+'px '+fam;
  const tw=c2.measureText(txt).width;
  if(tw>cw*.88){fs*=cw*.88/tw;c2.font='600 '+fs+'px '+fam;}
  c2.fillStyle='#fff';c2.textAlign='center';c2.textBaseline='middle';
  c2.fillText(txt,cw/2,ch/2);
  const img=c2.getImageData(0,0,cw,ch).data;
  const pts=[];
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    if(img[(y*cw+x)*4+3]>128)pts.push(x,y);
  }
  const out=new Float32Array(n*3);
  if(!pts.length)return genShape('sphere',n);
  const r=mulberry32(99173);
  for(let i=0;i<n;i++){
    const k=Math.floor(r()*(pts.length/2))*2;
    out[i*3]=pts[k]/scale+(r()-.5)*4;
    out[i*3+1]=pts[k+1]/scale+(r()-.5)*4;
    out[i*3+2]=(r()-.5)*30;
  }
  return out;
}

function pTargets(kind){return kind==='text'?genText(pCount):genShape(kind,pCount);}

function pSetTargets(arr,morphStart){
  if(!pg||!pTargA)return;
  pTargA.set(pTargB);
  pTargB.set(arr);
  pMorphStart=morphStart;
  pg.bindBuffer(pg.ARRAY_BUFFER,bufA);pg.bufferData(pg.ARRAY_BUFFER,pTargA,pg.DYNAMIC_DRAW);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufB);pg.bufferData(pg.ARRAY_BUFFER,pTargB,pg.DYNAMIC_DRAW);
}

function pResize(){pCanvas.width=innerWidth*DPR;pCanvas.height=innerHeight*DPR;pCanvas.style.width=innerWidth+'px';pCanvas.style.height=innerHeight+'px';}
addEventListener('resize',pResize);pResize();

const P_MORPH_MS=1700;
function particlesFrame(t){
  if(!pg||pg.isContextLost())return;
  if(pMode==='off'){pg.clearColor(0,0,0,0);pg.clear(pg.COLOR_BUFFER_BIT);return;}
  const nowMs=Date.now();
  if(pMode==='cycle'){
    const idx=Math.floor(sharedVisualT()/9)%P_CYCLE.length;
    if(idx!==pCycleIdx){
      pCycleIdx=idx;
      pSetTargets(pTargets(P_CYCLE[idx]),nowMs);
    }
  }
  if(pTextDirty&&(pMode==='text'||(pMode==='cycle'&&P_CYCLE[pCycleIdx]==='text'))){
    pTextDirty=false;
    pSetTargets(genText(pCount),pMorphStart);
  }
  const morph=motionClock.paused?1:Math.min(1,(nowMs-pMorphStart)/P_MORPH_MS);
  const freeP=motionClock.paused?1:Math.min(1,(nowMs-pFreeStart)/P_MORPH_MS);
  const free=pFreeFrom+(pFreeTo-pFreeFrom)*(freeP*freeP*(3-2*freeP));
  const wd=worldDims();
  const isText=pMode==='text'||(pMode==='cycle'&&P_CYCLE[pCycleIdx]==='text');
  pg.viewport(0,0,pCanvas.width,pCanvas.height);
  pg.clearColor(0,0,0,0);pg.clear(pg.COLOR_BUFFER_BIT);
  pg.useProgram(pProg);
  pg.enable(pg.BLEND);pg.blendFunc(pg.SRC_ALPHA,pg.ONE);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufA);pg.enableVertexAttribArray(pLoc.aA);pg.vertexAttribPointer(pLoc.aA,3,pg.FLOAT,false,0,0);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufB);pg.enableVertexAttribArray(pLoc.aB);pg.vertexAttribPointer(pLoc.aB,3,pg.FLOAT,false,0,0);
  pg.bindBuffer(pg.ARRAY_BUFFER,bufSeed);pg.enableVertexAttribArray(pLoc.aSeed);pg.vertexAttribPointer(pLoc.aSeed,3,pg.FLOAT,false,0,0);
  const sharedT=sharedVisualT();
  pg.uniform1f(pLoc.uT,sharedT);
  pg.uniform1f(pLoc.uMorph,morph);
  pg.uniform1f(pLoc.uFree,free);
  pg.uniform2f(pLoc.uWorld,wd.w,wd.h);
  pg.uniform2f(pLoc.uOff,monitorOffsetX(),0);
  pg.uniform2f(pLoc.uRes,innerWidth,innerHeight);
  pg.uniform1f(pLoc.uDPR,DPR);
  pg.uniform2f(pLoc.uMouse,mouse.x*wd.w,(1-mouse.y)*wd.h);
  const age=performance.now()/1000-ckT;
  pg.uniform3f(pLoc.uCk,ckX,1-ckY,Math.min(age,8));
  pg.uniform1f(pLoc.uSpin,(isText||pMode==='wave')?0:.22);
  pg.uniform1f(pLoc.uSway,isText?.05:(pMode==='wave'?.12:0));
  pg.uniform1f(pLoc.uSize,3.4*(1+bass*.8));
  const acc=h2rgb(document.getElementById('cAcc').value);
  const ink=h2rgb(document.getElementById('cInk').value);
  pg.uniform3f(pLoc.uC1,ink[0],ink[1],ink[2]);
  pg.uniform3f(pLoc.uC2,acc[0]*.85,acc[1]*.85,acc[2]*.85);
  pg.drawArrays(pg.POINTS,0,pCount);
}

function setPMode(mode,morphStart,fromSync){
  const prev=pMode;
  pMode=mode;
  pCycleIdx=-1;
  const ms=morphStart||Date.now();
  document.querySelectorAll('#pmodeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.p===mode));
  LS.set('away_pmode',mode);
  const wasFree=prev==='swarm',isFree=mode==='swarm';
  if(wasFree!==isFree){pFreeFrom=wasFree?1:0;pFreeTo=isFree?1:0;pFreeStart=ms;}
  if(mode!=='off'&&mode!=='swarm'&&mode!=='cycle'){
    pSetTargets(pTargets(mode),ms);
  }
  document.body.classList.toggle('ptext', mode==='text'&&!!pg);
  refreshSelection();
  if(!fromSync)broadcast('particles',{mode,morphStart:ms});
}

function setPDensity(d,fromSync){
  const n=P_DENS[d]||P_DENS.mid;
  document.querySelectorAll('#pdenSeg button').forEach(b=>b.classList.toggle('on',b.dataset.d===d));
  LS.set('away_pdensity',d);
  pAlloc(n);
  pCycleIdx=-1;
  if(pMode!=='off'&&pMode!=='swarm'&&pMode!=='cycle')pSetTargets(pTargets(pMode),Date.now()-P_MORPH_MS);
  if(!fromSync)broadcast('pdensity',{d});
}

/* world size changed → all world-space targets are stale */
function pWorldChanged(){
  pCycleIdx=-1;
  pTextDirty=true;
  if(pMode!=='off'&&pMode!=='swarm'&&pMode!=='cycle')pSetTargets(pTargets(pMode),Date.now()-P_MORPH_MS);
  updateVignette();
}

/* vignette spans the combined world so it doesn't draw a seam per window */
function updateVignette(){
  const wd=worldDims(),off=monitorOffsetX();
  const v=document.getElementById('vignette');
  v.style.background='none';
  v.style.backgroundImage='radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.34) 100%)';
  v.style.backgroundSize=wd.w+'px '+wd.h+'px';
  v.style.backgroundPosition=(-off)+'px 0';
  v.style.backgroundRepeat='no-repeat';
}

const msg3d=document.getElementById('msg3d');
const msg=document.getElementById('msg');
let rx=0,ry=0,trx=0,try_=0;
let curAnim='',curScroll='',origText=msg.textContent;
let glitchTimer=null,glitchInner=null,typeTimer=null;

addEventListener('pointermove',e=>{const cx=e.clientX/innerWidth-.5,cy=e.clientY/innerHeight-.5;trx=-cy*9;try_=cx*9;});
addEventListener('mouseleave',()=>{trx=0;try_=0;});

function loop(){
  requestAnimationFrame(loop);
  const now=performance.now();
  if(document.hidden||now-lastFrame<1000/(quality==='eco'?30:quality==='high'?60:45))return;
  lastFrame=now;
  // shared wall-clock time so both monitors render the same shader frame
  const t=sharedVisualT();
  const age=now/1000-ckT;

  mouse.x+=(mouse.tx-mouse.x)*.065;
  mouse.y+=(mouse.ty-mouse.y)*.065;

  // Auto-cycle: shader index derives from the wall clock, so every window
  // lands on the same shader at the same instant with zero messaging.
  let dim=1;
  if(shuffleOn&&!motionClock.paused){
    const nms=clockValue(motionClock,Date.now())*1000;
    const idx=Math.floor(nms/CYCLE_MS)%SHADERS.length;
    if(idx!==cur){ cur=idx; refreshSelection(); }
    const edge=Math.min(nms%CYCLE_MS, CYCLE_MS-nms%CYCLE_MS);
    dim=Math.min(1,edge/700); dim=dim*dim*(3-2*dim); dim=.12+.88*dim;
  }

  // Audio pulse: local mic if enabled, otherwise the level the other
  // monitor broadcasts, decaying to zero when neither is live.
  if(motionClock.paused){bass=0;}else if(analyser){
    analyser.getByteFrequencyData(audioData);
    let s=0; for(let i=1;i<8;i++) s+=audioData[i];
    const raw=s/(7*255);
    bass+=(raw-bass)*(raw>bass?.4:.12);
    if(now-lastAudioB>120){ lastAudioB=now; broadcast('audio',{b:+bass.toFixed(3)}); }
  }else if(remoteBassAt && now-remoteBassAt<700){
    bass+=(remoteBass-bass)*.25;
  }else{
    bass*=.94; if(bass<.003) bass=0;
  }

  // Color grade (brightness/saturation) + shuffle dip + audio pump applied
  // as a compositor filter — works on every shader with zero GLSL cost.
  const pump=1+bass*.35;
  const fb=(bri*dim*pump).toFixed(2), fs=sat.toFixed(2);
  const grade=(fb==='1.00'&&fs==='1.00')?'':`brightness(${fb}) saturate(${fs})`;
  if(grade!==lastGrade){
    lastGrade=grade;
    canvas.style.filter=grade;document.getElementById('fallback').style.filter=grade;
    pCanvas.style.filter=grade?`brightness(${(bri*pump).toFixed(2)}) saturate(${fs})`:'';
  }

  if(gl&&!glLost){
  const g=programFor(cur);
  if(g){
  const wd = worldDims();
  const offPx = monitorOffsetX() * DPR;
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(g.p);
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.enableVertexAttribArray(g.loc.pos);
  gl.vertexAttribPointer(g.loc.pos,2,gl.FLOAT,false,0,0);
  gl.uniform2f(g.loc.r,canvas.width,canvas.height);
  if(g.loc.world) gl.uniform2f(g.loc.world, wd.w*DPR, wd.h*DPR);
  if(g.loc.off) gl.uniform2f(g.loc.off, offPx, 0);
  gl.uniform1f(g.loc.t,t);
  gl.uniform2f(g.loc.m,mouse.x,mouse.y);
  gl.uniform3f(g.loc.c,sCol[0],sCol[1],sCol[2]);
  if(g.loc.c2)gl.uniform3f(g.loc.c2,sCol2[0],sCol2[1],sCol2[2]);
  if(g.loc.c3)gl.uniform3f(g.loc.c3,sCol3[0],sCol3[1],sCol3[2]);
  if(g.loc.au)gl.uniform1f(g.loc.au,bass);
  gl.uniform3f(g.loc.ck,ckX,ckY,Math.min(age,8));
  gl.drawArrays(gl.TRIANGLES,0,3);
  }
  }

  particlesFrame(t);
  frameStage(t);
  updateTicker();

  const scrollOn=!!curScroll;
  const tr=scrollOn||motionClock.paused?0:trx,ty=scrollOn||motionClock.paused?0:try_;
  rx+=(tr-rx)*.07;ry+=(ty-ry)*.07;

  const floatY=(curAnim==='a-float')?Math.sin(t*1.45)*14:0;
  msg3d.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg) translateY(${floatY}px) scale(${(1+bass*.05).toFixed(3)})`;

  if(curAnim==='a-pulse'){msg3d.style.opacity=String(.25+.75*(.5+.5*Math.sin(t*2.0)));}else{msg3d.style.opacity='';}

}
requestAnimationFrame(loop);

function tick(){const d=new Date();document.getElementById('clock').textContent=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});updateCountdown();}

/* ─────── Back-at countdown ─────── */
let backAtTime = LS.get('away_backat','');
function updateCountdown(){
  const el = document.getElementById('countdown');
  if(!backAtTime){ el.classList.remove('show'); return; }
  const [hh,mm] = backAtTime.split(':').map(Number);
  const now = new Date();
  const target = new Date(now); target.setHours(hh,mm,0,0);
  let diff = target - now;
  if(diff < -12*3600e3){ target.setDate(target.getDate()+1); diff = target - now; }
  const tstr = target.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if(diff <= 0){ el.innerHTML = 'Back <b>any moment now</b>'; }
  else {
    const h = Math.floor(diff/3600e3), m = Math.floor(diff%3600e3/60e3), s = Math.floor(diff%60e3/1e3);
    const left = h>0 ? h+'h '+m+'m' : m>0 ? m+'m '+String(s).padStart(2,'0')+'s' : s+'s';
    el.innerHTML = 'Back at <b>'+tstr+'</b> &nbsp;&middot;&nbsp; '+left;
  }
  el.classList.add('show');
}
tick();setInterval(tick,1000);

function stopAnims(){clearInterval(glitchTimer);clearInterval(glitchInner);clearInterval(typeTimer);glitchTimer=glitchInner=typeTimer=null;msg.classList.remove('glitching');msg.textContent=origText;}

function runGlitch(){const chars='!<>-_\\/[]{}=+*^?#§±~';function scramble(){clearInterval(glitchInner);let i=0;glitchInner=setInterval(()=>{if(motionClock.paused||document.activeElement===msg)return;msg.textContent=origText.split('').map((_,j)=>{if(j<i)return origText[j];return chars[Math.floor(Math.random()*chars.length)];}).join('');if(++i>origText.length){clearInterval(glitchInner);glitchInner=null;msg.textContent=origText;}},52);}scramble();glitchTimer=setInterval(scramble,3000+Math.random()*1600);}

function runType(){
  let phase=0,i=0; // 0 typing, 1 holding, 2 deleting
  clearInterval(typeTimer);
  typeTimer=setInterval(()=>{
    if(motionClock.paused||document.activeElement===msg)return;
    if(phase===0){ i++; msg.textContent=origText.slice(0,i)+'_'; if(i>=origText.length){phase=1;i=0;msg.textContent=origText;} }
    else if(phase===1){ if(++i>42){phase=2;i=origText.length;} }
    else { i--; msg.textContent=origText.slice(0,Math.max(0,i))+'_'; if(i<=0){phase=0;i=0;} }
  },80);
}

function startJsAnim(a){
  if(a==='a-wave'||a==='a-bounce')renderLetters();
  if(a==='a-glitch'){origText=msg.textContent;runGlitch();}
  if(a==='a-type'){origText=msg.textContent;runType();}
}

function setAnim(a){
  stopAnims();
  if(curAnim) document.body.classList.remove(curAnim);
  curAnim=a;
  if(a)document.body.classList.add(a);
  startJsAnim(a);
  refreshSelection();
  LS.set('away_anim', a);
  broadcast('animation',{anim:a});
}

function setScroll(s){
  if(curScroll) document.body.classList.remove(curScroll);
  curScroll=s;
  if(s){
    document.body.classList.add(s);
    sharedEpoch = Date.now();
    tickerClock={at:Date.now(),value:0,speed:tickerSpeed,paused:motionClock.paused};
    broadcast('motion',{clock:motionClock,ticker:tickerClock});
    LS.set('away_epoch', sharedEpoch);
    broadcast('epoch',{epoch: sharedEpoch});
  }
  rebuildTicker();
  LS.set('away_scroll', s);
  broadcast('scroll',{scroll:s, epoch: sharedEpoch});
}

function applyAnimFromSync(data){stopAnims();if(curAnim)document.body.classList.remove(curAnim);curAnim=data.anim;if(data.anim)document.body.classList.add(data.anim);startJsAnim(data.anim);refreshSelection();}

function applyScrollFromSync(data){
  if(curScroll) document.body.classList.remove(curScroll);
  curScroll=data.scroll;
  if(data.scroll)document.body.classList.add(data.scroll);
  if(data.epoch) sharedEpoch = data.epoch;
  rebuildTicker();
}

function applyStyleFromSync(data){
  if(data.inkColor){document.documentElement.style.setProperty('--ink',data.inkColor);const el=document.getElementById('cInk');if(el)el.value=data.inkColor;}
  if(data.accentColor){document.documentElement.style.setProperty('--accent',data.accentColor);const el=document.getElementById('cAcc');if(el)el.value=data.accentColor;}
  if(data.shaderCol){const c=data.shaderCol;sCol=[c.r,c.g,c.b];}
  if(data.aHex){const el=document.getElementById('cShd');if(el)el.value=data.aHex;}
  if(data.c2){sCol2=h2rgb(data.c2);const el=document.getElementById('cShdB');if(el)el.value=data.c2;}
  if(data.c3){sCol3=h2rgb(data.c3);const el=document.getElementById('cShdC');if(el)el.value=data.c3;}
  if(typeof data.bri==='number'){bri=data.bri;const el=document.getElementById('cBri');if(el){el.value=Math.round(bri*100);document.getElementById('briVal').textContent=bri.toFixed(2);}}
  if(typeof data.sat==='number'){sat=data.sat;const el=document.getElementById('cSat');if(el){el.value=Math.round(sat*100);document.getElementById('satVal').textContent=sat.toFixed(2);}}
  syncTickerStyle();refreshFallback();
}

function applySizeFromSync(data){if(data.fontSize){msg.style.fontSize=data.fontSize+'px';document.getElementById('szVal').textContent=data.fontSize+'px';document.getElementById('szR').value=data.fontSize;}else{msg.style.fontSize='';document.getElementById('szVal').textContent='Auto';document.getElementById('szR').value=72;}rebuildTicker();}

function applyFontFromSync(data){if(data.font){msg.style.fontFamily=data.font;}rebuildTicker();pTextDirty=true;refreshSelection();}
function applyShaderFromSync(data){if(Number.isInteger(data.index)&&SHADERS[data.index]){cur=data.index;refreshSelection();}}

msg.addEventListener('input',()=>{
  origText=msg.innerText.slice(0,280);saveMessage();
});
msg.addEventListener('focus',()=>{stopAnims();});
msg.addEventListener('blur',()=>{origText=msg.innerText.slice(0,280);saveMessage();startJsAnim(curAnim);});
msg.addEventListener('paste',e=>{e.preventDefault();const text=(e.clipboardData.getData('text/plain')||'').slice(0,280);document.execCommand('insertText',false,text);});

/* ─────── Ticker ─────── */
const tickerTrack = document.getElementById('tickerTrack');
let cycleW = 0;

function syncTickerStyle(){
  const cs = getComputedStyle(msg);
  tickerTrack.style.fontFamily = cs.fontFamily;
  tickerTrack.style.fontSize = cs.fontSize;
  tickerTrack.style.fontWeight = cs.fontWeight;
  tickerTrack.style.letterSpacing = cs.letterSpacing;
  tickerTrack.style.color = cs.color;
}

function rebuildTicker(){
  syncTickerStyle();
  const txt = (origText || '').trim() || ' ';
  // probe
  tickerTrack.innerHTML = '';
  const probe = document.createElement('span');
  probe.className = 'ticker-item';
  probe.textContent = txt;
  tickerTrack.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  cycleW = Math.max(40, w);
  const wd = worldDims();
  const totalNeeded = Math.max(wd.w * 2, innerWidth * 3);
  const n = Math.max(4, Math.ceil(totalNeeded / cycleW) + 3);
  tickerTrack.innerHTML = '';
  for(let i=0;i<n;i++){
    const s = document.createElement('span');
    s.className = 'ticker-item';
    s.textContent = txt;
    tickerTrack.appendChild(s);
  }
}

function updateTicker(){
  if(!curScroll){ tickerTrack.style.transform = 'translate3d(0,-50%,0)'; return; }
  if(!cycleW) rebuildTicker();
  if(!cycleW) return;
  const elapsedMs = tickerNow();
  const dir = curScroll === 'scroll-left' ? +1 : -1;
  const viewer = dir * elapsedMs;
  const off = monitorOffsetX();
  const raw = viewer + off;
  const m = ((raw % cycleW) + cycleW) % cycleW;
  tickerTrack.style.transform = `translate3d(${-m}px,-50%,0)`;
}

const panel=document.getElementById('panel');
document.getElementById('tog').onclick=()=>togglePanel();

const bgList=document.getElementById('bgList');
SHADERS.forEach((s,i)=>{
  const b=document.createElement('button');
  b.dataset.group=s.group||(['Grid Field','Contour Lines','Code Rain','Retro Sun'].includes(s.name)?'Funky':'Organic');
  b.innerHTML=`<span class="bg-thumb thumb-${i%8}"></span><span>${s.name}</span><span class="t">${s.three!==undefined?'3D':String(i+1).padStart(2,'0')}</span>`;
  if(i<30){b.querySelector('.bg-thumb').style.backgroundImage=`url('/previews/${String(i).padStart(2,'0')}.webp')`;b.querySelector('.bg-thumb').style.backgroundSize='cover';}
  if(i===cur)b.classList.add('on');
  b.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    pickShader(i);
    showStatus('Shader · '+s.name);
  });
  bgList.appendChild(b);
});

document.getElementById('scrollSeg').querySelectorAll('button').forEach(b=>{
  b.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('scrollSeg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    setScroll(b.dataset.s);
  });
});

TEXT_EFFECTS.concat([['a-drift','Drift']]).forEach(([id,name])=>{const b=document.createElement('button');b.dataset.a=id;b.textContent=name;document.getElementById('animSeg').append(b);});
document.getElementById('animSeg').querySelectorAll('button').forEach(b=>{
  b.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('animSeg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    setAnim(b.dataset.a);
  });
});

const FONTS=[['Outfit','\'Outfit\',sans-serif'],['DM Mono','\'DM Mono\',monospace'],['Cormorant','\'Cormorant Garamond\',serif'],['Syne','\'Syne\',sans-serif'],['Epilogue','\'Epilogue\',sans-serif'],['Monoton','\'Monoton\',cursive'],['Caveat','\'Caveat\',cursive'],['Bebas','\'Bebas Neue\',sans-serif'],];
const fontList=document.getElementById('fontList');
FONTS.forEach(([label,fam],i)=>{const b=document.createElement('button');const span=document.createElement('span');span.style.fontFamily=fam;span.textContent=label;b.append(span);if(i===0)b.classList.add('on');b.onclick=()=>pickFont(label);fontList.appendChild(b);});

const szR=document.getElementById('szR');
const szVal=document.getElementById('szVal');
szR.oninput=e=>{msg.style.fontSize=e.target.value+'px';szVal.textContent=e.target.value+'px';rebuildTicker();LS.set('away_size',e.target.value);broadcast('size',{fontSize:parseInt(e.target.value)});};
document.getElementById('szRst').onclick=()=>{msg.style.fontSize='';szVal.textContent='Auto';szR.value=72;rebuildTicker();LS.set('away_size','');broadcast('size',{fontSize:null});};

const spdR=document.getElementById('spdR'),spdVal=document.getElementById('spdVal');
spdR.value=tickerSpeed; spdVal.textContent=Math.round(tickerSpeed);
function setSpeed(v){
  // Preserve the visible position when speed changes:
  // viewer(t) = (t - epoch)/1000 * speed must stay continuous.
  const now = Date.now();
  const oldViewer = (now - sharedEpoch)/1000 * tickerSpeed;
  tickerSpeed = safeNumber(v,15,400,140);
  tickerClock=advanceClock(tickerClock,now,tickerSpeed);
  broadcast('motion',{clock:motionClock,ticker:tickerClock});
  sharedEpoch = now - (oldViewer / tickerSpeed) * 1000;
  LS.set('away_speed', tickerSpeed);
  LS.set('away_epoch', sharedEpoch);
  broadcast('tempo',{epoch:sharedEpoch, speed:tickerSpeed});
}
spdR.oninput=e=>{ setSpeed(parseFloat(e.target.value)); spdVal.textContent=Math.round(tickerSpeed); };
document.getElementById('spdRst').onclick=()=>{ setSpeed(140); spdR.value=140; spdVal.textContent='140'; };

function h2rgb(h){const n=parseInt(h.slice(1),16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];}
function styleSnapshot(){
  return {
    inkColor:document.getElementById('cInk').value,
    accentColor:document.getElementById('cAcc').value,
    shaderCol:{r:sCol[0],g:sCol[1],b:sCol[2]},
    aHex:document.getElementById('cShd').value,
    c2:document.getElementById('cShdB').value,
    c3:document.getElementById('cShdC').value,
    bri, sat,
  };
}
document.getElementById('cInk').oninput=e=>setColors({ink:e.target.value});
document.getElementById('cAcc').oninput=e=>setColors({accent:e.target.value});
document.getElementById('cShd').oninput=e=>setColors({tintA:e.target.value});
document.getElementById('cShdB').oninput=e=>setColors({tintB:e.target.value});
document.getElementById('cShdC').oninput=e=>setColors({tintC:e.target.value});
document.getElementById('cBri').oninput=e=>setColors({bri:parseInt(e.target.value,10)/100});
document.getElementById('cSat').oninput=e=>setColors({sat:parseInt(e.target.value,10)/100});
sCol=h2rgb('#cfcabf');

const THEMES=[
  ['Paper','#f0ede6','#d24317','#cfcabf','#4fe3a0','#7a5cff'],
  ['Ember','#ffe8d6','#ff5c1f','#ff9550','#ffc22e','#5c1e3a'],
  ['Ocean','#dff4ff','#2ec5ff','#6fb7ff','#00ffd0','#173a8a'],
  ['Violet','#f3e8ff','#b26bff','#b48cff','#ff6bd6','#3a1b7a'],
  ['Forest','#eaffe8','#6bff8f','#9fd8a0','#37d67a','#123a2a'],
  ['Gold','#fff3d6','#ffc24d','#e8c37a','#ff9d2e','#4a3b8a'],
  ['Candy','#fff0f6','#ff4fa0','#ff9ad5','#4fd8ff','#7a2bff'],
  ['Mono','#ffffff','#8a8a8a','#c8c8c8','#6a6a6a','#2a2a2a'],
];
THEMES.push(...EXTRA_THEMES);
const swList=document.getElementById('swList');
THEMES.forEach(th=>{
  const b=document.createElement('button');
  b.className='sw'; b.title=th[0];b.setAttribute('aria-label',th[0]);b.dataset.theme=th[0];
  for(let i=3;i<6;i++){ const s=document.createElement('i'); s.style.background=th[i]; b.appendChild(s); }
  const label=document.createElement('span');label.textContent=th[0];b.append(label);
  b.onclick=()=>{ setColors({ink:th[1],accent:th[2],tintA:th[3],tintB:th[4],tintC:th[5]}); showStatus('Theme · '+th[0]); };
  swList.appendChild(b);
});

const lockBtn=document.getElementById('lockBtn');
lockBtn.onclick=()=>{document.body.classList.toggle('locked');lockBtn.textContent=document.body.classList.contains('locked')?'Unlock editing':'Lock editing';};

document.getElementById('openOtherBtn').onclick=()=>{
  const base = location.origin + location.pathname;
  const url = base + '?monitor=2';
  const w = window.open(url, 'Away_Monitor_2', 'width=1920,height=1080,left=1920');
  if(w){ showStatus('Opened on other screen'); setTimeout(()=>broadcast('hello',{}), 800); }
  else showStatus('Pop-up blocked - open manually');
};

/* ─────── Helpers used by presets + keyboard ─────── */
function pickShader(i){
  if(i<0||i>=SHADERS.length) return;
  if(shuffleOn) setShuffle(false); // manual pick wins over auto-cycle
  cur=i;refreshSelection();
  LS.set('away_shader', i);
  broadcast('shader',{index:i});
}
function pickAnim(cls){
  document.querySelectorAll('#animSeg button').forEach(b=>b.classList.toggle('on', (b.dataset.a||'')===cls));
  setAnim(cls);
}
function pickScroll(s){
  document.querySelectorAll('#scrollSeg button').forEach(b=>b.classList.toggle('on', (b.dataset.s||'')===s));
  setScroll(s);
}
function pickFont(label){
  const idx = FONTS.findIndex(f=>f[0]===label);
  if(idx<0) return;
  const fam = FONTS[idx][1];
  msg.style.fontFamily = fam;
  [...fontList.children].forEach((c,k)=>c.classList.toggle('on', k===idx));
  rebuildTicker();
  pTextDirty=true;
  LS.set('away_font', label);
  broadcast('font',{font:fam});
}
function setColors(o){
  if(o.ink){ document.documentElement.style.setProperty('--ink', o.ink); document.getElementById('cInk').value = o.ink; LS.set('away_ink', o.ink); }
  if(o.accent){ document.documentElement.style.setProperty('--accent', o.accent); document.getElementById('cAcc').value = o.accent; LS.set('away_acc', o.accent); }
  if(o.tintA){ sCol = h2rgb(o.tintA); document.getElementById('cShd').value = o.tintA; LS.set('away_tint', o.tintA); }
  if(o.tintB){ sCol2 = h2rgb(o.tintB); document.getElementById('cShdB').value = o.tintB; LS.set('away_tint2', o.tintB); }
  if(o.tintC){ sCol3 = h2rgb(o.tintC); document.getElementById('cShdC').value = o.tintC; LS.set('away_tint3', o.tintC); }
  if(typeof o.bri==='number' && !isNaN(o.bri)){ bri=o.bri; document.getElementById('cBri').value=Math.round(bri*100); document.getElementById('briVal').textContent=bri.toFixed(2); LS.set('away_bri', bri); }
  if(typeof o.sat==='number' && !isNaN(o.sat)){ sat=o.sat; document.getElementById('cSat').value=Math.round(sat*100); document.getElementById('satVal').textContent=sat.toFixed(2); LS.set('away_sat', sat); }
  syncTickerStyle();refreshFallback();refreshSelection();
  broadcast('style', styleSnapshot());
}
function setShuffle(on, fromSync){
  shuffleOn = !!on;
  document.getElementById('shufTgl').classList.toggle('on', shuffleOn);
  LS.set('away_cycle', shuffleOn?'1':'0');
  if(!shuffleOn){ lastGrade='__init__'; } // force grade refresh so the dip clears
  syncToggleStates();
  if(!fromSync) broadcast('cycle',{on:shuffleOn});
}

const PRESETS = [
  {name:'Cinema',    shader:'Mesh Gradient', font:'Outfit',    anim:'a-shimmer', scroll:'',            ink:'#f0ede6', accent:'#d24317', tint:'#cfcabf', b:'#4fe3a0', c:'#7a5cff', speed:140},
  {name:'Vaporwave', shader:'Mesh Gradient', font:'Monoton',   anim:'a-rainbow', scroll:'scroll-left', ink:'#ffeaff', accent:'#ff2bd6', tint:'#9b6dff', b:'#ff2bd6', c:'#2bd6ff', speed:90},
  {name:'Terminal',  shader:'Grid Field',    font:'DM Mono',   anim:'a-chroma',  scroll:'scroll-left', ink:'#9bff9b', accent:'#00ff88', tint:'#0e2a18', b:'#00ff88', c:'#043316', speed:120},
  {name:'Zen',       shader:'Soft Noise',    font:'Cormorant', anim:'a-breathe', scroll:'',            ink:'#f5f0e3', accent:'#b4856a', tint:'#c2b8a3', b:'#d8c9a8', c:'#6b7f6a', speed:60},
  {name:'Arcade',    shader:'Liquid Chrome', font:'Bebas',     anim:'a-neon',    scroll:'scroll-left', ink:'#ffffff', accent:'#ff2080', tint:'#8090a8', b:'#ff2080', c:'#00d4ff', speed:200},
  {name:'Aurora',    shader:'Aurora',        font:'Outfit',    anim:'a-breathe', scroll:'',            ink:'#e6fff5', accent:'#5cffb0', tint:'#2a8870', b:'#4fe3a0', c:'#7a5cff', speed:80,  pmode:'swarm'},
  {name:'Cosmos',    shader:'Starfield',     font:'Syne',      anim:'a-pulse',   scroll:'',            ink:'#f0ede6', accent:'#88aaff', tint:'#4a5a90', b:'#88aaff', c:'#ff7ab0', speed:100, pmode:'galaxy'},
  {name:'Script',    shader:'Soft Noise',    font:'Caveat',    anim:'a-fade',    scroll:'',            ink:'#fff4e0', accent:'#e89a4a', tint:'#d6b890', b:'#e8a45c', c:'#8a6bff', speed:90},
  {name:'Matrix',    shader:'Code Rain',     font:'DM Mono',   anim:'a-flicker', scroll:'',            ink:'#c8ffd9', accent:'#00ff6a', tint:'#0a3320', b:'#37ff8a', c:'#062213', speed:120, pmode:'off'},
  {name:'Lava',      shader:'Lava Lamp',     font:'Syne',      anim:'a-breathe', scroll:'',            ink:'#ffe9d9', accent:'#ff6a2b', tint:'#ff8c42', b:'#ffc22e', c:'#341020', speed:100, pmode:'off'},
  {name:'Deep',      shader:'Nebula',        font:'Epilogue',  anim:'a-fade',    scroll:'',            ink:'#e8ecff', accent:'#8a7dff', tint:'#5560c8', b:'#c05cff', c:'#1b2a6b', speed:80,  pmode:'swarm'},
  {name:'Drive',     shader:'Retro Sun',     font:'Bebas',     anim:'a-neon',    scroll:'',            ink:'#ffe6f7', accent:'#ff2bd6', tint:'#ff9d5c', b:'#ff2bd6', c:'#241b52', speed:150, pmode:'off'},
];

PRESETS.unshift(...EXTRA_PRESETS);
function applyPreset(p){
  pickScroll(p.scroll);
  const idx = SHADERS.findIndex(s=>s.name===p.shader);
  if(idx>=0) pickShader(idx);
  pickFont(p.font);
  pickAnim(p.anim);
  setColors({ink:p.ink, accent:p.accent, tintA:p.tint, tintB:p.b||'#4fe3a0', tintC:p.c||'#7a5cff', bri:p.bri??1, sat:p.sat??1});
  if(typeof p.speed==='number'){ setSpeed(p.speed); spdR.value=p.speed; spdVal.textContent=Math.round(p.speed); }
  setPMode(p.pmode??'off');
  applySizeFromSync({fontSize:p.size??null});LS.set('away_size',p.size??'');broadcast('size',{fontSize:p.size??null});
  if(p.motion!==undefined)setMotion(p.motion,motionClock.paused);
  if(p.grain!==undefined)applyFx(p.grain,p.vignette,true);
  refreshSelection();
  showStatus('Preset · '+p.name);
}

const presetList = document.getElementById('presetList');
PRESETS.forEach(p=>{
  const b = document.createElement('button');
  b.textContent = p.name;
  b.style.setProperty('--preset-a',p.tint);b.style.setProperty('--preset-b',p.c);
  b.onclick = ()=>applyPreset(p);
  presetList.appendChild(b);
});

let presetIdx = -1;
function cyclePreset(){ presetIdx = (presetIdx+1) % PRESETS.length; applyPreset(PRESETS[presetIdx]); }
function cycleShader(){ pickShader((cur+1) % SHADERS.length); }
function cycleAnim(){
  const buttons = [...document.querySelectorAll('#animSeg button')];
  const i = buttons.findIndex(b=>b.classList.contains('on'));
  const next = buttons[(i+1) % buttons.length];
  pickAnim(next.dataset.a||'');
}
function cycleFont(){
  const i = FONTS.findIndex(f=>f[0]===( [...fontList.children].find(c=>c.classList.contains('on'))?.textContent?.trim() ));
  const next = (i<0?0:(i+1)%FONTS.length);
  pickFont(FONTS[next][0]);
}
function cycleScroll(){
  const order = ['','scroll-left','scroll-right'];
  const i = order.indexOf(curScroll);
  pickScroll(order[(i+1) % order.length]);
}

/* ─────── Keyboard ─────── */
addEventListener('keydown', e=>{
  if(document.activeElement?.matches('input,textarea,select,button,[contenteditable=true]'))return;
  if(e.key==='Escape'){if(panel.classList.contains('open'))togglePanel(false);return;}
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  const k = e.key.toLowerCase();
  if(k==='f'){ const el=document.documentElement; if(!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); }
  else if(k==='m'||k==='h'){ document.getElementById('tog').click(); }
  else if(k==='l'){ document.getElementById('lockBtn').click(); }
  else if(k==='n'){ cycleAnim(); }
  else if(k==='b'){ cycleShader(); }
  else if(k==='t'){ cycleFont(); }
  else if(k==='p'){ cyclePreset(); }
  else if(k==='r'){randomizeLook();}
  else if(k==='c'){toggleMotion();}
  else if(k==='z'){undoLook();}
  else if(k==='x'){ cyclePMode(); }
  else if(k==='s'){ setShuffle(!shuffleOn); showStatus('Shuffle '+(shuffleOn?'on':'off')); }
  else if(k===' '){ e.preventDefault(); cycleScroll(); }
  else if(k==='arrowleft'){ e.preventDefault(); const v=Math.max(15, tickerSpeed-20); setSpeed(v); spdR.value=v; spdVal.textContent=Math.round(v); }
  else if(k==='arrowright'){ e.preventDefault(); const v=Math.min(400, tickerSpeed+20); setSpeed(v); spdR.value=v; spdVal.textContent=Math.round(v); }
  else if(/^[1-9]$/.test(k)){
    const i=parseInt(k,10)-1;
    if(i<SHADERS.length) pickShader(i);
  }
  bumpIdle();
});

/* ─────── Particles UI ─────── */
document.querySelectorAll('#pmodeSeg button').forEach(b=>{
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setPMode(b.dataset.p);});
});
document.querySelectorAll('#pdenSeg button').forEach(b=>{
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setPDensity(b.dataset.d);});
});
setPDensity(LS.get('away_pdensity','mid'), true);
setPMode(LS.get('away_pmode','off'), Date.now()-P_MORPH_MS, true);
document.fonts?.ready?.then(()=>{pTextDirty=true;fontRevision++;rebuildTicker();});

const P_MODES=['off','swarm','text','sphere','torus','helix','galaxy','wave','cycle'];
function cyclePMode(){ setPMode(P_MODES[(P_MODES.indexOf(pMode)+1)%P_MODES.length]); showStatus('Particles · '+pMode); }

/* ─────── Atmosphere FX ─────── */
function applyFx(grain, vignette, doBroadcast){
  document.body.classList.toggle('fx-grain', !!grain);
  document.body.classList.toggle('fx-vignette', !!vignette);
  document.getElementById('fxGrain').classList.toggle('on', !!grain);
  document.getElementById('fxVig').classList.toggle('on', !!vignette);
  LS.set('away_fx_grain', grain?'1':'0');
  LS.set('away_fx_vig', vignette?'1':'0');
  syncToggleStates();
  if(doBroadcast) broadcast('fx',{grain:!!grain, vignette:!!vignette});
}
document.getElementById('fxGrain').onclick=()=>applyFx(!document.body.classList.contains('fx-grain'), document.body.classList.contains('fx-vignette'), true);
document.getElementById('fxVig').onclick=()=>applyFx(document.body.classList.contains('fx-grain'), !document.body.classList.contains('fx-vignette'), true);
applyFx(LS.get('away_fx_grain','1')==='1', LS.get('away_fx_vig','1')==='1', false);

/* ─────── Shuffle toggle ─────── */
document.getElementById('shufTgl').onclick=()=>setShuffle(!shuffleOn);

/* ─────── Audio pulse (mic) ─────── */
async function setAudio(on){
  const t=document.getElementById('fxAudio');
  if(on){
    try{
      audioStream=await navigator.mediaDevices.getUserMedia({audio:true});
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const src=audioCtx.createMediaStreamSource(audioStream);
      analyser=audioCtx.createAnalyser();
      analyser.fftSize=256;
      analyser.smoothingTimeConstant=.5;
      src.connect(analyser);
      audioData=new Uint8Array(analyser.frequencyBinCount);
      t.classList.add('on');
      showStatus('Audio pulse on');
    }catch(e){
      analyser=null; audioData=null;
      audioStream?.getTracks().forEach(tr=>tr.stop());audioStream=null;audioCtx?.close();audioCtx=null;
      t.classList.remove('on');
      showStatus('Mic unavailable');
    }
  }else{
    analyser=null; audioData=null;
    if(audioStream){ audioStream.getTracks().forEach(tr=>tr.stop()); audioStream=null; }
    if(audioCtx){ audioCtx.close(); audioCtx=null; }
    t.classList.remove('on');
    showStatus('Audio pulse off');
  }
  syncToggleStates();
}
document.getElementById('fxAudio').onclick=()=>setAudio(!analyser);

/* ─────── Back-at input ─────── */
const backAtInp = document.getElementById('backAt');
backAtInp.value = backAtTime;
backAtInp.oninput = ()=>{ backAtTime = backAtInp.value; LS.set('away_backat', backAtTime); broadcast('backat',{t:backAtTime}); updateCountdown(); };
document.getElementById('backAtClr').onclick = ()=>{ backAtTime=''; backAtInp.value=''; LS.set('away_backat',''); broadcast('backat',{t:''}); updateCountdown(); };

/* ─────── Save current as custom preset ─────── */
function captureConfig(){
  const fontOn = [...fontList.children].findIndex(c=>c.classList.contains('on'));
  return {
    name:'Mine',
    shader: SHADERS[cur].name,
    font: FONTS[Math.max(0,fontOn)][0],
    anim: curAnim, scroll: curScroll,
    ink: document.getElementById('cInk').value,
    accent: document.getElementById('cAcc').value,
    tint: document.getElementById('cShd').value,
    b: document.getElementById('cShdB').value,
    c: document.getElementById('cShdC').value,
    bri, sat,
    speed: tickerSpeed,
    pmode: pMode,
    size:msg.style.fontSize?parseInt(msg.style.fontSize):null,motion:motionClock.speed,grain:document.body.classList.contains('fx-grain'),vignette:document.body.classList.contains('fx-vignette'),
  };
}
function ensureMineButton(cfg){
  let b = [...presetList.children].find(x=>x.textContent==='Mine');
  if(!b){ b = document.createElement('button'); b.textContent='Mine'; presetList.appendChild(b); }
  b.style.color = 'var(--accent)';
  b.onclick = ()=>applyPreset(cfg);
}
document.getElementById('savePresetBtn').onclick = ()=>{
  const cfg = captureConfig();
  LS.set('away_mypreset', JSON.stringify(cfg));
  ensureMineButton(cfg);
  showStatus('Saved your preset');
};
try{ const saved = localStorage.getItem('away_mypreset'); if(saved) ensureMineButton(JSON.parse(saved)); }catch(e){}

/* ─────── Entrance reveal ─────── */
document.body.classList.add('entering');
setTimeout(()=>document.body.classList.remove('entering'), 2400);

/* ─────── Idle UI hide ─────── */
let idleT=null;
function bumpIdle(){ document.body.classList.remove('idle'); clearTimeout(idleT); idleT=setTimeout(()=>{ if(!document.body.classList.contains('popen')) document.body.classList.add('idle'); }, 4500); }
addEventListener('pointermove', bumpIdle);
addEventListener('pointerdown', bumpIdle);
bumpIdle();

/* ─────── Init / bootstrap ─────── */
{
  const savedMsg = LS.get('away_msg','');
  if(savedMsg)msg.textContent=savedMsg;origText=msg.textContent;
  const savedShader = parseInt(LS.get('away_shader','')||'-1',10);
  if(savedShader >= 0 && savedShader < SHADERS.length){
    cur = savedShader;
    [...bgList.children].forEach((c,i)=>c.classList.toggle('on', i===cur));
  }

  // Restore the rest of the look so a reload (or a fresh monitor window)
  // comes back exactly as it was left.
  setColors({
    ink:  LS.get('away_ink',  '#fbffe5'),
    accent: LS.get('away_acc','#e4ff43'),
    tintA: LS.get('away_tint', '#dbff46'),
    tintB: LS.get('away_tint2','#ff5486'),
    tintC: LS.get('away_tint3','#4624bc'),
    bri: parseFloat(LS.get('away_bri','1')),
    sat: parseFloat(LS.get('away_sat','1')),
  });
  const savedAnim = LS.get('away_anim','a-wave');
  if(savedAnim) pickAnim(savedAnim);
  const savedScroll = LS.get('away_scroll','');
  if(savedScroll){
    // restore classes directly — setScroll would reset the shared epoch and
    // yank the ticker position on the other monitor
    curScroll = savedScroll;
    document.body.classList.add(savedScroll);
    document.querySelectorAll('#scrollSeg button').forEach(b=>b.classList.toggle('on',(b.dataset.s||'')===savedScroll));
  }
  const savedFont = LS.get('away_font','');
  if(savedFont) pickFont(savedFont);
  const savedSize = LS.get('away_size','');
  if(savedSize){ msg.style.fontSize = savedSize+'px'; szVal.textContent = savedSize+'px'; szR.value = savedSize; }
  setShuffle(LS.get('away_cycle','0')==='1', true);

  publishWidth();
  addEventListener('resize', ()=>{ publishWidth(); rebuildTicker(); pWorldChanged(); });
  addEventListener('storage', (ev)=>{
    if(ev.key==='away_m1_width'){ monitor1Width = parseFloat(ev.newValue); rebuildTicker(); pWorldChanged(); }
    if(ev.key==='away_m2_width'){ monitor2Width = parseFloat(ev.newValue); rebuildTicker(); pWorldChanged(); }
    if(ev.key==='away_m1_height'){ monitor1Height = parseFloat(ev.newValue); }
    if(ev.key==='away_m2_height'){ monitor2Height = parseFloat(ev.newValue); }
    if(ev.key==='away_msg'&&ev.newValue!==origText)receiveMessage(ev.newValue||'');
    if(ev.key==='away_epoch'){ sharedEpoch = parseFloat(ev.newValue); }
  });
  // wait a tick so layout is ready then build
  requestAnimationFrame(()=>{ syncTickerStyle(); rebuildTicker(); updateVignette(); broadcast('hello',{}); });
  // when this window closes (the secondary), clear its width so the primary stops offsetting
  if(isMonitor2){
    addEventListener('beforeunload', ()=>{
      LS.set('away_m2_width', 0);
      LS.set('away_m2_height', 0);
      broadcast('width', {monitor:2, w:0, h:0});
    });
  }
}

const undoStack=[];
function randomizeLook(){
  undoStack.push(captureConfig());if(undoStack.length>20)undoStack.shift();
  const theme=THEMES[Math.floor(Math.random()*THEMES.length)];
  const preset={...PRESETS[Math.floor(Math.random()*PRESETS.length)],name:'Fresh mix',shader:SHADERS[Math.floor(Math.random()*SHADERS.length)].name,ink:theme[1],accent:theme[2],tint:theme[3],b:theme[4],c:theme[5],pmode:'off',size:null,scroll:''};
  applyPreset(preset);document.getElementById('undoBtn').disabled=false;
}
function undoLook(){if(!undoStack.length)return;applyPreset(undoStack.pop());document.getElementById('undoBtn').disabled=!undoStack.length;showStatus('Previous look restored');}
document.getElementById('randomBtn').onclick=randomizeLook;
document.getElementById('dockRandom').onclick=randomizeLook;
document.getElementById('undoBtn').onclick=undoLook;
document.getElementById('pauseBtn').onclick=toggleMotion;
document.getElementById('dockPause').onclick=toggleMotion;
document.getElementById('motionR').oninput=e=>setMotion(Number(e.target.value),motionClock.paused);
document.getElementById('editBtn').onclick=()=>togglePanel();
document.getElementById('fullscreenBtn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showStatus('Use your browser’s fullscreen command');}};
addEventListener('fullscreenchange',()=>{document.getElementById('fullscreenBtn').innerHTML=(document.fullscreenElement?'Exit full screen':'Fullscreen')+'<span>F</span>';});
document.getElementById('messageInput').addEventListener('input',e=>{stopAnims();origText=e.target.value;msg.textContent=origText;saveMessage();startJsAnim(curAnim);});
document.querySelectorAll('[data-message]').forEach(b=>b.onclick=()=>{receiveMessage(b.dataset.message);saveMessage();});
document.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=()=>{const d=new Date(Date.now()+Number(b.dataset.minutes)*60000);backAtTime=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');backAtInp.value=backAtTime;LS.set('away_backat',backAtTime);broadcast('backat',{t:backAtTime});updateCountdown();showStatus('Back in '+b.dataset.minutes+' minutes');});
document.querySelectorAll('[data-tab]').forEach((b,i,all)=>{
  b.onclick=()=>{all.forEach(tab=>{const on=tab===b;tab.setAttribute('aria-selected',on);tab.tabIndex=on?0:-1;document.getElementById(tab.dataset.tab+'Pane').hidden=!on;});};
  b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length;all[n].click();all[n].focus();};
});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-filter]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b);});
  document.querySelectorAll('#bgList button').forEach(x=>{x.hidden=b.dataset.filter!=='All'&&x.dataset.group!==b.dataset.filter;});
});
const qualitySelect=document.getElementById('qualitySelect');qualitySelect.value=quality;
qualitySelect.onchange=()=>{quality=qualitySelect.value;LS.set('away_quality',quality);resize();pResize();showStatus('Quality · '+qualitySelect.selectedOptions[0].textContent);};
const durationSelect=document.getElementById('cycleDuration');
CYCLE_MS=safeNumber(LS.get('away_cycle_duration','30000'),15000,300000,30000);durationSelect.value=CYCLE_MS;
durationSelect.onchange=()=>{CYCLE_MS=Number(durationSelect.value);LS.set('away_cycle_duration',CYCLE_MS);broadcast('cycleDuration',{value:CYCLE_MS});};
const previousBC=bc?.onmessage;
if(bc)bc.onmessage=e=>{previousBC?.(e);if(e.data.type==='cycleDuration'){CYCLE_MS=safeNumber(e.data.data.value,15000,300000,30000);durationSelect.value=CYCLE_MS;}if(e.data.type==='hello'&&!isMonitor2)broadcast('cycleDuration',{value:CYCLE_MS});};
document.getElementById('threeCanvas').addEventListener('webglcontextlost',e=>{e.preventDefault();stageLost=true;document.body.classList.remove('three-text-active');});
document.getElementById('threeCanvas').addEventListener('webglcontextrestored',()=>{stageLost=false;});
addEventListener('pagehide',()=>{audioStream?.getTracks().forEach(t=>t.stop());audioCtx?.close();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastFrame=0;pTextDirty=true;}});
// Space and arrow keys on native fields remain available to the focused control.
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open'))togglePanel(false);});
document.getElementById('messageInput').value=origText;
document.getElementById('messageCount').textContent=Array.from(origText).length+' / 280';
applyMotionUI();refreshSelection();refreshFallback();
const legacyDurations={'a-shimmer':3.6,'a-neon':2.4,'a-rainbow':5,'a-breathe':3.4,'a-wobble':2.4,'a-chroma':1.8,'a-drift':6,'a-fade':4.2,'a-flicker':4.6,'a-swing':5.2};
const motionStyles=document.createElement('style');motionStyles.textContent=Object.entries(legacyDurations).map(([a,t])=>`body.${a} #msg,body.${a} .ticker-item{animation-duration:calc(${t}s / var(--motion-speed))}`).join('\n');document.head.append(motionStyles);
