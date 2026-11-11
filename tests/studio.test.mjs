import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as effects from '../effects.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'');
function app({seed={},reduced=false,url='https://away.test/'}={}){
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,frames=[],sent=[];
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.matchMedia=()=>({matches:reduced});
  w.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
  w.document.fonts={ready:{then(callback){callback();}}};
  w.BroadcastChannel=class{postMessage(msg){sent.push(msg)}close(){}};
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent},set(v){this.textContent=v}});
  for(const [key,value]of Object.entries(seed))w.localStorage.setItem(key,value);
  const context=dom.getInternalVMContext();Object.assign(context,effects);
  const script=new vm.Script(source,{filename:new URL('../app.js',import.meta.url).pathname});
  script.runInContext(context);
  return {w,dom,sent,run:code=>vm.runInContext(code,context),frame(){const fn=frames.shift();fn?.(performance.now());},close(){w.close();}};
}
function click(a,id){a.w.document.getElementById(id).click();}
function input(a,id,value){const e=a.w.document.getElementById(id);e.value=value;e.dispatchEvent(new a.w.Event('input',{bubbles:true}));}

test('motion studio opens without WebGL and exposes only the retained library',()=>{
  const a=app();try{
    const doc=a.w.document;
    assert.equal(doc.querySelectorAll('#sceneSelect option').length,24);
    assert.equal(doc.querySelectorAll('#bgList button').length,8);
    assert.equal(doc.querySelectorAll('#fontList button').length,4);
    assert.equal(doc.body.dataset.scene,'motion');
    assert.ok(doc.getElementById('clock').textContent);
    a.frame();click(a,'tog');
    assert.equal(doc.getElementById('tog').getAttribute('aria-expanded'),'true');
  }finally{a.close();}
});
test('legacy scenes and removed fonts and motion migrate without losing the message',()=>{
  for(const [index,name] of [[12,'Bokeh Drift'],[21,'Liquid Marble'],[33,'Contour Lines']]){
    const a=app({seed:{away_shader:String(index),away_font:'Bebas',away_anim:'a-sculpt',away_msg:'Back at noon'}});
    try{
      assert.equal(a.w.document.getElementById('sceneSelect').value,name);
      assert.equal(a.run('curAnim'),'');
      assert.equal(a.run('origText'),'Back at noon');
      assert.equal(a.w.localStorage.getItem('away_font'),'Outfit');
    }finally{a.close();}
  }
});
test('message editing survives animated type, remote updates and reload',()=>{
  const a=app();try{
    input(a,'messageInput','Gone for coffee\nBack soon');
    a.run("pickAnim('a-wave')");
    assert.equal(a.w.document.getElementById('msg').textContent,'Gone for coffee\nBack soon');
    assert.equal(a.w.localStorage.getItem('away_msg'),'Gone for coffee\nBack soon');
    a.run("receiveMessage('A different message')");
    assert.equal(a.run('origText'),'A different message');
    assert.equal(a.w.document.querySelectorAll('.letter-word').length,3);
    assert.equal(a.w.document.getElementById('messageInput').value,'A different message');
    const b=app({seed:{away_msg:'Saved message',away_anim:'a-type'}});try{assert.equal(b.run('origText'),'Saved message');}finally{b.close();}
  }finally{a.close();}
});
test('native controls keep keyboard shortcuts from changing the scene',()=>{
  const a=app();try{
    for(const id of ['messageInput','backAt','motionR','qualitySelect']){
      const e=a.w.document.getElementById(id);e.focus();const before=a.run('cur');
      e.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'b',bubbles:true}));assert.equal(a.run('cur'),before);
    }
  }finally{a.close();}
});
test('pause and speed use continuous synchronized clocks',()=>{
  const c={at:1000,value:10,speed:2,paused:false};
  const pause=effects.advanceClock(c,3000,2,true);assert.equal(pause.value,14);assert.equal(effects.clockValue(pause,8000),14);
  const resume=effects.advanceClock(pause,8000,.5,false);assert.equal(effects.clockValue(resume,10000),15);
  const fast=effects.advanceClock(resume,10000,2,false);assert.equal(fast.value,15);assert.equal(effects.clockValue(fast,11000),17);
});
test('reduced-motion preference pauses all motion on first visit',()=>{
  const a=app({reduced:true});try{assert.ok(a.w.document.body.classList.contains('motion-paused'));click(a,'dockPause');assert.equal(a.w.document.body.classList.contains('motion-paused'),false);}finally{a.close();}
});
test('Featured scene selection and keyboard tabs reveal the intended controls',()=>{
  const a=app();try{
    a.w.document.querySelector('[data-tab=scene]').click();
    assert.equal(a.w.document.getElementById('scenePane').hidden,false);
    a.w.document.querySelector('#bgList [data-scene="Tidal Bands"]').click();
    assert.equal(a.w.document.getElementById('sceneSelect').value,'Tidal Bands');
    a.w.document.querySelector('[data-tab=scene]').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(a.w.document.getElementById('typePane').hidden,false);
  }finally{a.close();}
});
test('second-display message, motion, colors and selections synchronize',()=>{
  const a=app(),b=app({url:'https://away.test/?monitor=2'});try{
    a.run("receiveMessage('Two screens');saveMessage();pickShader(19);setMotion(.7,true);setColors({tintB:'#ff4455'});pickAnim('a-echo')");
    for(const message of a.sent)b.run('bc.onmessage({data:'+JSON.stringify(message)+'})');
    assert.equal(b.run('origText'),'Two screens');assert.equal(b.run('cur'),19);assert.equal(b.run('curAnim'),'a-echo');
    assert.equal(b.w.document.getElementById('cShdB').value,'#ff4455');assert.ok(b.w.document.body.classList.contains('motion-paused'));
  }finally{a.close();b.close();}
});
test('quick timers display and clear a real countdown',()=>{
  const a=app();try{a.w.document.querySelector('[data-minutes="15"]').click();assert.ok(a.w.document.getElementById('countdown').classList.contains('show'));assert.ok(a.w.document.getElementById('backAt').value);click(a,'backAtClr');assert.equal(a.w.document.getElementById('countdown').classList.contains('show'),false);}finally{a.close();}
});
test('stock and a zero-strength wash survive reopening and sync to a second display',()=>{
  const a=app(),b=app({url:'https://away.test/?monitor=2'});
  try{
    a.run("stock.value='kraft';strength.value='0';savePaper()");
    for(const message of a.sent)b.run('bc.onmessage({data:'+JSON.stringify(message)+'})');
    assert.equal(b.w.document.body.dataset.stock,'kraft');
    assert.equal(b.w.document.getElementById('washValue').value,'0%');
    const reopened=app({seed:{...a.w.localStorage}});
    try{assert.equal(reopened.w.document.body.dataset.stock,'kraft');assert.equal(reopened.w.document.getElementById('wash').value,'0');}
    finally{reopened.close();}
  }finally{a.close();b.close();}
});

test('botanical settings migrate to contours and example links open the named scene',()=>{
  for(const [url,scene] of [['https://away.test/','Contour Lines'],['https://away.test/?scene=Light+Ribbons','Light Ribbons']]){
    const a=app({url,seed:{away_scene_name:'Botanical print',away_msg:'Back soon',away_tint:'#121212'}});
    try{
      assert.equal(a.w.document.getElementById('sceneSelect').value,scene);
      assert.equal(a.w.document.getElementById('cShd').value,'#121212');
      assert.equal(a.w.document.getElementById('msg').textContent,'Back soon');
      assert.equal(a.w.document.querySelector('#mast,#badge,#printCaption'),null);
      input(a,'cSat','50');
      assert.equal(a.w.document.getElementById('cSat').style.getPropertyValue('--fill'),'25%');
    }finally{a.close();}
  }
});
