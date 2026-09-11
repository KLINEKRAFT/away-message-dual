import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';

// One lazy renderer for both the dimensional background and typography.
// No remote font/texture requests, post-processing targets, or per-frame geometry allocation.
export function createStage(canvas){
  const context=canvas.getContext('webgl2',{alpha:true,antialias:false});
  if(!context) return null;
  const renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:false});
  renderer.setClearColor(0,0);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);
  camera.position.z=9;
  const bg=new THREE.Group(),typeScene=new THREE.Scene(),typeCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,30);
  typeCamera.position.z=10;
  scene.add(bg,new THREE.HemisphereLight(0xffffff,0x222244,2.2));
  const light=new THREE.DirectionalLight(0xffffff,3.2);light.position.set(-4,6,8);scene.add(light);
  typeScene.add(new THREE.HemisphereLight(0xffffff,0x443377,3));
  const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(-2,3,5);typeScene.add(key);
  const dummy=new THREE.Object3D(),color=new THREE.Color(),font=new FontLoader().parse(fontData);
  let kind=-1,type='',textKey='',paletteKey='',sizeKey='',objects=[],textMesh=null,texture=null,rendered=false;

  function disposeGroup(group){
    const geometries=new Set(),materials=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>{if(Array.isArray(m))m.forEach(x=>x.dispose());else m.dispose();});
    group.clear();
  }
  function makeBackground(next){
    disposeGroup(bg);objects=[];kind=next;paletteKey='';
    if(next<0)return;
    if(next===2){
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.15,.46,.06),new THREE.MeshStandardMaterial({roughness:.28,metalness:.22}),140);
      mesh.frustumCulled=false;bg.add(mesh);objects=[mesh];
    }else if(next===3){
      const geometry=new THREE.PlaneGeometry(26,22,70,58);
      const mat=new THREE.MeshBasicMaterial({color:0x9966ff,wireframe:true,transparent:true,opacity:.48});
      const mesh=new THREE.Mesh(geometry,mat);mesh.rotation.x=-Math.PI*.39;mesh.position.set(0,-2,-3);bg.add(mesh);objects=[mesh];
    }else{
      const geo=next===0?new THREE.TorusGeometry(.65,.16,12,56):new THREE.TorusKnotGeometry(.66,.09,64,8,2,3);
      for(let i=0;i<(next===0?18:10);i++){
        const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({roughness:.24,metalness:.4}));bg.add(mesh);objects.push(mesh);
      }
    }
  }
  function makeText(s){
    disposeGroup(typeScene); // lights are reattached after replacing the text
    typeScene.add(new THREE.HemisphereLight(0xffffff,0x443377,3),key);
    texture?.dispose();texture=null;textMesh=null;type=s.effect;
    if(!type)return;
    // Fit explicit lines and wrap at word boundaries; keep a bound on GPU geometry.
    const text=s.text.trim().slice(0,280)||'AWAY';
    const cv=document.createElement('canvas');cv.width=2048;cv.height=1024;
    const ctx=cv.getContext('2d');let fs=150;ctx.font=`600 ${fs}px ${s.font}`;
    const lines=[];
    for(const line of text.split('\n')){
      let current='';for(const word of line.split(/\s+/)){
        if(current&&ctx.measureText(current+' '+word).width>1740){lines.push(current);current=word;}else current+=(current?' ':'')+word;
      }lines.push(current);
    }
    const maxWidth=Math.max(1,...lines.map(l=>ctx.measureText(l).width));
    fs*=Math.min(1,1740/maxWidth,760/(lines.length*180));
    ctx.font=`600 ${fs}px ${s.font}`;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>ctx.fillText(line,1024,512+(i-(lines.length-1)/2)*fs*1.18));
    if(type==='a-sculpt'&&/^[\x20-\x7e\n]*$/.test(text)){
      const group=new THREE.Group();
      const material=new THREE.MeshStandardMaterial({color:s.ink,metalness:.48,roughness:.28});
      const lineWidth=[];
      lines.forEach((line,i)=>{
        const geo=new TextGeometry(line||' ',{font,size:1,depth:.18,curveSegments:4,bevelEnabled:true,bevelSegments:1,bevelSize:.016,bevelThickness:.012});
        geo.computeBoundingBox();const width=geo.boundingBox.max.x-geo.boundingBox.min.x;geo.center();lineWidth.push(width);
        const m=new THREE.Mesh(geo,material);m.position.y=((lines.length-1)/2-i)*1.3;group.add(m);
      });
      const scale=Math.min(1.7/Math.max(...lineWidth,1),1.05/Math.max(lines.length,1));
      group.scale.setScalar(scale);group.userData.baseScale=scale;typeScene.add(group);textMesh=group;
    }else{
      texture=new THREE.CanvasTexture(cv);texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
      const material=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,uniforms:{map:{value:texture},time:{value:0},mode:{value:type==='a-ribbon'?0:type==='a-liquid'?1:2},ink:{value:new THREE.Color(s.ink)},accent:{value:new THREE.Color(s.accent)}},
        vertexShader:`varying vec2 vUv;uniform float time;uniform float mode;
          void main(){vUv=uv;vec3 p=position;
            if(mode<.5){p.y+=sin(p.x*3.+time*1.2)*.085;p.z+=cos(p.x*3.+time*1.2)*.18;}
            else if(mode<1.5){p.z+=sin(p.x*8.-time*1.6)*cos(p.y*5.+time)*.12;p.y+=sin(p.x*6.+time)*.025;}
            else {float a=sin(time*.8+p.x*2.)*.42;float y=p.y*cos(a)-p.z*sin(a);p.z=p.y*sin(a)+p.z*cos(a);p.y=y;}
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader:`varying vec2 vUv;uniform sampler2D map;uniform float time;uniform vec3 ink;uniform vec3 accent;
          void main(){float a=texture2D(map,vUv).a;if(a<.01)discard;vec3 c=mix(ink,accent,(.5+.5*sin(vUv.x*8.-time))*.2);gl_FragColor=vec4(c,a);}`});
      textMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,1,90,24),material);
      textMesh.userData.emWidth=Math.max(...lines.map(l=>ctx.measureText(l).width),1)/fs;
      textMesh.userData.inkFraction=Math.max(...lines.map(l=>ctx.measureText(l).width),1)/2048;
      textMesh.userData.inkHeight=lines.length*fs*1.18/1024;
      typeScene.add(textMesh);
    }
  }
  function frame(s){
    const active=s.background>=0||!!s.effect;
    if(!active){if(rendered){renderer.clear();rendered=false;}return;}
    rendered=true;
    const sk=[s.width,s.height,s.dpr,s.world.w,s.world.h,s.offset].join(':');
    if(sk!==sizeKey){sizeKey=sk;renderer.setPixelRatio(s.dpr);renderer.setSize(s.width,s.height,false);
      camera.aspect=s.world.w/s.world.h;camera.setViewOffset(s.world.w,s.world.h,s.offset,0,s.width,s.height);camera.updateProjectionMatrix();
    }
    if(s.background!==kind)makeBackground(s.background);
    const pk=s.colors.join(':');
    if(pk!==paletteKey){paletteKey=pk;objects.forEach((o,i)=>{
      if(o.isInstancedMesh){for(let j=0;j<o.count;j++)o.setColorAt(j,color.set(s.colors[j%3]));o.instanceColor.needsUpdate=true;}
      else{o.material.color.set(s.colors[i%3]);}
    });}
    const t=s.time;
    if(kind===2){const mesh=objects[0];for(let i=0;i<mesh.count;i++){
      const seed=i*2.39996;dummy.position.set(Math.sin(seed)*9,((i*.7+t*.3)%12)-6,Math.cos(seed*1.7)*3-2);
      dummy.rotation.set(t*.18+seed,t*.22+seed*2,seed+t*.16);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    }mesh.instanceMatrix.needsUpdate=true;}
    else if(kind===3){const pos=objects[0].geometry.attributes.position;for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i);pos.setZ(i,Math.sin(x*.38+t*.4)*Math.cos(y*.3+t*.3)*.9+Math.sin(x*.6+y*.45-t*.3)*.3);
    }pos.needsUpdate=true;}
    else{objects.forEach((o,i)=>{
      const a=i*2.39996,rad=2.8+(i%4)*.72;o.position.set(Math.cos(a+t*.06)*rad,Math.sin(a+t*.06)*rad*.7,Math.sin(a*1.7)*2-1);
      o.rotation.set(t*.15+i,t*.13+i*.8,t*.09);o.scale.setScalar(.65+(i%3)*.3);
    });}
    const tk=[s.effect,s.text,s.font,s.fontRevision].join('|');
    if(tk!==textKey){textKey=tk;makeText(s);}
    renderer.autoClear=true;renderer.render(scene,camera);
    if(textMesh){
      const availableWidth=s.width-s.panelWidth;
      const heightLimit=textMesh.isGroup?Infinity:s.height*.58*2*textMesh.userData.inkFraction/textMesh.userData.inkHeight;
      const desired=Math.min(availableWidth*.8,heightLimit,s.fontSize*(textMesh.userData.emWidth||6.5));
      // Typeface is rendered independently per monitor, like the original centered message.
      const widthNDC=desired/s.width*2;
      textMesh.position.x=-s.panelWidth/s.width;
      if(textMesh.isGroup){textMesh.scale.setScalar(textMesh.userData.baseScale*widthNDC/1.7);textMesh.rotation.y=Math.sin(t*.55)*.22;textMesh.rotation.x=Math.sin(t*.42)*.08;textMesh.traverse(o=>o.material?.color?.set(s.ink));}
      else{const planeWidth=widthNDC/textMesh.userData.inkFraction;textMesh.scale.set(planeWidth/2,planeWidth*s.width/s.height/2,1);textMesh.material.uniforms.time.value=t;textMesh.material.uniforms.ink.value.set(s.ink);textMesh.material.uniforms.accent.value.set(s.accent);}
      renderer.autoClear=false;renderer.clearDepth();renderer.render(typeScene,typeCamera);renderer.autoClear=true;
    }
  }
  return {frame,dispose(){disposeGroup(bg);disposeGroup(typeScene);texture?.dispose();renderer.dispose();}};
}
