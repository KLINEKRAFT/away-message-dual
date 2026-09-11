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

test('a missing GPU still initializes all backgrounds, palettes, controls and the clock',()=>{
  const a=app();try{
    assert.equal(a.w.document.querySelectorAll('#bgList button').length,34);
    assert.equal(a.w.document.querySelectorAll('#swList button').length,24);
    assert.equal(a.w.document.querySelectorAll('#presetList button').length,24);
    assert.ok(a.w.document.getElementById('clock').textContent.length>0);
    assert.ok(a.w.document.body.classList.contains('no-webgl'));
    a.frame();assert.equal(a.w.document.getElementById('renderNotice').hidden,false);
    click(a,'editBtn');assert.equal(a.w.document.getElementById('tog').getAttribute('aria-expanded'),'true');
  }finally{a.close();}
});
test('every shipped preset applies valid selections without losing the message',()=>{
  const a=app();try{
    for(const button of a.w.document.querySelectorAll('#presetList button')){
      button.click();assert.equal(a.run('origText'),'Be right back');
      assert.equal(a.w.document.querySelectorAll('#bgList button.on').length,1);
      assert.equal(a.w.document.querySelectorAll('#animSeg button.on').length,1);
      assert.equal(a.w.document.querySelectorAll('#fontList button.on').length,1);
    }
  }finally{a.close();}
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
test('shuffle undo restores the complete look',()=>{
  const a=app();try{
    a.run("setColors({sat:0});applySizeFromSync({fontSize:112});setMotion(.5,false)");
    const before=JSON.stringify(a.run('captureConfig()'));
    click(a,'randomBtn');click(a,'undoBtn');
    assert.equal(JSON.stringify(a.run('captureConfig()')),before);
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
test('background category filter and keyboard tabs reveal the intended controls',()=>{
  const a=app();try{
    a.w.document.querySelector('[data-tab=scene]').click();
    assert.equal(a.w.document.getElementById('scenePane').hidden,false);
    a.w.document.querySelector('[data-filter="3D"]').click();
    assert.equal(a.w.document.querySelectorAll('#bgList button:not([hidden])').length,4);
    a.w.document.querySelector('[data-tab=scene]').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(a.w.document.getElementById('typePane').hidden,false);
  }finally{a.close();}
});
test('second-display message, motion, colors and selections synchronize',()=>{
  const a=app(),b=app({url:'https://away.test/?monitor=2'});try{
    a.run("receiveMessage('Two screens');saveMessage();pickShader(21);setMotion(.7,true);setColors({tintB:'#ff4455'});pickAnim('a-echo')");
    for(const message of a.sent)b.run('bc.onmessage({data:'+JSON.stringify(message)+'})');
    assert.equal(b.run('origText'),'Two screens');assert.equal(b.run('cur'),21);assert.equal(b.run('curAnim'),'a-echo');
    assert.equal(b.w.document.getElementById('cShdB').value,'#ff4455');assert.ok(b.w.document.body.classList.contains('motion-paused'));
  }finally{a.close();b.close();}
});
test('quick timers display and clear a real countdown',()=>{
  const a=app();try{a.w.document.querySelector('[data-minutes="15"]').click();assert.ok(a.w.document.getElementById('countdown').classList.contains('show'));assert.ok(a.w.document.getElementById('backAt').value);click(a,'backAtClr');assert.equal(a.w.document.getElementById('countdown').classList.contains('show'),false);}finally{a.close();}
});
test('saving Mine restores zero saturation and the chosen text effect',()=>{
  const a=app();try{a.run("setColors({sat:0});pickAnim('a-echo')");click(a,'savePresetBtn');a.run("setColors({sat:1});pickAnim('')");[...a.w.document.querySelectorAll('#presetList button')].find(b=>b.textContent==='Mine').click();assert.equal(a.run('sat'),0);assert.equal(a.run('curAnim'),'a-echo');}finally{a.close();}
});
