import { EXTRA_SHADERS, advanceClock, clockValue, safeNumber } from './effects.js';

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

// Stable epoch for scene time — never reset, so visuals never jump.
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
let lastFrame=0;
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
        rebuildTicker(); updatePaperWorld();
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
  rebuildTicker();broadcast('message',{text:origText});
}
function receiveMessage(text){
  stopAnims();origText=String(text).slice(0,280);msg.textContent=origText;
  document.getElementById('messageInput').value=origText;document.getElementById('messageCount').textContent=Array.from(origText).length+' / 280';
  rebuildTicker();startJsAnim(curAnim);
}
function refreshFallback(){
  const root=document.documentElement;
  const rgb=h2rgb(document.getElementById('cInk').value);
  const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  root.style.setProperty('--letter-halo',luminance<.45?'#fff9':'#070917a8');
  root.style.setProperty('--a',document.getElementById('cShd').value);
  root.style.setProperty('--b',document.getElementById('cShdB').value);
  root.style.setProperty('--c',document.getElementById('cShdC').value);
}
const lightScenes=new Set(['Contour Lines','Mesh Gradient','Tidal Bands','Liquid Chrome','Halftone Mono','Dithered Saturn']);
const previousInk=LS.get('away_ink','');
let autoInk=LS.get('away_auto_ink',['','#26392e','#101329'].includes(previousInk)?'1':'0')==='1';
function applySceneInk(scene){
  const button=document.getElementById('autoInk');
  button.setAttribute('aria-pressed',autoInk);
  if(!autoInk)return;
  const ink=scene.paper||lightScenes.has(scene.name)?'#101329':'#f3f4ff';
  document.documentElement.style.setProperty('--ink',ink);
  document.getElementById('cInk').value=ink;
  refreshFallback();
  syncTickerStyle();
}
function refreshSelection(){
  document.querySelectorAll('#bgList button').forEach(button=>{
    const active=button.dataset.scene===SHADERS[cur].name;
    button.classList.toggle('on',active);
    button.setAttribute('aria-pressed',active);
  });
  for(const [selector,key,value] of [['#animSeg','a',curAnim],['#scrollSeg','s',curScroll]]){
    document.querySelectorAll(selector+' button').forEach(b=>{const on=(b.dataset[key]||'')===value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  }
  const scene=SHADERS[cur];
  applySceneInk(scene);
  if(featured.includes(scene.name)){
    const slug=scene.name.toLowerCase().replaceAll(' ','-');
    document.body.style.setProperty('--scene-still',`url('/scenes/${slug}.webp')`);
  }else document.body.style.removeProperty('--scene-still');
  document.body.classList.toggle('halftone-active',scene.name==='Halftone Mono');
  document.body.classList.toggle('saturn-active',scene.name==='Dithered Saturn');
  document.getElementById('fixedPaletteNote').hidden=!scene.webgl2;
  document.getElementById('fixedPaletteNote').textContent=scene.name+' uses its original ink and paper palette.';
  for(const id of ['cShd','cShdB','cShdC','cBri','cSat'])document.getElementById(id).closest('.pr,.sz-row').hidden=!!scene.webgl2;
  document.body.dataset.scene=scene.paper?scene.name:'motion';
  document.getElementById('paperControls').hidden=!scene.paper;
  document.getElementById('sceneSelect').value=scene.name;
  syncToggleStates();
}
function syncToggleStates(){document.querySelectorAll('.tgl').forEach(b=>b.setAttribute('aria-checked',b.classList.contains('on')));}
function togglePanel(open=!panel.classList.contains('open')){
  panel.classList.toggle('open',open);panel.inert=!open;document.body.classList.toggle('popen',open);
  const button=document.getElementById('tog');button.setAttribute('aria-expanded',open);button.setAttribute('aria-label',open?'Close studio':'Open studio');
  if(!open){button.focus();bumpIdle();}else{document.querySelector('.studio-tabs [aria-selected=true]').focus();}
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
  document.getElementById('engineStatus').textContent=motionClock.paused?'Paused':'Live';
  LS.set('away_motion',motionClock.speed);LS.set('away_paused',motionClock.paused?'1':'0');
}
function toggleMotion(){setMotion(motionClock.speed,!motionClock.paused);}
let tickerSpeed = parseFloat(LS.get('away_speed', '140'));

function worldDims(){
  const w = (monitor1Width||innerWidth) + (monitor2Width||0);
  const h = Math.max(monitor1Height||innerHeight, monitor2Height||innerHeight);
  return {w, h};
}
function monitorOffsetX(){ return isMonitor2 ? (monitor1Width||0) : 0; }

/* ─────── Broadcast Channel Setup ─────── */
let bc = null;
let initialized=false;
try{
  bc = new BroadcastChannel('away_dual_sync');
  bc.onmessage = (e)=>{
    const {type,data} = e.data;
    if(type==='paper')applyPaper(data.stock,data.wash);
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
      updatePaperWorld();
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

    if(type==='cycle'){ setShuffle(data.on, true); }
    if(type==='audio'){ remoteBass = data.b; remoteBassAt = performance.now(); }
    if(type==='hello'){
      // a sibling came online — re-publish our state
      publishWidth();
      if(!isMonitor2){
        broadcast('paper',{stock:stock.value,wash:strength.value});
        broadcast('message',{text: origText});
        broadcast('motion',{clock:motionClock,ticker:tickerClock});
        broadcast('epoch',{epoch: sharedEpoch});
        broadcast('speed',{speed: tickerSpeed});
        broadcast('scroll',{scroll: curScroll, epoch: sharedEpoch});
        broadcast('animation',{anim: curAnim});
        broadcast('shader',{index:cur,name:SHADERS[cur].name});

        broadcast('style', styleSnapshot());

        broadcast('size',{fontSize: msg.style.fontSize ? parseInt(msg.style.fontSize) : null});
        broadcast('backat',{t: backAtTime});
        broadcast('cycle',{on: shuffleOn});
        broadcast('font',{font:msg.style.fontFamily});
      }
    }
  };
}catch(err){
  console.warn('BroadcastChannel not available:', err);
}

function broadcast(type, data){
  if(bc && (!isMonitor2 || initialized || type==='width')) bc.postMessage({type, data});
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
  setTimeout(()=>{ if(bar.textContent===msg)bar.textContent = ''; }, 2000);
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
];
SHADERS.push(...EXTRA_SHADERS, {name:'Halftone Mono',webgl2:true}, {name:'Dithered Saturn',webgl2:true});
const PAPER_SCENES = ['Paper cut','Overprint','Blank sheet'];
const motionSceneCount = SHADERS.length;
SHADERS.push(...PAPER_SCENES.map(name=>({name,paper:true})));
// Rewrite shader sources to sample in world UV so the pattern spans across both monitors.
SHADERS.forEach(s=>{
  if(s.paper||s.webgl2)return;
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

const defaultScene=SHADERS.findIndex(scene=>scene.name==='Contour Lines');
let cur=defaultScene;
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

const halftoneCanvas=document.getElementById('halftone');
let halftoneStage=null;
let halftoneLoading=false;
let halftoneFailed=false;
const halftoneMotion=matchMedia('(prefers-reduced-motion: reduce)');
function renderHalftone(time){
  if(halftoneFailed)return;
  if(!halftoneStage){
    if(!halftoneLoading){
      halftoneLoading=true;
      import('./halftone-stage.js').then(module=>{
        halftoneStage=module.createHalftoneStage(halftoneCanvas);
        if(!halftoneStage)throw new Error('WebGL2 unavailable');
      }).catch(error=>{
        halftoneFailed=true;
        console.warn('Halftone Mono is using its still preview',error);
        document.getElementById('fixedPaletteNote').textContent='WebGL2 is unavailable. Showing a still preview of Halftone Mono.';
      }).finally(()=>{halftoneLoading=false;});
    }
    return;
  }
  const world=worldDims();
  // Both windows use the same pixel grid, including on mixed-DPI displays.
  const dual=monitor2Width>0;
  const budget=dual?2300000:quality==='eco'?1100000:quality==='high'?4200000:2300000;
  const ratio=Math.min(dual?1:devicePixelRatio||1,2,Math.sqrt(budget/(world.w*world.h)));
  halftoneStage.draw(halftoneMotion.matches?0:time,world,monitorOffsetX(),ratio);
}
addEventListener('pagehide',event=>{if(!event.persisted)halftoneStage?.dispose();});

const saturnCanvas=document.getElementById('saturn');
let saturnStage=null;
let saturnLoading=false;
let saturnFailed=false;
const saturnMotion=matchMedia('(prefers-reduced-motion: reduce)');
function renderSaturn(time){
  if(saturnFailed)return;
  if(!saturnStage){
    if(!saturnLoading){
      saturnLoading=true;
      import('./saturn-stage.js').then(module=>{
        saturnStage=module.createSaturnStage(saturnCanvas);
        if(!saturnStage)throw new Error('WebGL2 unavailable');
      }).catch(error=>{
        saturnFailed=true;
        console.warn('Dithered Saturn is using its still preview',error);
        document.getElementById('fixedPaletteNote').textContent='WebGL2 is unavailable. Showing a still preview of Dithered Saturn.';
      }).finally(()=>{saturnLoading=false;});
    }
    return;
  }
  const world=worldDims();
  // Both windows use the same pixel grid, including on mixed-DPI displays.
  const dual=monitor2Width>0;
  const budget=dual?2300000:quality==='eco'?1100000:quality==='high'?4200000:2300000;
  const ratio=Math.min(dual?1:devicePixelRatio||1,2,Math.sqrt(budget/(world.w*world.h)));
  saturnStage.draw(time,world,monitorOffsetX(),ratio,saturnMotion.matches);
}
addEventListener('pagehide',event=>{if(!event.persisted)saturnStage?.dispose();});

const msg=document.getElementById('msg');
let curAnim='',curScroll='',origText=msg.textContent;
let glitchTimer=null,glitchInner=null,typeTimer=null;
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
    document.getElementById('printWorld').style.filter=grade;
    canvas.style.filter=grade;document.getElementById('fallback').style.filter=grade;

  }

  if(gl&&!glLost&&!SHADERS[cur].paper&&!SHADERS[cur].webgl2){
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

  if(SHADERS[cur].name==='Halftone Mono')renderHalftone(t);
  if(SHADERS[cur].name==='Dithered Saturn')renderSaturn(t);
  updateTicker();
  if(cur===motionSceneCount||cur===motionSceneCount+1){
    const variable=cur===motionSceneCount?'--cut-shift':'--press-shift';
    document.getElementById('printWorld').style.setProperty(variable,Math.sin(t*.16)*12+'px');
  }
  const wrap=document.getElementById('messageWrap');
  wrap.style.transform=curAnim==='a-float'?`translateY(${Math.sin(t*1.45)*14}px)`:'';
  wrap.style.opacity=curAnim==='a-pulse'?String(.55+.45*Math.cos(t*2)):'';
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

function applyAnimFromSync(data){if(![...document.querySelectorAll('#animSeg button')].some(b=>b.dataset.a===data.anim))return;stopAnims();if(curAnim)document.body.classList.remove(curAnim);curAnim=data.anim;if(data.anim)document.body.classList.add(data.anim);startJsAnim(data.anim);refreshSelection();}

function applyScrollFromSync(data){
  if(curScroll) document.body.classList.remove(curScroll);
  curScroll=data.scroll;
  if(data.scroll)document.body.classList.add(data.scroll);
  refreshSelection();
  if(data.epoch) sharedEpoch = data.epoch;
  rebuildTicker();
}

function applyStyleFromSync(data){
  if(typeof data.autoInk==='boolean'){autoInk=data.autoInk;document.getElementById('autoInk').setAttribute('aria-pressed',autoInk);}
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

function applyFontFromSync(data){
  const index=FONTS.findIndex(([,family])=>family.replaceAll("'",'').replaceAll('"','').replaceAll(' ','')===String(data.font).replaceAll("'",'').replaceAll('"','').replaceAll(' ',''));
  if(index<0)return;
  msg.style.fontFamily=FONTS[index][1];
  [...fontList.children].forEach((button,i)=>button.classList.toggle('on',i===index));
  rebuildTicker();
}
function applyShaderFromSync(data){
  const index=data.name?SHADERS.findIndex(scene=>scene.name===data.name):data.index;
  if(Number.isInteger(index)&&SHADERS[index]){cur=index;refreshSelection();}
}

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

function fitMessage(){
  const box=document.getElementById('msgOuter');
  msg.style.removeProperty('--fit-size');
  if(msg.style.fontSize||curScroll||!box.clientWidth)return;
  const cap=parseFloat(getComputedStyle(box).maxHeight);
  if(!Number.isFinite(cap))return;
  const wrap=document.getElementById('messageWrap');
  let size=parseFloat(getComputedStyle(msg).fontSize);
  while(wrap.scrollHeight>cap && size>14){
    size=Math.max(14,Math.floor(size*.9));
    msg.style.setProperty('--fit-size',size+'px');
  }
}
function rebuildTicker(){
  fitMessage();
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
const sceneSelect=document.getElementById('sceneSelect');
for(const [label,items] of [['Motion',SHADERS.slice(0,motionSceneCount)],['Paper',SHADERS.slice(motionSceneCount)]]){
  const group=document.createElement('optgroup');
  group.label=label;
  for(const scene of items)group.append(new Option(scene.name,scene.name));
  sceneSelect.append(group);
}
sceneSelect.onchange=()=>pickShader(SHADERS.findIndex(s=>s.name===sceneSelect.value));
const bgList=document.getElementById('bgList');
const featured=['Dithered Saturn','Halftone Mono','Contour Lines','Topo Glow','Tidal Bands','Light Ribbons','Mesh Gradient','Silk Flow'];
for(const name of featured){
  const button=document.createElement('button');
  button.type='button';
  button.dataset.scene=name;
  const sample=document.createElement('img');
  sample.className='sample';
  sample.alt='';
  sample.src='/scenes/'+name.toLowerCase().replaceAll(' ','-')+'.webp';
  const label=document.createElement('span');
  label.textContent=name;
  button.append(sample,label);
  button.onclick=()=>pickShader(SHADERS.findIndex(scene=>scene.name===name));
  bgList.append(button);
}
function updatePaperWorld(){
  document.documentElement.style.setProperty('--preview-scale',(innerWidth-420)/innerWidth);
  const layer=document.getElementById('printWorld');
  layer.style.width=worldDims().w+'px';
  layer.style.height=worldDims().h+'px';
  layer.style.left=-monitorOffsetX()+'px';
}
document.getElementById('scrollSeg').querySelectorAll('button').forEach(b=>{
  b.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('scrollSeg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    setScroll(b.dataset.s);
  });
});

[['a-wave','Wave'],['a-bounce','Bounce'],['a-echo','Echo'],['a-outline','Outline'],['a-gradient','Gradient'],['a-squeeze','Elastic']].concat([['a-drift','Drift']]).forEach(([id,name])=>{const b=document.createElement('button');b.dataset.a=id;b.textContent=name;document.getElementById('animSeg').append(b);});
document.getElementById('animSeg').querySelectorAll('button').forEach(b=>{
  b.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('animSeg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    setAnim(b.dataset.a);
  });
});

const FONTS=[['Outfit','\'Outfit\',sans-serif'],['DM Mono','\'DM Mono\',monospace'],['Cormorant','\'Cormorant Garamond\',serif'],['Syne','\'Syne\',sans-serif']];
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
    autoInk,inkColor:document.getElementById('cInk').value,
    accentColor:document.getElementById('cAcc').value,
    shaderCol:{r:sCol[0],g:sCol[1],b:sCol[2]},
    aHex:document.getElementById('cShd').value,
    c2:document.getElementById('cShdB').value,
    c3:document.getElementById('cShdC').value,
    bri, sat,
  };
}
document.getElementById('cInk').oninput=e=>{
  autoInk=false;
  LS.set('away_auto_ink','0');
  setColors({ink:e.target.value});
};
document.getElementById('autoInk').onclick=()=>{
  autoInk=!autoInk;
  LS.set('away_auto_ink',autoInk?'1':'0');
  applySceneInk(SHADERS[cur]);
  LS.set('away_ink',document.getElementById('cInk').value);
  broadcast('style',styleSnapshot());
};
document.getElementById('cAcc').oninput=e=>setColors({accent:e.target.value});
document.getElementById('cShd').oninput=e=>setColors({tintA:e.target.value});
document.getElementById('cShdB').oninput=e=>setColors({tintB:e.target.value});
document.getElementById('cShdC').oninput=e=>setColors({tintC:e.target.value});
document.getElementById('cBri').oninput=e=>setColors({bri:parseInt(e.target.value,10)/100});
document.getElementById('cSat').oninput=e=>setColors({sat:parseInt(e.target.value,10)/100});
sCol=h2rgb('#cfcabf');

const lockBtn=document.getElementById('lockBtn');
lockBtn.onclick=()=>{document.body.classList.toggle('locked');lockBtn.textContent=document.body.classList.contains('locked')?'Unlock editing':'Lock editing';};

document.getElementById('openOtherBtn').onclick=()=>{
  const base = location.origin + location.pathname;
  const url = base + '?monitor=2';
  const w = window.open(url, 'Away_Monitor_2', 'width=1920,height=1080,left=1920');
  if(w){ showStatus('Opened on other screen'); setTimeout(()=>broadcast('hello',{}), 800); }
  else showStatus('Pop-up blocked - open manually');
};

/* ─────── Scene and type controls ─────── */
function pickShader(i){
  if(i<0||i>=SHADERS.length) return;
  if(shuffleOn) setShuffle(false); // manual pick wins over auto-cycle
  cur=i;refreshSelection();
  if(urlParams.has('scene')){urlParams.delete('scene');history.replaceState(null,'',location.pathname+(urlParams.size?'?'+urlParams:'')+location.hash);}
  LS.set('away_scene_name', SHADERS[i].name);
  broadcast('shader',{index:i,name:SHADERS[i].name});
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

  else if(k==='c'){toggleMotion();}

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

document.fonts?.ready?.then(()=>{rebuildTicker();});
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

/* ─────── Idle UI hide ─────── */
let idleT=null;
function bumpIdle(){ document.body.classList.remove('idle'); clearTimeout(idleT); idleT=setTimeout(()=>{ if(!document.body.classList.contains('popen')) document.body.classList.add('idle'); }, 4500); }
addEventListener('pointermove', bumpIdle);
addEventListener('pointerdown', bumpIdle);
bumpIdle();

const stock=document.getElementById('stock');
const strength=document.getElementById('wash');
function applyPaper(material,opacity){
  stock.value=['cotton','laid','kraft'].includes(material)?material:'cotton';
  strength.value=safeNumber(opacity,0,100,18);
  document.body.dataset.stock=stock.value;
  document.documentElement.style.setProperty('--wash',strength.value/100);
  document.getElementById('washValue').value=strength.value+'%';
}
function restorePaper(){applyPaper(LS.get('away_stock','cotton'),LS.get('away_wash','18'));}
function savePaper(){
  applyPaper(stock.value,strength.value);
  LS.set('away_stock',stock.value);
  LS.set('away_wash',strength.value);
  broadcast('paper',{stock:stock.value,wash:strength.value});
}
stock.onchange=savePaper;
strength.oninput=savePaper;
/* ─────── Init / bootstrap ─────── */
{
  msg.textContent=LS.get('away_msg',msg.textContent);origText=msg.textContent;
  const oldIndex=Number(LS.get('away_shader','-1'));
  const originalExtras={21:'Liquid Marble',23:'Heat Haze',26:'Topo Glow',28:'Northern Veil'};
  const legacyName=oldIndex>=0&&oldIndex<13?SHADERS[oldIndex]?.name:originalExtras[oldIndex];
  const savedScene=LS.get('away_scene_name',legacyName||'Contour Lines');
  const index=SHADERS.findIndex(s=>s.name===savedScene);
  const linked=SHADERS.findIndex(s=>s.name===urlParams.get('scene'));
  cur=linked>=0?linked:index>=0?index:defaultScene;
  // Keep a custom palette when upgrading an old botanical display.
  const migrate=(!LS.get('away_scene_name','')&&!legacyName)||savedScene==='Botanical print';
  const color=(key,oldDefault,newDefault)=>{
    const stored=LS.get(key,newDefault);
    return migrate&&stored===oldDefault?newDefault:stored;
  };
  setColors({
    ink:color('away_ink','#26392e','#101329'),
    accent:color('away_acc','#cc5030','#817dfa'),
    tintA:color('away_tint','#acba96','#adb3ff'),
    tintB:color('away_tint2','#cf603c','#99f5db'),
    tintC:color('away_tint3','#314c39','#5549a5'),
    bri:Number(LS.get('away_bri','1')),
    sat:Number(LS.get('away_sat','1'))
  });
  if(linked<0)LS.set('away_scene_name',SHADERS[cur].name);
  restorePaper();
  const savedAnim = LS.get('away_anim','');
  pickAnim([...document.querySelectorAll('#animSeg button')].some(b=>b.dataset.a===savedAnim)?savedAnim:'');
  const savedScroll = LS.get('away_scroll','');
  if(['scroll-left','scroll-right'].includes(savedScroll)){
    // restore classes directly — setScroll would reset the shared epoch and
    // yank the ticker position on the other monitor
    curScroll = savedScroll;
    document.body.classList.add(savedScroll);
    document.querySelectorAll('#scrollSeg button').forEach(b=>b.classList.toggle('on',(b.dataset.s||'')===savedScroll));
  }
  const savedFont = LS.get('away_font','');
  pickFont(FONTS.some(f=>f[0]===savedFont)?savedFont:'Outfit');
  const savedSize = LS.get('away_size','');
  if(savedSize){ msg.style.fontSize = savedSize+'px'; szVal.textContent = savedSize+'px'; szR.value = savedSize; }
  setShuffle(LS.get('away_cycle','0')==='1', true);

  publishWidth();
  addEventListener('resize', ()=>{ publishWidth(); rebuildTicker(); updatePaperWorld(); });
  addEventListener('storage', (ev)=>{
    if(ev.key==='away_m1_width'){ monitor1Width = parseFloat(ev.newValue); rebuildTicker(); updatePaperWorld(); }
    if(ev.key==='away_m2_width'){ monitor2Width = parseFloat(ev.newValue); rebuildTicker(); updatePaperWorld(); }
    if(ev.key==='away_m1_height'){ monitor1Height = parseFloat(ev.newValue); }
    if(ev.key==='away_m2_height'){ monitor2Height = parseFloat(ev.newValue); }
    if(ev.key==='away_msg'&&ev.newValue!==origText)receiveMessage(ev.newValue||'');
    if(ev.key==='away_epoch'){ sharedEpoch = parseFloat(ev.newValue); }
  });
  // wait a tick so layout is ready then build
  requestAnimationFrame(()=>{ syncTickerStyle(); rebuildTicker(); updatePaperWorld(); broadcast('hello',{}); });
  // when this window closes (the secondary), clear its width so the primary stops offsetting
  if(isMonitor2){
    addEventListener('beforeunload', ()=>{
      LS.set('away_m2_width', 0);
      LS.set('away_m2_height', 0);
      broadcast('width', {monitor:2, w:0, h:0});
    });
  }
}

document.getElementById('pauseBtn').onclick=toggleMotion;
document.getElementById('dockPause').onclick=toggleMotion;
document.getElementById('motionR').oninput=e=>setMotion(Number(e.target.value),motionClock.paused);
document.getElementById('tog').onclick=()=>togglePanel();
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
const qualitySelect=document.getElementById('qualitySelect');qualitySelect.value=quality;
qualitySelect.onchange=()=>{quality=qualitySelect.value;LS.set('away_quality',quality);resize();showStatus('Quality · '+qualitySelect.selectedOptions[0].textContent);};
const durationSelect=document.getElementById('cycleDuration');
CYCLE_MS=safeNumber(LS.get('away_cycle_duration','30000'),15000,300000,30000);durationSelect.value=CYCLE_MS;
durationSelect.onchange=()=>{CYCLE_MS=Number(durationSelect.value);LS.set('away_cycle_duration',CYCLE_MS);broadcast('cycleDuration',{value:CYCLE_MS});};
const previousBC=bc?.onmessage;
if(bc)bc.onmessage=e=>{previousBC?.(e);if(e.data.type==='cycleDuration'){CYCLE_MS=safeNumber(e.data.data.value,15000,300000,30000);durationSelect.value=CYCLE_MS;}if(e.data.type==='hello'&&!isMonitor2)broadcast('cycleDuration',{value:CYCLE_MS});};
addEventListener('pagehide',()=>{audioStream?.getTracks().forEach(t=>t.stop());audioCtx?.close();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastFrame=0;}});
// Space and arrow keys on native fields remain available to the focused control.
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open'))togglePanel(false);});
document.getElementById('messageInput').value=origText;
document.getElementById('messageCount').textContent=Array.from(origText).length+' / 280';
const ranges=[...document.querySelectorAll('input[type=range]')];
function paintRanges(){
  for(const range of ranges){
    const percent=100*(Number(range.value)-Number(range.min))/(Number(range.max)-Number(range.min));
    range.style.setProperty('--fill',percent+'%');
  }
}
document.addEventListener('input',paintRanges);
document.addEventListener('click',paintRanges);
window.addEventListener('keydown',paintRanges);
if(bc){
  const receive=bc.onmessage;
  bc.onmessage=event=>{receive(event);paintRanges();};
}
paintRanges();
initialized=true;
applyMotionUI();refreshSelection();refreshFallback();
const legacyDurations={'a-shimmer':3.6,'a-neon':2.4,'a-rainbow':5,'a-breathe':3.4,'a-wobble':2.4,'a-chroma':1.8,'a-drift':6,'a-fade':4.2,'a-flicker':4.6,};
const motionStyles=document.createElement('style');motionStyles.textContent=Object.entries(legacyDurations).map(([a,t])=>`body.${a} #msg,body.${a} .ticker-item{animation-duration:calc(${t}s / var(--motion-speed))}`).join('\n');document.head.append(motionStyles);
