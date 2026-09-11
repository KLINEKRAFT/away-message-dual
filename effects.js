// Original procedural effects. All sample the same world coordinates on both displays.
export const EXTRA_SHADERS = [
  {name:'Acid Bloom',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r; vec2 p=(uv-.5)*vec2(u_r.x/u_r.y,1.)*3.; float t=u_t*.22;
    p+=.28*vec2(sin(p.y*2.+t),cos(p.x*2.-t));
    float v=sin(length(p)*5.-t*2.+sin(atan(p.y,p.x)*5.+t));
    float w=.5+.5*sin(v*2.8+p.x*.8+t);
    vec3 c=mix(u_c3,u_c,smoothstep(.1,.85,w)); c=mix(c,u_c2,smoothstep(.65,.95,.5+.5*cos(v*4.-t))*.8);
    gl_FragColor=vec4(c*(.55+.45*w),1.);
  }`},
  {name:'Op Art',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r; vec2 p=(uv-.5)*vec2(u_r.x/u_r.y,1.); float t=u_t*.17;
    p.x+=sin(p.y*5.+t)*.15; p.y+=cos(p.x*4.-t)*.13;
    float bands=.5+.5*sin(p.x*25.+sin(p.y*9.+t)*3.);
    vec3 col=mix(u_c3,u_c,smoothstep(.44,.56,bands));
    col=mix(col,u_c2,smoothstep(.2,.9,uv.y)*.38);
    gl_FragColor=vec4(col,1.);
  }`},
  {name:'Chroma Tunnel',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r; vec2 p=(uv-mix(vec2(.5),u_m,.12))*vec2(u_r.x/u_r.y,1.);
    float r=max(length(p),.04),a=atan(p.y,p.x),t=u_t*.24;
    float rings=.5+.5*sin(log(r)*14.-t*5.+sin(a*6.+t)*1.5);
    vec3 c=mix(u_c3,u_c,smoothstep(.15,.85,rings)); c=mix(c,u_c2,(.5+.5*sin(a*3.-t))*.55);
    gl_FragColor=vec4(c*smoothstep(0.,.2,r),1.);
  }`},
  {name:'Liquid Marble',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.)*2.;float t=u_t*.08;
    vec2 q=vec2(fbm(p+t),fbm(p+vec2(4.2,1.3)-t));
    float f=fbm(p+q*3.+vec2(t,-t));float veins=.5+.5*sin(f*24.+q.x*4.);
    vec3 c=mix(u_c3*.25,u_c,smoothstep(.1,.85,veins));c=mix(c,u_c2,pow(max(veins,0.),8.)*.85);
    gl_FragColor=vec4(c,1.);
  }`},
  {name:'Moire Waves',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=(uv-.5)*vec2(u_r.x/u_r.y,1.);float t=u_t*.13;
    float a=length(p-vec2(sin(t)*.3,cos(t)*.16)),b=length(p+vec2(cos(t*.7)*.3,sin(t)*.25));
    float x=.5+.5*sin(a*70.),y=.5+.5*sin(b*70.);float z=x*y;
    vec3 c=mix(u_c3*.25,u_c,z);c=mix(c,u_c2,abs(x-y)*.65);gl_FragColor=vec4(c,1.);
  }`},
  {name:'Heat Haze',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.13;
    float f=fbm(p*2.+vec2(0.,-t));float s=.5+.5*sin(uv.y*5.+f*6.-t);
    vec3 c=mix(u_c3,u_c,s);c=mix(c,u_c2,pow(s,3.)*.7);
    float glow=exp(-length(p-vec2(.5*u_r.x/u_r.y,.5))*2.);gl_FragColor=vec4(c*(.45+.55*glow),1.);
  }`},
  {name:'Disco Tiles',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.)*9.;float t=u_t*.4;
    vec2 id=floor(p),f=fract(p);float v=.5+.5*sin(t+h(id)*6.283+length(id)*.4);
    float edge=smoothstep(.02,.07,f.x)*smoothstep(.02,.07,f.y)*(1.-smoothstep(.93,.98,f.x))*(1.-smoothstep(.93,.98,f.y));
    vec3 col=mix(u_c3,u_c,v);col=mix(col,u_c2,smoothstep(.55,.95,h(id+9.)));
    gl_FragColor=vec4(col*(.25+.75*v)*edge+u_c3*.03,1.);
  }`},
  {name:'Prism Fold',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=(uv-.5)*vec2(u_r.x/u_r.y,1.);float t=u_t*.16;
    float r=length(p),a=atan(p.y,p.x)+t; a=abs(mod(a,1.0472)-.5236);
    p=vec2(cos(a),sin(a))*r;float v=.5+.5*sin(p.x*16.+sin(p.y*15.-t)*3.);
    vec3 c=mix(u_c3,u_c,smoothstep(.1,.9,v));c=mix(c,u_c2,(.5+.5*cos(r*12.-t*2.))*.6);
    gl_FragColor=vec4(c*(.45+.55*v),1.);
  }`},
  {name:'Topo Glow',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.05;
    float v=fbm(p*2.+t)+.22*sin(p.x*3.+p.y*2.-t);
    float d=abs(fract(v*13.)-.5);float line=exp(-d*35.);
    vec3 c=mix(u_c,u_c2,.5+.5*sin(v*7.+t));gl_FragColor=vec4(u_c3*.09+c*(line*.9+exp(-d*7.)*.15),1.);
  }`},
  {name:'Halftone Pop',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.)*48.;vec2 id=floor(p),f=fract(p)-.5;
    float t=u_t*.25;float v=.5+.5*sin(id.x*.12+sin(id.y*.15+t)*2.-t);
    float dot=1.-smoothstep(.01+v*.38,.045+v*.38,length(f));vec3 bg=mix(u_c3,u_c2,v*.35);
    gl_FragColor=vec4(mix(bg,u_c,dot),1.);
  }`},
  {name:'Northern Veil',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.1;
    float f=fbm(vec2(p.x*3.+t,uv.y*.5));float band=.4+sin(p.x*2.+t)*.15+f*.22;
    float curtain=exp(-abs(uv.y-band)*7.)*(.35+.65*fbm(vec2(p.x*25.-t,uv.y*2.)));
    vec3 c=mix(u_c2,u_c,.5+.5*sin(p.x*2.+t));gl_FragColor=vec4(u_c3*.1+c*curtain,1.);
  }`},
  {name:'Groove Rings',group:'Funky',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=(uv-.5)*vec2(u_r.x/u_r.y,1.);float t=u_t*.15;
    p+=vec2(sin(t),cos(t*.7))*.12;float a=atan(p.y,p.x);float r=length(p)+sin(a*3.+t)*.07;
    float v=.5+.5*sin(r*36.-t*4.);vec3 col=mix(u_c3,u_c,smoothstep(.3,.7,v));
    col=mix(col,u_c2,smoothstep(.3,.8,.5+.5*sin(a+r*10.+t))*.55);gl_FragColor=vec4(col,1.);
  }`},
  ...['Orbitals','Ribbon Universe','Confetti Space','Wire Landscape'].map((name,i)=>({name,group:'3D',three:i,src:`void main(){vec2 uv=gl_FragCoord.xy/u_r;float g=exp(-distance(uv,vec2(.5)) *3.);gl_FragColor=vec4(u_c3*.06+mix(u_c3,u_c2,uv.y)*g*.15,1.);}`})),
];

