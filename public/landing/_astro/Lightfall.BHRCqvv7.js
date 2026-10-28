"use client";import{n as e,t}from"./react.CvnImTBr.js";var n=t(),r=e((e=>{var t=Symbol.for(`react.transitional.element`);function n(e,n,r){var i=null;if(r!==void 0&&(i=``+r),n.key!==void 0&&(i=``+n.key),`key`in n)for(var a in r={},n)a!==`key`&&(r[a]=n[a]);else r=n;return n=r.ref,{$$typeof:t,type:e,key:i,ref:n===void 0?null:n,props:r}}e.jsx=n})),i=e(((e,t)=>{t.exports=r()}))(),a=8,o=4,s=`#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,c=`#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uZoom;
uniform float uPhase;
uniform float uTwinkleClock;
uniform float uRings;
uniform vec3 uColors[8];
uniform int uColorCount;
uniform int uStreakCount;
uniform int uColumns;
uniform float uWidth;
uniform float uTail;
uniform float uTwinkle;
uniform float uHead;
uniform float uDepth;
uniform vec4 uMouse;
uniform vec3 uLens;
uniform float uLightMode;
uniform float uEncode;
out vec4 outColor;

const vec3 CAMERA = vec3(0.0, -0.8888889, -0.2222222);
const float TAU = 6.28318530718;
const float SPACING = 0.005;
const float REACH = 0.32;

