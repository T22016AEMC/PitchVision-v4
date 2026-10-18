// Synthetic pitch clips with known ball positions. Pure JS software renderer (RGBA arrays, no canvas), so the same
// scenes drive Node unit tests (small frames) and browser video encoding (720p / 1080p / 4K).
//
// Scene: textured fence-like background (lattice, bright wall band, coloured stripe, dark post), a pitcher blob that
// holds the ball until release, perspective ball flight with gravity and motion-blur streak, optional occluder,
// camera shake, and distractors: a rolling ball on the ground, an object that appears only inside the flight
// window and then stays still, and static bright lights.
const mulberry=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};

/**
 * @param {{width:number,height:number,fps:number,view:'pitcher_rear'|'catcher',frames:number,release:number,glove:number,
 *  shake?:number, occlusion?:[number,number][], distractors?:boolean, noise?:number, seed?:number, speedMps?:number}} o
 */
export function makeScene(o){
  const W=o.width,H=o.height,maxDim=Math.max(W,H),S=maxDim/1280,rnd=mulberry(o.seed??7),noise=o.noise??2.5,shakeAmp=(o.shake??0)*S;
  const M=Math.ceil(shakeAmp*2)+4,BW=W+2*M,BH=H+2*M,bg=new Uint8ClampedArray(BW*BH*4);
  // ── background (rendered once, larger than the frame so shake only moves a window) ──
  const P=7*S;
  for(let y=0;y<BH;y++)for(let x=0;x<BW;x++){
    const fy=(y-M)/H,fx=(x-M)/W;let r,g,b;
    if(fy<.28){r=125;g=112;b=100;const t=((x*13+y*7)%11)/11;r+=t*10;g+=t*8;b+=t*6;}
    else if(fy<.56){r=205;g=112;b=112;}
    else if(fy<.60){r=232;g=200;b=62;}
    else if(fy<.645){r=205;g=208;b=206;}
    else if(fy<.70){r=190;g=120;b=110;}
    else{r=50;g=105;b=66;if(fy>.9&&fy<.905){r=235;g=235;b=235;}}
    // dark post and a dark bag
    if(fx>.515&&fx<.535&&fy>.42&&fy<.70){r=70;g=36;b=36;}
    if(fx>.40&&fx<.47&&fy>.64&&fy<.70){r=28;g=24;b=30;}
    // lattice (fence mesh): thin dark diagonals
    if(fy>.28&&fy<.70){const a=(x+y)%P,c=((x-y)%P+P)%P;if(a<1.4*S||c<1.4*S){r*=.68;g*=.68;b*=.68;}}
    const i=(y*BW+x)*4;bg[i]=r;bg[i+1]=g;bg[i+2]=b;bg[i+3]=255;
  }
  // large panels (signs, doors, court markings): coarse structure with distinct brightness
  const panels=Array.from({length:14},()=>({x:rnd()*.95,y:.05+rnd()*.85,w:.04+rnd()*.14,h:.03+rnd()*.10,c:[40+rnd()*190,40+rnd()*190,40+rnd()*190]}));
  for(const p of panels){const x0=Math.round(M+p.x*W),x1=Math.round(M+(p.x+p.w)*W),y0=Math.round(M+p.y*H),y1=Math.round(M+(p.y+p.h)*H);
    for(let yy=Math.max(0,y0);yy<Math.min(BH,y1);yy++)for(let xx=Math.max(0,x0);xx<Math.min(BW,x1);xx++){const i=(yy*BW+xx)*4;bg[i]=p.c[0];bg[i+1]=p.c[1];bg[i+2]=p.c[2];}}
  // static bright lights (present in every frame, so the background model absorbs them)
  const lights=[[.32,.47],[.66,.50]].map(([fx,fy])=>[fx*W+M,fy*H+M]);
  for(const [lx,ly] of lights)disc(bg,BW,BH,lx,ly,3*S,[255,250,230],1);

  // ── ball flight (world → image) ──
  const g=9.81,view=o.view,f=1.15*maxDim,T0=Math.max(1,o.glove-o.release)/o.fps; // focal in px; flight time to the plate
  // pitcher_rear: camera behind the pitcher looking at the plate (the ball recedes).
  // catcher: camera behind the plate looking at the mound (the ball approaches). The ball always flies mound -> plate.
  const cam=view==='pitcher_rear'?{z:-3.2,y:1.55}:{z:21.0,y:1.2};
  const start={x:.25,y:1.95,z:0},vel={x:-.25/T0,y:(0.75-1.95+.5*g*T0*T0)/T0,z:17.5/T0};
  const cx=W/2,cy=H*.46;
  const project=(X,Y,Z)=>{
    const depth=view==='pitcher_rear'?Z-cam.z:cam.z-Z; // distance along the viewing axis
    const u=view==='pitcher_rear'?cx+f*X/depth:cx-f*X/depth;
    const v=cy-f*(Y-cam.y)/depth;
    return {x:u,y:v,r:Math.max(1.2,f*.0366/depth),depth};
  };
  const timeOf=i=>(i-o.release)/o.fps;
  const worldAt=t=>{
    const T=t<0?0:t,glovet=(o.glove-o.release)/o.fps;
    if(T<=glovet){return {X:start.x+vel.x*T,Y:start.y+vel.y*T-.5*g*T*T,Z:start.z+vel.z*T};}
    // after the net/glove: slow lateral drift and fall (like the clip's ball sliding down the net)
    const a=worldAt(glovet),dt=T-glovet;return {X:a.X+.15*dt,Y:Math.max(.1,a.Y-.5*g*dt*dt*.35),Z:a.Z};
  };
  const truth=[];
  const inOcc=i=>(o.occlusion||[]).some(([a,b])=>i>=a&&i<=b);
  for(let i=0;i<o.frames;i++){
    const t=timeOf(i);
    if(i<o.release){truth.push({frame:i,x:null,y:null,r:null,visible:false,phase:'in hand'});continue;}
    const w=worldAt(t),p=project(w.X,w.Y,w.Z);
    const visible=!inOcc(i)&&p.x>0&&p.y>0&&p.x<W&&p.y<H;
    truth.push({frame:i,x:p.x,y:p.y,r:p.r,visible,phase:t>(o.glove-o.release)/o.fps?'after net':'flight'});
  }
  // ── per-frame render ──
  const shakeAt=i=>{const a=mulberry((o.seed??7)*131+i)();const b=mulberry((o.seed??7)*977+i)();return [Math.round((a-.5)*2*shakeAmp),Math.round((b-.5)*2*shakeAmp)];};
  const render=i=>{
    const out=new Uint8ClampedArray(W*H*4),[sx,sy]=shakeAt(i);
    for(let y=0;y<H;y++){const src=((y+M+sy)*BW+M+sx)*4;out.set(bg.subarray(src,src+W*4),y*W*4);}
    // pitcher: white shirt, dark shorts, head; moves right and lowers after release; hand holds the ball until release
    const prog=(i-o.release)/Math.max(1,o.glove-o.release),px=(.16+.05*prog)*W,py=(.52+.07*Math.max(0,prog))*H;
    rect(out,W,H,px-.07*W,py-.12*H,.14*W,.2*H,[236,236,238]);
    rect(out,W,H,px-.06*W,py+.08*H,.12*W,.14*H,[40,42,50]);
    disc(out,W,H,px-.02*W,py-.16*H,.035*W,[60,45,40],1);
    const hand=project(start.x,start.y,start.z);
    if(i<=o.release){ // arm raised with the ball in hand
      rect(out,W,H,px+.02*W,Math.min(py-.12*H,hand.y),.03*W,.14*H,[225,200,190]);
      if(i<o.release)disc(out,W,H,hand.x-.0*W+(i-o.release)*3*S,hand.y+(i-o.release)*2*S,Math.max(4*S,hand.r*1.1),[248,246,240],1);
    }
    // distractors
    if(o.distractors){
      const roll=(.30*W+(i*2.2*S*24/o.fps)),rollY=.93*H;                       // rolling ball on the ground, slow
      disc(out,W,H,roll,rollY,5*S,[246,244,238],1);
      if(i>=o.release-3)disc(out,W,H,.66*W,.58*H,3*S,[250,250,250],1);     // appears with the throw, then stays
    }
    // ball (cream white, streaked by motion during the exposure)
    const tr=truth[i];
    if(tr.visible&&i>=o.release){
      const t=timeOf(i),span=.5/o.fps,N=7;
      for(let k=0;k<N;k++){
        const tk=t+(k/(N-1)-.5)*span,w=worldAt(tk),p=project(w.X,w.Y,w.Z);
        disc(out,W,H,p.x,p.y,p.r,[246,243,232],1/N*2.0);
      }
    }
    // occluder (dark arm) over the ball's path
    for(const [a,b] of (o.occlusion||[])) if(i>=a&&i<=b&&tr.x!==null){rect(out,W,H,tr.x-18*S,tr.y-24*S,36*S,48*S,[35,30,34]);}
    // noise
    if(noise>0){const n=W*H;for(let k=0;k<n;k++){const d=(rnd()+rnd()+rnd()-1.5)*noise*2,j=k*4;out[j]+=d;out[j+1]+=d;out[j+2]+=d;}}
    return out;
  };
  const shifts=Array.from({length:o.frames},(_,i)=>shakeAt(i));
  return {width:W,height:H,fps:o.fps,frames:o.frames,release:o.release,glove:o.glove,view,truth,render,shifts,opts:o};
}
function disc(buf,W,H,cx,cy,r,color,alpha){
  const x0=Math.max(0,Math.floor(cx-r-1)),x1=Math.min(W-1,Math.ceil(cx+r+1)),y0=Math.max(0,Math.floor(cy-r-1)),y1=Math.min(H-1,Math.ceil(cy+r+1));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const d=Math.hypot(x+.5-cx,y+.5-cy),cov=Math.max(0,Math.min(1,r-d+.5));if(cov<=0)continue;
    const a=cov*alpha,i=(y*W+x)*4;buf[i]+=(color[0]-buf[i])*a;buf[i+1]+=(color[1]-buf[i+1])*a;buf[i+2]+=(color[2]-buf[i+2])*a;buf[i+3]=255;
  }
}
function rect(buf,W,H,x,y,w,h,color){
  const x0=Math.max(0,Math.floor(x)),x1=Math.min(W,Math.ceil(x+w)),y0=Math.max(0,Math.floor(y)),y1=Math.min(H,Math.ceil(y+h));
  for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*W+xx)*4;buf[i]=color[0];buf[i+1]=color[1];buf[i+2]=color[2];buf[i+3]=255;}
}