export const EXTRA_THEMES = [
  ['Acid Punch','#fbffe5','#e4ff43','#dbff46','#ff5486','#4624bc'],
  ['Hot Signal','#fff6d8','#ff542f','#ff6538','#ffe64e','#38154a'],
  ['Poolside','#effffa','#8cffe0','#00ced1','#98ffbf','#2148b0'],
  ['Ultraviolet','#f9f0ff','#ef88ff','#935bff','#ff75df','#19144f'],
  ['Cobalt Club','#f5f7ff','#a3ffed','#215bff','#73ffdd','#111e72'],
  ['Pink Lemonade','#fffbea','#fff568','#ff629c','#ffed72','#aa2459'],
  ['After Hours','#f0e9ff','#ff6385','#e12e77','#785bff','#140b36'],
  ['Tangerine Dream','#fff7e7','#ffcf71','#ff762a','#ffcf51','#853b9b'],
  ['Electric Lime','#f5ffed','#d3ff3d','#b4f926','#24e4af','#084648'],
  ['Cherry Cola','#fff0dd','#ffa592','#df355b','#ff9d64','#370e38'],
  ['Blue Hour','#f0f7ff','#78c8ff','#568aff','#a6b3ff','#151d54'],
  ['Disco Peach','#fff5eb','#ffb6be','#ffb394','#f176ff','#7125c1'],
  ['Laser Tag','#f8fff4','#6eff77','#02edba','#f06dff','#31105c'],
  ['Ink & Cream','#fff7df','#f2b45e','#fff0c4','#cf8555','#191b29'],
  ['Miami Vice','#fff3fc','#ff6ddb','#ff5fae','#47e8f5','#251c6a'],
  ['Bauhaus','#fffaf0','#f4b927','#ed4936','#f6c94a','#2147a8'],
];

