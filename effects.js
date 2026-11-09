export const EXTRA_SHADERS = [
  {name:'Liquid Marble',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.)*2.;float t=u_t*.08;
    vec2 q=vec2(fbm(p+t),fbm(p+vec2(4.2,1.3)-t));
    float f=fbm(p+q*3.+vec2(t,-t));float veins=.5+.5*sin(f*24.+q.x*4.);
    vec3 c=mix(u_c3*.25,u_c,smoothstep(.1,.85,veins));c=mix(c,u_c2,pow(max(veins,0.),8.)*.85);
    gl_FragColor=vec4(c,1.);
  }`},
  {name:'Heat Haze',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.13;
    float f=fbm(p*2.+vec2(0.,-t));float s=.5+.5*sin(uv.y*5.+f*6.-t);
    vec3 c=mix(u_c3,u_c,s);c=mix(c,u_c2,pow(s,3.)*.7);
    float glow=exp(-length(p-vec2(.5*u_r.x/u_r.y,.5))*2.);gl_FragColor=vec4(c*(.45+.55*glow),1.);
  }`},
  {name:'Topo Glow',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.05;
    float v=fbm(p*2.+t)+.22*sin(p.x*3.+p.y*2.-t);
    float d=abs(fract(v*13.)-.5);float line=exp(-d*35.);
    vec3 c=mix(u_c,u_c2,.5+.5*sin(v*7.+t));gl_FragColor=vec4(u_c3*.09+c*(line*.9+exp(-d*7.)*.15),1.);
  }`},
  {name:'Northern Veil',group:'Organic',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;vec2 p=uv*vec2(u_r.x/u_r.y,1.);float t=u_t*.1;
    float f=fbm(vec2(p.x*3.+t,uv.y*.5));float band=.4+sin(p.x*2.+t)*.15+f*.22;
    float curtain=exp(-abs(uv.y-band)*7.)*(.35+.65*fbm(vec2(p.x*25.-t,uv.y*2.)));
    vec3 c=mix(u_c2,u_c,.5+.5*sin(p.x*2.+t));gl_FragColor=vec4(u_c3*.1+c*curtain,1.);
  }`},
  {name:'Tidal Bands',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;
    float t=u_t*.12;
    float x=uv.x*u_r.x/u_r.y;
    float height=uv.y+.16*sin(x*2.8+t)+.07*sin(x*5.1-t*.7);
    float phase=height*5.5;
    float band=fract(phase);
    float crest=smoothstep(.77,.99,band);
    float light=.5+.5*cos(phase*.84-.4);
    vec3 body=mix(u_c3,u_c,light*.82+.08);
    gl_FragColor=vec4(mix(body,u_c2,crest*.55),1.);
  }`},
  {name:'Light Ribbons',src:`void main(){
    vec2 uv=gl_FragCoord.xy/u_r;
    float x=uv.x*u_r.x/u_r.y;
    float t=u_t*.14;
    vec3 color=mix(u_c3*.18,u_c*.36,uv.y);
    for(int i=0;i<3;i++){
      float k=float(i);
      float arc=.3+.1*k+.27*sin(x*1.8+t*.6+k*.5)+.12*sin(x*3.5-t*.4+.4*k);
      float d=uv.y-arc;
      float ribbon=exp(-abs(d)*mix(10.,80.,step(0.,d)));
      color+=mix(u_c,u_c2,k*.42)*ribbon*.60;
    }
    gl_FragColor=vec4(color,1.);
  }`},
];
// Pure helpers shared by runtime and regression tests.
export function advanceClock(clock, now, speed=clock.speed, paused=clock.paused){
  const elapsed=Math.max(0,now-clock.at)/1000;
  return {at:now,value:clock.value+(clock.paused?0:elapsed*clock.speed),speed,paused};
}
export function clockValue(clock,now){return clock.value+(clock.paused?0:Math.max(0,now-clock.at)/1000*clock.speed);}
export function validHex(value){return typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);}
export function safeNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
