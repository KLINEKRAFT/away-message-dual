import ctypes as C, json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/away-qa')
E=C.CDLL('libEGL.so.1');E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=C.c_void_p
I=C.c_int;P=C.c_void_p;U=C.c_uint;F=C.c_float

def proc(n,ret,args):
 p=E.eglGetProcAddress(n.encode())
 if not p:raise RuntimeError(n)
 return C.CFUNCTYPE(ret,*args)(p)
def egl(n,ret,args):
 f=getattr(E,n);f.restype=ret;f.argtypes=args;return f
getDisplay=proc('eglGetPlatformDisplayEXT',P,[U,P,C.POINTER(I)])
display=getDisplay(0x31DD,None,None)
a=I();b=I();assert egl('eglInitialize',U,[P,C.POINTER(I),C.POINTER(I)])(display,C.byref(a),C.byref(b))
attrs=(I*13)(0x3033,1,0x3040,4,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3038)
config=P();num=I();assert egl('eglChooseConfig',U,[P,C.POINTER(I),C.POINTER(P),I,C.POINTER(I)])(display,attrs,C.byref(config),1,C.byref(num)) and num.value
assert egl('eglBindAPI',U,[U])(0x30A0)
ctx=egl('eglCreateContext',P,[P,P,P,C.POINTER(I)])(display,config,None,(I*3)(0x3098,2,0x3038))
W,H=360,220
surf=egl('eglCreatePbufferSurface',P,[P,P,C.POINTER(I)])(display,config,(I*5)(0x3057,W,0x3056,H,0x3038))
assert egl('eglMakeCurrent',U,[P,P,P,P])(display,surf,surf,ctx)
GetString=proc('glGetString',C.c_char_p,[U]);print('Renderer:',GetString(0x1F01).decode())
CreateShader=proc('glCreateShader',U,[U]);ShaderSource=proc('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)]);CompileShader=proc('glCompileShader',None,[U]);GetShaderiv=proc('glGetShaderiv',None,[U,U,C.POINTER(I)]);ShaderLog=proc('glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p]);CreateProgram=proc('glCreateProgram',U,[]);AttachShader=proc('glAttachShader',None,[U,U]);LinkProgram=proc('glLinkProgram',None,[U]);GetProgramiv=proc('glGetProgramiv',None,[U,U,C.POINTER(I)]);ProgramLog=proc('glGetProgramInfoLog',None,[U,I,C.POINTER(I),C.c_char_p]);Use=proc('glUseProgram',None,[U]);GetAttrib=proc('glGetAttribLocation',I,[U,C.c_char_p]);GetUniform=proc('glGetUniformLocation',I,[U,C.c_char_p]);Uniform1=proc('glUniform1f',None,[I,F]);Uniform2=proc('glUniform2f',None,[I,F,F]);Uniform3=proc('glUniform3f',None,[I,F,F,F]);EnableAttrib=proc('glEnableVertexAttribArray',None,[U]);AttribPointer=proc('glVertexAttribPointer',None,[U,I,U,U,I,P]);GenBuffers=proc('glGenBuffers',None,[I,C.POINTER(U)]);BindBuffer=proc('glBindBuffer',None,[U,U]);BufferData=proc('glBufferData',None,[U,C.c_ssize_t,P,U]);Viewport=proc('glViewport',None,[I,I,I,I]);DrawArrays=proc('glDrawArrays',None,[U,I,I]);Read=proc('glReadPixels',None,[I,I,I,I,U,U,P]);Finish=proc('glFinish',None,[]);DeleteProgram=proc('glDeleteProgram',None,[U]);DeleteShader=proc('glDeleteShader',None,[U])
def shader(t,src):
 x=CreateShader(t);encoded=src.encode();ptr=C.c_char_p(encoded);ShaderSource(x,1,C.byref(ptr),None);CompileShader(x);status=I();GetShaderiv(x,0x8B81,C.byref(status))
 if not status.value:
  buf=C.create_string_buffer(8192);ShaderLog(x,8192,None,buf);raise RuntimeError(buf.value.decode())
 return x
programs=json.loads((OUT/'shaders.json').read_text());images=[]
verts=(F*6)(-1,-1,3,-1,-1,3);buffer=U();GenBuffers(1,C.byref(buffer));BindBuffer(0x8892,buffer);BufferData(0x8892,C.sizeof(verts),verts,0x88E4)
for i,p in enumerate(programs):
 try:
  vs=shader(0x8B31,p['vert']);fs=shader(0x8B30,p['frag']);pr=CreateProgram();AttachShader(pr,vs);AttachShader(pr,fs);LinkProgram(pr);status=I();GetProgramiv(pr,0x8B82,C.byref(status))
  if not status.value:
   buf=C.create_string_buffer(8192);ProgramLog(pr,8192,None,buf);raise RuntimeError(buf.value.decode())
  Use(pr)
  if not p.get('compileOnly'):
   loc=GetAttrib(pr,b'p');EnableAttrib(loc);AttribPointer(loc,2,0x1406,0,0,None);Viewport(0,0,W,H)
   for name,value in {'u_r':(W,H),'u_world':(W,H),'u_off':(0,0),'u_m':(.5,.5)}.items():Uniform2(GetUniform(pr,name.encode()),*value)
   for name,value in {'u_c':(.859,1,.275),'u_c2':(1,.329,.525),'u_c3':(.275,.141,.737),'u_ck':(.5,.5,8)}.items():Uniform3(GetUniform(pr,name.encode()),*value)
   Uniform1(GetUniform(pr,b'u_t'),20);Uniform1(GetUniform(pr,b'u_au'),0)
   DrawArrays(4,0,3);Finish();pixels=(C.c_ubyte*(W*H*4))();Read(0,0,W,H,0x1908,0x1401,pixels)
   im=Image.frombytes('RGBA',(W,H),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB');im.save(OUT/('%02d.png'%i))
   thumb=Image.new('RGB',(W,H+32),'#15161c');thumb.paste(im,(0,0));ImageDraw.Draw(thumb).text((12,H+9),p['name'],fill='white');images.append(thumb)
  print('PASS',p['name']);DeleteProgram(pr);DeleteShader(vs);DeleteShader(fs)
 except Exception as err:print('FAIL',p['name'],err);raise
cols=4;rows=math.ceil(len(images)/cols);sheet=Image.new('RGB',(cols*W,rows*(H+32)),'#111217')
for i,im in enumerate(images):sheet.paste(im,((i%cols)*W,(i//cols)*(H+32)))
sheet.save(OUT/'contact-sheet.jpg')
print('Compiled and linked',len(programs),'programs; rendered',len(images),'backgrounds.')