export const TEXT_EFFECTS = [
  ['a-wave','Letter wave'],['a-bounce','Bounce'],['a-echo','Color echo'],
  ['a-outline','Outline'],['a-gradient','Color flow'],['a-squeeze','Elastic'],
  ['a-ribbon','3D ribbon'],['a-liquid','3D ripple'],['a-twist','3D twist'],['a-sculpt','3D sculpture'],
];
export const THREE_TEXT = ['a-ribbon','a-liquid','a-twist','a-sculpt'];

export const EXTRA_PRESETS = [
  ['Acid House','Acid Bloom','Syne','a-wave','Acid Punch'],
  ['Pool Party','Liquid Marble','Outfit','a-ribbon','Poolside'],
  ['Afterparty','Chroma Tunnel','Bebas','a-echo','After Hours'],
  ['Disco Club','Disco Tiles','Monoton','a-bounce','Miami Vice'],
  ['Paper Jam','Halftone Pop','Syne','a-outline','Bauhaus'],
  ['Liquid Type','Liquid Marble','Epilogue','a-liquid','Ultraviolet'],
  ['Twisted','Prism Fold','Syne','a-twist','Cobalt Club'],
  ['Orbit Club','Orbitals','Outfit','a-float','Electric Lime'],
  ['Sculpture','Ribbon Universe','Syne','a-sculpt','Disco Peach'],
  ['Confetti','Confetti Space','Bebas','a-bounce','Hot Signal'],
  ['Night Drive','Wire Landscape','Bebas','a-neon','Miami Vice'],
  ['Slow Sunday','Northern Veil','Cormorant','a-drift','Blue Hour'],
].map(([name,shader,font,anim,theme])=>{
  const colors=EXTRA_THEMES.find(t=>t[0]===theme);
  return {name,shader,font,anim,scroll:'',ink:colors[1],accent:colors[2],tint:colors[3],b:colors[4],c:colors[5],speed:100,pmode:'off',motion:1};
});

// Pure helpers shared by runtime and regression tests.
export function advanceClock(clock, now, speed=clock.speed, paused=clock.paused){
  const elapsed=Math.max(0,now-clock.at)/1000;
  return {at:now,value:clock.value+(clock.paused?0:elapsed*clock.speed),speed,paused};
}
export function clockValue(clock,now){return clock.value+(clock.paused?0:Math.max(0,now-clock.at)/1000*clock.speed);}
export function validHex(value){return typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);}
export function safeNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