uint scramble(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

float unit(uint x) {
  return float(x & 0xffffu) / 65535.0;
}

float stroke(float d, float w) {
  float s = max(0.75 * w, 0.55);
  return 0.75 * w / s * exp(-0.5 * d * d / (s * s));
}

float orb(float d, float r) {
  float s = max(0.6 * r, 0.7);
  float e = 0.6 * r / s;
  return e * e * exp(-0.5 * d * d / (s * s));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 screen = (2.0 * frag - uView) / uView.x;
  vec2 p = screen;
  mat2 warp = mat2(1.0);
  if (uLens.z > 0.0) {
    vec2 o = p - uLens.xy;
    float e = uLens.z * exp(-dot(o, o) / (REACH * REACH));
    p -= o * e;
    warp = mat2(1.0 - e) + outerProduct(o, o) * (2.0 * e / (REACH * REACH));
  }

  vec3 dir = vec3(p, uZoom);
  vec3 exits = (1.0 - CAMERA * sign(dir)) / max(abs(dir), vec3(1e-6));
  float u = min(exits.x, min(exits.y, exits.z));
  for (int i = 0; i < 5; i++) {
    vec3 h = CAMERA + u * dir;
    vec3 h2 = h * h;
    u -= (dot(h2, h2) - 1.0) / (4.0 * dot(dir, h2 * h));
  }
  vec3 hit = CAMERA + u * dir;
  vec3 normal = hit * hit * hit;
  float facing = dot(normal, dir);
  vec3 stepX = u * (vec3(1.0, 0.0, 0.0) - dir * (normal.x / facing));
  vec3 stepY = u * (vec3(0.0, 1.0, 0.0) - dir * (normal.y / facing));
  float ring = hit.y * hit.y + hit.z * hit.z;
  float theta = atan(hit.z, hit.y);
  mat2 jacobian = mat2(
    stepX.x,
    (hit.y * stepX.z - hit.z * stepX.y) / ring,
    stepY.x,
    (hit.y * stepY.z - hit.z * stepY.y) / ring
  ) * warp * (2.0 / uView.x);

  vec2 gradX = vec2(jacobian[0][0], jacobian[1][0]);
  vec2 gradTheta = vec2(jacobian[0][1], jacobian[1][1]);
  float scale = max(length(gradX), 1e-8);
  float det = max(abs(gradX.x * gradTheta.y - gradX.y * gradTheta.x), 1e-12);
  float along = scale / det;
  float skew = dot(gradX, gradTheta) / det;
  float spacing = SPACING / scale;
  float detail = smoothstep(1.6, 3.2, spacing);
  if (detail <= 0.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float halfWidth = min(uWidth / scale, 0.2 * spacing);
  float headRadius = min(2.0 * uWidth / scale, 0.35 * spacing);
  float headReach = 4.0 * max(0.6 * headRadius, 0.7);
  float edge = uColumns > 1 ? 1.0 : 0.5;
  float period = TAU / uRings;
  float fog = exp(-max(u * length(dir) - 0.6, 0.0) * 1.6 * uDepth);

  float boost = 1.0;
  if (uMouse.z > 0.0) {
    vec2 m = screen - uMouse.xy;
    boost += 2.0 * uMouse.z * exp(-dot(m, m) / max(uMouse.w * uMouse.w, 1e-4));
  }

  int count = max(uColorCount, 1);
  vec3 total = vec3(0.0);
  for (int layer = 0; layer < 16; layer++) {
    if (layer >= uStreakCount) break;
    float x = hit.x + float(layer) * SPACING / 8.0;
    float nearest = floor(x / SPACING + 0.5);
    float side = x >= nearest * SPACING ? 1.0 : -1.0;
    for (int k = 0; k < 2; k++) {
      if (k >= uColumns) break;
      float column = nearest + side * float(k);
      float across = (x - column * SPACING) / scale;
      uint seed = scramble(uint(int(column) + 65536) + uint(layer) * 0x9e3779b9u);
      uint next = scramble(seed);
      float hue = unit(seed >> 16);
      float delta = theta - uPhase * (1.0 + floor(unit(seed) * 16.0) / 16.0) - unit(next) * period;
      delta -= period * floor(delta / period + 0.5);
      float ahead = delta * along - across * skew;
      if (abs(ahead) > headReach && (delta > 0.0 || -delta * uTail > 3.2)) continue;
      float behind = max(-delta, 0.0);
      float fall = exp(-uTail * behind) * (1.0 - smoothstep(0.5, 0.95, behind / (0.5 * period)));
      fall *= 1.0 - smoothstep(1.2, 3.2, uTail * behind);
      float reach = length(vec2(across, ahead));
      float trail = stroke(ahead > 0.0 ? reach : abs(across), halfWidth * mix(0.4, 1.0, fall)) * fall;
      float glint = orb(reach, headRadius) * mix(3.0, 1.8, uLightMode);
      float weight = mix(1.5, 1.0 + sin(uTwinkleClock + 7.0 * hue + 4.0), uTwinkle);
      weight *= 1.0 - smoothstep(0.72 * edge, edge, abs(across) / spacing);
      vec3 color = uColors[min(int(hue * float(count)), count - 1)];
      vec3 hot = mix(color, vec3(1.0), uHead * (1.0 - uLightMode));
      total += (trail * color + glint * hot) * weight;
    }
  }

  outColor = vec4(total * fog * boost * detail * uEncode, 1.0);
}`,l=`#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTarget;
uniform vec2 uTexel;
uniform float uLimit;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uTarget;
  vec3 color = texture(uSource, uv - uTexel).rgb;
  color += texture(uSource, uv + uTexel).rgb;
  color += texture(uSource, uv + vec2(uTexel.x, -uTexel.y)).rgb;
  color += texture(uSource, uv + vec2(-uTexel.x, uTexel.y)).rgb;
  outColor = vec4(min(color * 0.25, vec3(uLimit)), 1.0);
}`,u=`#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTarget;
uniform vec2 uStep;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uTarget;
  vec3 color = texture(uSource, uv).rgb * 0.181862;
  color += (texture(uSource, uv + uStep * 1.423135).rgb + texture(uSource, uv - uStep * 1.423135).rgb) * 0.284316;
  color += (texture(uSource, uv + uStep * 3.326702).rgb + texture(uSource, uv - uStep * 3.326702).rgb) * 0.106598;
  color += (texture(uSource, uv + uStep * 5.242989).rgb + texture(uSource, uv - uStep * 5.242989).rgb) * 0.018156;
  outColor = vec4(color, 1.0);
}`,d=`#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform vec2 uView;
uniform float uDecode;
uniform float uGlow;
uniform float uBloom;
uniform float uPresence;
uniform float uOpacity;
uniform float uFade;
uniform float uLightMode;
uniform vec3 uTopColor;
uniform float uTopGlow;
out vec4 outColor;

float smootherstep01(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec3 light = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  if (uBloom > 0.0) {
    vec3 halo = texture(uBloom0, uv).rgb * 0.42;
    halo += texture(uBloom1, uv).rgb * 0.3;
    halo += texture(uBloom2, uv).rgb * 0.18;
    halo += texture(uBloom3, uv).rgb * 0.1;
    light += halo * uBloom * (uLightMode > 0.5 ? 0.2 : 1.0);
  }
  light *= uDecode * uGlow * uPresence;

  if (uLightMode < 0.5 && uTopGlow > 0.0) {
    float aspect = uView.x / uView.y;
    vec2 q = vec2((uv.x - 0.5) * aspect, 1.04 - uv.y);
    float spread = 0.34 * max(aspect, 0.75);
    float core = exp(-q.x * q.x / (spread * spread) - q.y * q.y / 0.06);
    float halo = exp(-q.x * q.x / (3.6 * spread * spread) - q.y * q.y / 0.18);
    light += uTopColor * uTopGlow * (core * 0.85 + halo * 0.3) * uPresence;
  }

  vec3 lit = max(light, 0.0);
  vec3 mapped = sqrt(1.0 - exp(-1.3 * lit * lit / (lit + 0.025)));
  float peak = max(mapped.r, max(mapped.g, mapped.b));

  float mask = uOpacity;
  float edge = uFade * 0.5;
  if (edge > 0.0) {
    mask *= smootherstep01(uv.x / edge) * smootherstep01((1.0 - uv.x) / edge);
    mask *= smootherstep01(uv.y / edge) * smootherstep01((1.0 - uv.y) / edge);
  }
  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    float coverage = clamp(smoothstep(0.0, 0.5, peak) * mask * 0.94 + grain, 0.0, 1.0);
    vec3 chroma = sqrt(clamp(lit / max(max(lit.r, max(lit.g, lit.b)), 1e-6), 0.0, 1.0));
    chroma = pow(chroma, vec3(1.35));
    chroma /= max(max(chroma.r, max(chroma.g, chroma.b)), 1e-4);
    float saturation = 1.0 - min(chroma.r, min(chroma.g, chroma.b));
    chroma = mix(vec3(0.3), chroma, smoothstep(0.08, 0.35, saturation));
    outColor = vec4(chroma * coverage, coverage);
  } else {
    vec3 color = clamp(mapped + grain, 0.0, 1.0) * mask;
    outColor = vec4(color, max(color.r, max(color.g, color.b)));
  }
}`,f=2.6,p=9,m=Math.PI*2,h=(e,t,n)=>Math.min(n,Math.max(t,e)),g=(e,t,n)=>{let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(e.deleteShader(r),null)):null},_=(e,t)=>{let n=g(e,e.VERTEX_SHADER,s),r=g(e,e.FRAGMENT_SHADER,t),i=e.createProgram();if(!n||!r||!i)return null;if(e.attachShader(i,n),e.attachShader(i,r),e.bindAttribLocation(i,0,`aPosition`),e.linkProgram(i),e.deleteShader(n),e.deleteShader(r),!e.getProgramParameter(i,e.LINK_STATUS))return e.deleteProgram(i),null;let a={},o=e.getProgramParameter(i,e.ACTIVE_UNIFORMS);for(let t=0;t<o;t++){let n=e.getActiveUniform(i,t);n&&(a[n.name.replace(/\[0\]$/,``)]=e.getUniformLocation(i,n.name))}return{program:i,uniforms:a}},v=({colors:e=[`#ffffff`],backgroundColor:t=`#94a3b8`,speed:r=.3,streakCount:s=2,streakWidth:g=.8,streakLength:v=1,glow:y=1,density:b=.6,twinkle:x=.3,zoom:S=3,backgroundGlow:C=.1,headGlow:w=.6,depth:T=.5,bloom:E=.35,opacity:D=1,mouseInteraction:O=!0,mouseStrength:k=.4,mouseRadius:A=.45,mouseDampening:j=.15,lens:M=.5,holdToWarp:N=!0,intro:P=!0,fade:F=0,lightMode:I=!1,mixBlendMode:L,paused:R=!1,dpr:z,maxFps:B=0,className:V=``,style:H})=>{let U=(0,n.useRef)(null),W=(0,n.useRef)(null),G=(0,n.useRef)(null),K=(0,n.useRef)(null),[q,ee]=(0,n.useState)(0);return K.current={colors:(Array.isArray(e)&&e.length?e:[`#ffffff`]).slice(0,a).map(String),backgroundColor:String(t),speed:r,streakCount:Math.round(h(s,1,16)),streakWidth:Math.max(.05,g),streakLength:Math.max(.05,v),glow:Math.max(0,y),density:b,twinkle:h(x,0,1),zoom:Math.max(.1,S),backgroundGlow:Math.max(0,C),headGlow:h(w,0,1),depth:Math.max(0,T),bloom:Math.max(0,E),opacity:h(D,0,1),mouseInteraction:O,mouseStrength:Math.max(0,k),mouseRadius:Math.max(.01,A),mouseDampening:Math.max(0,j),lens:h(M,0,1),holdToWarp:N,intro:P,fade:h(F,0,1),lightMode:I,paused:R,dpr:z,maxFps:B},(0,n.useEffect)(()=>{let e=U.current,t=W.current,n=t?.getContext(`webgl2`,{alpha:!0,premultipliedAlpha:!0,antialias:!1,depth:!1,stencil:!1,powerPreference:`high-performance`});if(!e||!t||!n)return;let r=!!n.getExtension(`EXT_color_buffer_float`),i=_(n,c),s=_(n,l),h=_(n,u),g=_(n,d);if(!i||!s||!h||!g)return;let v=e=>{e.preventDefault()},y=()=>ee(e=>e+1);t.addEventListener(`webglcontextlost`,v),t.addEventListener(`webglcontextrestored`,y);let b=n.createBuffer(),x=n.createVertexArray();n.bindVertexArray(x),n.bindBuffer(n.ARRAY_BUFFER,b),n.bufferData(n.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),n.STATIC_DRAW),n.enableVertexAttribArray(0),n.vertexAttribPointer(0,2,n.FLOAT,!1,0,0);let S=r?n.RGBA16F:n.RGBA8,C=r?1:.25,w=()=>({texture:null,framebuffer:n.createFramebuffer(),width:0,height:0}),T=w(),E=Array.from({length:o},()=>[w(),w()]),D=(e,t,r)=>{e.texture&&e.width===t&&e.height===r||(e.texture&&n.deleteTexture(e.texture),e.texture=n.createTexture(),e.width=t,e.height=r,n.bindTexture(n.TEXTURE_2D,e.texture),n.texStorage2D(n.TEXTURE_2D,1,S,t,r),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.bindFramebuffer(n.FRAMEBUFFER,e.framebuffer),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,e.texture,0))},O=(e,r)=>(n.bindFramebuffer(n.FRAMEBUFFER,e?e.framebuffer:null),n.viewport(0,0,e?e.width:t.width,e?e.height:t.height),n.useProgram(r.program),r.uniforms),k=(e,t)=>{n.activeTexture(n.TEXTURE0+e),n.bindTexture(n.TEXTURE_2D,t)},A=document.createElement(`canvas`).getContext(`2d`,{willReadFrequently:!0}),j=new Map,M=e=>{if(j.has(e))return j.get(e);let t=[1,1,1];if(A){A.clearRect(0,0,1,1),A.fillStyle=`#ffffff`,A.fillStyle=e,A.fillRect(0,0,1,1);let[n,r,i]=A.getImageData(0,0,1,1).data;t=[n/255,r/255,i/255]}return j.set(e,t),t},N=e=>M(e).map(e=>e*e),P=window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches??!1,F=new Float32Array(24),I={x:0,y:0,inside:!1,held:!1},L={travel:0,intro:K.current.intro&&!P?0:1,mouseX:0,mouseY:0,lensX:0,lensY:0,touch:0,warp:0},R=0,z=0,B=!0,V=()=>{let r=K.current,c=t.width,l=t.height,u=Math.max(1,e.clientWidth),d=Math.max(1,e.clientHeight);n.bindVertexArray(x),D(T,c,l),r.bloom>0&&E.forEach((e,t)=>{let n=Math.max(1,Math.round(u/2**(t+1))),r=Math.max(1,Math.round(d/2**(t+1)));D(e[0],n,r),D(e[1],n,r)});let f=L.intro,p=Math.min(1,f*2.2),_=1+5*(1-f)**2+2.5*L.warp,v=Math.max(1,Math.floor(m*Math.max(r.density,.05)+.5)),y=m/v,b=9+L.travel,S=r.colors.map(N);F.fill(0);for(let e=0;e<a;e++)F.set(S[Math.min(e,S.length-1)],e*3);let w=e=>(2*e-c)/c,A=e=>(2*e-l)/c,j=O(T,i);if(n.uniform2f(j.uView,c,l),n.uniform1f(j.uZoom,r.zoom),n.uniform1f(j.uPhase,b%(16*y)),n.uniform1f(j.uTwinkleClock,b%m),n.uniform1f(j.uRings,v),n.uniform3fv(j.uColors,F),n.uniform1i(j.uColorCount,S.length),n.uniform1i(j.uStreakCount,r.streakCount),n.uniform1i(j.uColumns,r.streakWidth>1?2:1),n.uniform1f(j.uWidth,5e-4*r.streakWidth),n.uniform1f(j.uTail,19/(r.streakLength*_)),n.uniform1f(j.uTwinkle,r.twinkle),n.uniform1f(j.uHead,r.headGlow),n.uniform1f(j.uDepth,r.depth),n.uniform4f(j.uMouse,w(L.mouseX),A(L.mouseY),r.mouseInteraction?r.mouseStrength*L.touch:0,r.mouseRadius),n.uniform3f(j.uLens,w(L.lensX),A(L.lensY),r.mouseInteraction?.5*r.lens*L.touch:0),n.uniform1f(j.uLightMode,+!!r.lightMode),n.uniform1f(j.uEncode,C),n.drawArrays(n.TRIANGLES,0,3),r.bloom>0){let e=T;E.forEach(([t,r])=>{let i=O(t,s);k(0,e.texture),n.uniform1i(i.uSource,0),n.uniform2f(i.uTarget,t.width,t.height),n.uniform2f(i.uTexel,1/e.width,1/e.height),n.uniform1f(i.uLimit,4*C),n.drawArrays(n.TRIANGLES,0,3);let a=O(r,h);k(0,t.texture),n.uniform1i(a.uSource,0),n.uniform2f(a.uTarget,r.width,r.height),n.uniform2f(a.uStep,1/t.width,0),n.drawArrays(n.TRIANGLES,0,3),a=O(t,h),k(0,r.texture),n.uniform1i(a.uSource,0),n.uniform2f(a.uTarget,t.width,t.height),n.uniform2f(a.uStep,0,1/r.height),n.drawArrays(n.TRIANGLES,0,3),e=t})}let M=O(null,g);k(0,T.texture),n.uniform1i(M.uScene,0),E.forEach(([e],t)=>{k(t+1,e.texture),n.uniform1i(M[`uBloom${t}`],t+1)}),n.uniform2f(M.uView,c,l),n.uniform1f(M.uDecode,1/C),n.uniform1f(M.uGlow,r.glow),n.uniform1f(M.uBloom,r.bloom),n.uniform1f(M.uPresence,p),n.uniform1f(M.uOpacity,r.opacity),n.uniform1f(M.uFade,r.fade),n.uniform1f(M.uLightMode,+!!r.lightMode),n.uniform3fv(M.uTopColor,N(r.backgroundColor)),n.uniform1f(M.uTopGlow,r.backgroundGlow),n.drawArrays(n.TRIANGLES,0,3);for(let e=o;e>=0;e--)k(e,null)},H=n=>{if(R=0,!B||document.hidden)return;let r=K.current;if(r.maxFps>0&&z&&n-z<1e3/r.maxFps){R=requestAnimationFrame(H);return}let i=z?Math.min(.05,(n-z)/1e3):1/60;z=n,!r.intro||P?L.intro=1:L.intro<1&&(L.intro=Math.min(1,L.intro+i/f));let a=r.holdToWarp&&I.held&&I.inside&&!P;L.warp+=(+!!a-L.warp)*(1-Math.exp(-i*(a?2.2:1.6)));let o=p*(1-L.intro)**2+6*L.warp,s=!r.paused&&!P;s&&(L.travel+=i*.1*r.speed*(1+o));let c=t.width/Math.max(1,e.clientWidth),l=I.x*c,u=(e.clientHeight-I.y)*c,d=r.mouseInteraction&&I.inside&&!P;d&&L.touch<.01&&(L.mouseX=l,L.mouseY=u,L.lensX=l,L.lensY=u);let m=r.mouseDampening>0?1-Math.exp(-i/r.mouseDampening):1;L.mouseX+=(l-L.mouseX)*m,L.mouseY+=(u-L.mouseY)*m;let h=1-Math.exp(-i*6);L.lensX+=(l-L.lensX)*h,L.lensY+=(u-L.lensY)*h,L.touch+=(+!!d-L.touch)*(1-Math.exp(-i*(d?4:2))),V();let g=L.intro<1||L.warp>.001||Math.abs(+!!d-L.touch)>.002;s&&r.speed!==0||g?R=requestAnimationFrame(H):z=0},q=()=>{!R&&B&&!document.hidden&&(R=requestAnimationFrame(H))},J=()=>{let n=K.current,r=Math.max(1,e.clientWidth),i=Math.max(1,e.clientHeight),a=Math.min(n.dpr||window.devicePixelRatio||1,2);t.width=Math.max(1,Math.round(r*a)),t.height=Math.max(1,Math.round(i*a)),R||V(),q()},Y=t=>{let n=e.getBoundingClientRect(),r=t.clientX-n.left,i=t.clientY-n.top;return{x:r,y:i,inside:r>=0&&i>=0&&r<=n.width&&i<=n.height}},X=e=>{let t=Y(e);I.x=t.x,I.y=t.y,I.inside=t.inside,q()},Z=e=>{let t=Y(e);t.inside&&(I.x=t.x,I.y=t.y,I.inside=!0,I.held=!0,q())},Q=()=>{I.held=!1,q()},$=()=>{I.inside=!1,I.held=!1,q()},te=()=>{z=0,q()},ne=new ResizeObserver(J);ne.observe(e);let re=new IntersectionObserver(e=>{B=e.some(e=>e.isIntersecting),B&&(z=0,q())});re.observe(e),window.addEventListener(`pointermove`,X,{passive:!0}),window.addEventListener(`pointerdown`,Z,{passive:!0}),window.addEventListener(`pointerup`,Q,{passive:!0}),window.addEventListener(`pointercancel`,Q,{passive:!0}),document.documentElement.addEventListener(`pointerleave`,$),document.addEventListener(`visibilitychange`,te),J();let ie=K.current.dpr;return G.current=()=>{let e=K.current;e.dpr===ie?(R||V(),q()):(ie=e.dpr,J())},()=>{cancelAnimationFrame(R),G.current=null,t.removeEventListener(`webglcontextlost`,v),t.removeEventListener(`webglcontextrestored`,y),ne.disconnect(),re.disconnect(),window.removeEventListener(`pointermove`,X),window.removeEventListener(`pointerdown`,Z),window.removeEventListener(`pointerup`,Q),window.removeEventListener(`pointercancel`,Q),document.documentElement.removeEventListener(`pointerleave`,$),document.removeEventListener(`visibilitychange`,te),[T,...E.flat()].forEach(e=>{e.texture&&n.deleteTexture(e.texture),n.deleteFramebuffer(e.framebuffer)}),[i,s,h,g].forEach(e=>n.deleteProgram(e.program)),n.deleteBuffer(b),n.deleteVertexArray(x),n.isContextLost()||n.getExtension(`WEBGL_lose_context`)?.loseContext()}},[q]),(0,n.useEffect)(()=>{G.current?.()}),(0,i.jsx)(`div`,{ref:U,className:`lightfall-container${V?` ${V}`:``}`,style:{...L?{mixBlendMode:L}:null,...H},children:(0,i.jsx)(`canvas`,{ref:W,className:`lightfall-canvas`,"aria-hidden":`true`})})};export{v as default};