// Classical (no learned model) ball finder for pitch clips. New module: the older detector and tracker
// are untouched and remain the fallback. Method and measured behaviour: docs/PITCH_BALL_TRACKER.md.
//
//  1. Window: user-marked release − 2 frames … glove + 5 frames. Background frames come from outside it.
//  2. Camera shake: global translation per frame (coarse pyramid for big moves, exhaustive full-resolution search
//     for small shake; trimmed cost so a moving pitcher does not matter). Too much motion → no guessing.
//  3. Background: per-pixel median of the aligned outside frames (min-channel "whiteness"). A frame pixel is "new"
//     when it is brighter than the (slightly dilated) background there, at two smoothing levels (the second removes
//     structures thinner than the ball, so a ball in front of bright textured background is still seen).
//  4. Candidates: connected components of the new pixels; static ones (same place in several frames) are dropped.
//  5. Physical linking: dynamic programming over candidates with a smoothness cost, displacement bounds scaled by
//     FPS, gap penalties, and a hard gate against impossible jumps. Chains must be fast (median speed) and follow
//     the perspective size trend of the camera view; rejected chains are removed and the search continues.
//  6. Centres are refined with a matched disc; frames without evidence are only "estimated", never observations.
//  User taps are forced anchors. Nothing here is tuned to a single clip.

export type BallView='catcher'|'pitcher_rear';
export interface PFrame{index:number;time:number;width:number;height:number;data:Uint8ClampedArray;}
export interface BallAnchor{frame:number;xNorm:number;yNorm:number;}
export interface BallTrackOptions{
  fps:number;view:BallView;anchors?:BallAnchor[];
  /** The user's release mark (source frame index). Chain nodes more than one frame before it are dropped. */
  releaseFrame?:number;
  /** Brightness a pixel must exceed the local background maximum by, in every channel (0–255). */
  contrastThreshold?:number;
  /** @internal experiments only: smoothing levels (opening radii in px at 1280 long side). */
  __levels?:number[];
  /** Largest camera translation (fraction of the long side) searched before giving up. */
  maxShiftFrac?:number;
}
export interface BallPoint{
  frame:number;time:number;x:number;y:number;xNorm:number;yNorm:number;radius:number;confidence:number;
  source:'observation'|'estimated'|'user';
}
export interface BallTrackResult{
  status:'tracked'|'no_ball_found'|'camera_motion_too_large'|'insufficient_frames';
  message:string;
  /** Observations and estimates, ordered by frame. Estimates are never evidence. */
  points:BallPoint[];
  observedCount:number;estimatedCount:number;
  work:{width:number;height:number};
  camera:{maxShiftPx:number;maxShiftFrac:number;tripodAdvised:boolean;shifts:{frame:number;dx:number;dy:number}[]};
  stats:{windowFrames:number;backgroundFrames:number;candidates:number;staticDropped:number;chainScore:number;segments:number;ms:number;/** milliseconds per stage */timing?:Record<string,number>};
}

// ───────────────────────── small image helpers ─────────────────────────
/** gray = luminance, mn = min(R,G,B) ("whiteness": high only when every channel is bright), mx = max(R,G,B). */
interface Planes{w:number;h:number;gray:Uint8Array;mn:Uint8Array;mx:Uint8Array;}
function planes(f:PFrame):Planes{
  const n=f.width*f.height,gray=new Uint8Array(n),mn=new Uint8Array(n),mx=new Uint8Array(n),d=f.data;
  for(let i=0,j=0;i<n;i++,j+=4){const R=d[j],G=d[j+1],B=d[j+2];gray[i]=(R*77+G*150+B*29)>>8;mn[i]=R<G?(R<B?R:B):(G<B?G:B);mx[i]=R>G?(R>B?R:B):(G>B?G:B);}
  return {w:f.width,h:f.height,gray,mn,mx};
}
function half(src:Uint8Array,w:number,h:number){
  const nw=w>>1,nh=h>>1,out=new Uint8Array(nw*nh);
  for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){const i=2*y*w+2*x;out[y*nw+x]=(src[i]+src[i+1]+src[i+w]+src[i+w+1]+2)>>2;}
  return {data:out,w:nw,h:nh};
}
/** Depth so that the coarsest level is about 120–240 px on the long side (wide enough to carry real structure, small enough to search exhaustively). */
function pyramid(gray:Uint8Array,w:number,h:number){
  const depth=Math.max(1,Math.min(4,Math.floor(Math.log2(Math.max(w,h)/120))));
  const levels=[{data:gray,w,h}];
  for(let k=0;k<depth;k++){const l=levels[k];levels.push(half(l.data,l.w,l.h));}
  return levels;
}
const hist=new Uint32Array(256);
/** Mean of the lowest `keep` fraction of |a(x,y) − b(x+dx,y+dy)| (trimmed: ignores moving foreground). */
function trimmedCost(a:Uint8Array,b:Uint8Array,w:number,h:number,dx:number,dy:number,stride:number,keep:number){
  hist.fill(0);let n=0;
  const x0=Math.max(0,-dx),x1=Math.min(w,w-dx),y0=Math.max(0,-dy),y1=Math.min(h,h-dy);
  for(let y=y0;y<y1;y+=stride){const ra=y*w,rb=(y+dy)*w+dx;for(let x=x0;x<x1;x+=stride){const d=a[ra+x]-b[rb+x];hist[d<0?-d:d]++;n++;}}
  if(n<64)return Infinity;
  let target=Math.floor(n*keep),sum=0,taken=0;
  for(let v=0;v<256&&taken<target;v++){const c=Math.min(hist[v],target-taken);sum+=c*v;taken+=c;}
  return sum/Math.max(1,taken);
}
/** Shift s with cur(p) ≈ ref(p + s).
 *  1. Coarse-to-fine pyramid search finds large movements (and is ignored when its cost surface is flat).
 *  2. At full resolution an exhaustive ±8 px search around BOTH zero and the coarse estimate finds small hand shake
 *     (coarse levels cannot see shifts of a pixel or two). Zero wins unless the alternative is clearly cheaper.
 *  Cost = trimmed mean absolute difference, so a moving pitcher does not matter. */
function estimateShift(ref:ReturnType<typeof pyramid>,cur:ReturnType<typeof pyramid>,maxFrac:number){
  const top=ref.length-1,R=Math.max(2,Math.ceil(maxFrac*Math.max(ref[0].w,ref[0].h)/(1<<top)));
  const cost=(lv:number,dx:number,dy:number,stride:number)=>trimmedCost(cur[lv].data,ref[lv].data,cur[lv].w,cur[lv].h,dx,dy,stride,.5);
  const medianOf=(v:number[])=>{const f=v.filter(Number.isFinite).sort((p,q)=>p-q);return f.length?f[f.length>>1]:Infinity;};
  // coarse estimate (pyramid levels top … 1)
  const topStride=Math.max(1,Math.round(Math.sqrt(cur[top].w*cur[top].h/2500)));
  let bx=0,by=0;const zeroTop=cost(top,0,0,topStride);let best=zeroTop;const surface:number[]=[];
  for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const c=cost(top,dx,dy,topStride);surface.push(c);if(c<best){best=c;bx=dx;by=dy;}}
  if(best>.7*medianOf(surface)||best>zeroTop*.85){bx=0;by=0;}
  for(let lv=top-1;lv>=1;lv--){
    bx*=2;by*=2;
    const stride=Math.max(1,Math.round(Math.sqrt(cur[lv].w*cur[lv].h/60000))),center=cost(lv,bx,by,stride),local:number[]=[center];
    let cx=bx,cy=by;best=center;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(!dx&&!dy)continue;const c=cost(lv,bx+dx,by+dy,stride);local.push(c);if(c<best){best=c;cx=bx+dx;cy=by+dy;}}
    if(best>.85*medianOf(local)||best>center*.92){cx=bx;cy=by;}
    bx=cx;by=cy;
  }
  bx*=2;by*=2; // to full resolution
  // full-resolution exhaustive search around zero and around the coarse estimate
  const stride0=Math.max(1,Math.round(Math.sqrt(cur[0].w*cur[0].h/24000))),F=8;
  // Sparse scan of all (2F+1)² positions, then a full-sampling check of the best few and of the centre.
  const search=(ox:number,oy:number)=>{
    const sparse:{dx:number;dy:number;c:number}[]=[];
    for(let dy=-F;dy<=F;dy++)for(let dx=-F;dx<=F;dx++)sparse.push({dx:ox+dx,dy:oy+dy,c:cost(0,ox+dx,oy+dy,stride0*3)});
    sparse.sort((p,q)=>p.c-q.c);
    const finalists=[{dx:ox,dy:oy},...sparse.slice(0,8).filter(p=>p.dx!==ox||p.dy!==oy)];
    let c0=Infinity,rx=ox,ry=oy;
    for(const p of finalists){const c=cost(0,p.dx,p.dy,stride0);if(c<c0){c0=c;rx=p.dx;ry=p.dy;}}
    return {dx:rx,dy:ry,cost:c0};
  };
  const atZero=search(0,0);let chosen=atZero;
  if(bx!==0||by!==0){const atCoarse=search(bx,by);if(atCoarse.cost<atZero.cost*.85)chosen=atCoarse;}
  return {dx:chosen.dx,dy:chosen.dy,cost:chosen.cost,limit:R*(1<<top)};
}
function median(values:number[],n:number){
  for(let i=1;i<n;i++){const v=values[i];let j=i-1;while(j>=0&&values[j]>v){values[j+1]=values[j];j--;}values[j+1]=v;}
  return n&1?values[n>>1]:(values[(n>>1)-1]+values[n>>1])>>1;
}
/** Separable (2r+1)² max / min filters (specialised, no indirect calls in the inner loops). */
function dilateMax(src:Uint8Array,w:number,h:number,r:number){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const row=y*w;
    for(let x=0;x<w;x++){
      let m=src[row+x];
      for(let k=1;k<=r;k++){const l=src[row+(x-k<0?0:x-k)],q=src[row+(x+k>=w?w-1:x+k)];if(l>m)m=l;if(q>m)m=q;}
      tmp[row+x]=m;
    }
  }
  for(let y=0;y<h;y++){
    const row=y*w;
    for(let x=0;x<w;x++)out[row+x]=tmp[row+x];
    for(let k=1;k<=r;k++){
      const up=(y-k<0?0:y-k)*w,dn=(y+k>=h?h-1:y+k)*w;
      for(let x=0;x<w;x++){let m=out[row+x];const u=tmp[up+x],d=tmp[dn+x];if(u>m)m=u;if(d>m)m=d;out[row+x]=m;}
    }
  }
  return out;
}
function erodeMin(src:Uint8Array,w:number,h:number,r:number){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const row=y*w;
    for(let x=0;x<w;x++){
      let m=src[row+x];
      for(let k=1;k<=r;k++){const l=src[row+(x-k<0?0:x-k)],q=src[row+(x+k>=w?w-1:x+k)];if(l<m)m=l;if(q<m)m=q;}
      tmp[row+x]=m;
    }
  }
  for(let y=0;y<h;y++){
    const row=y*w;
    for(let x=0;x<w;x++)out[row+x]=tmp[row+x];
    for(let k=1;k<=r;k++){
      const up=(y-k<0?0:y-k)*w,dn=(y+k>=h?h-1:y+k)*w;
      for(let x=0;x<w;x++){let m=out[row+x];const u=tmp[up+x],d=tmp[dn+x];if(u<m)m=u;if(d<m)m=d;out[row+x]=m;}
    }
  }
  return out;
}
/** Opening removes bright features thinner than 2r+1 (fence wire, mesh nodes, noise) and keeps compact blobs. */
const openPlane=(src:Uint8Array,w:number,h:number,r:number)=>r<=0?src:dilateMax(erodeMin(src,w,h,r),w,h,r);

// ───────────────────────── candidates ─────────────────────────
interface Cand{frame:number;x:number;y:number;r:number;area:number;peak:number;mean:number;white:number;u:number;forced:boolean;user:boolean;}
/** Hysteresis: seeds need E ≥ T, regions grow over E ≥ low, so a blurred or half-hidden ball stays in one piece. */
function components(E:Uint8Array,P:Planes,T:number,minArea:number,maxArea:number,frame:number,low=T){
  const {w,h}=P,seen=new Uint8Array(w*h),out:Cand[]=[],stack:number[]=[];
  const thr=low;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const s=y*w+x;if(seen[s]||E[s]<T)continue;
    let area=0,sx=0,sy=0,sw=0,sxx=0,syy=0,sxy=0,peak=0,sumE=0,minX=x,maxX=x,minY=y,maxY=y,whiteSum=0;
    stack.length=0;stack.push(s);seen[s]=1;
    while(stack.length){
      const p=stack.pop()!,py=(p/w)|0,px=p-py*w,e=E[p];
      const wgt=Math.min(e,2*T);area++;sumE+=e;if(e>peak)peak=e;
      sx+=px*wgt;sy+=py*wgt;sw+=wgt;sxx+=px*px*wgt;syy+=py*py*wgt;sxy+=px*py*wgt;
      if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;
      whiteSum+=255-(P.mx[p]-P.mn[p]);
      if(area>maxArea*2)break;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=px+dx,ny=py+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const q=ny*w+nx;if(!seen[q]&&E[q]>=thr){seen[q]=1;stack.push(q);}
      }
    }
    if(area<minArea||area>maxArea)continue;
    const cx=sx/sw,cy=sy/sw,vxx=sxx/sw-cx*cx,vyy=syy/sw-cy*cy,vxy=sxy/sw-cx*cy;
    const tr=vxx+vyy,det=vxx*vyy-vxy*vxy,disc=Math.sqrt(Math.max(0,tr*tr/4-det)),l1=tr/2+disc,l2=Math.max(1e-3,tr/2-disc);
    const ecc=Math.sqrt(l1/l2),bw=maxX-minX+1,bh=maxY-minY+1,fill=area/(bw*bh);
    if(ecc>7||fill<.3)continue;
    const mean=sumE/area,white=whiteSum/area/255,r=Math.sqrt(area/Math.PI);
    // unary evidence: contrast over background, whiteness, compactness, roundness
    const u=1.3*Math.log2(1+mean/T)+0.9*white+0.6*Math.min(1,fill/.6)-0.35*Math.log2(ecc)+0.4*Math.log2(1+peak/T)/2;
    out.push({frame,x:cx,y:cy,r,area,peak,mean,white,u,forced:false,user:false});
  }
  return out;
}

// ───────────────────────── linking (dynamic programming) ─────────────────────────
interface Node extends Cand{k:number;id:number;}
interface LinkParams{maxStep:number;minStep:number;accTol:number;gapMax:number;theta:number;view:BallView;scale:number;}
/** How far node c lies from where the ball would be if it kept the velocity it had between a and b, relative to what
 *  physics tolerates. Adjacent frames: the usual acceleration test. Across a gap the tolerance grows with the square of
 *  the gap, but never beyond "the ball lost at most 80% of the distance it would have covered" (the net, a catch). */
function accCost(a:Node,b:Node,c:Node,p:LinkParams){
  const ga=b.k-a.k,gb=c.k-b.k,vx=(b.x-a.x)/ga,vy=(b.y-a.y)/ga,speed=Math.hypot(vx,vy);
  const dev=Math.hypot(c.x-(b.x+vx*gb),c.y-(b.y+vy*gb));
  const tol=Math.min(p.accTol*gb*gb+.25*speed*gb,.8*speed*gb+3*p.scale)+.01;
  const m=dev/tol;
  // More than twice what physics tolerates is not "expensive", it is impossible (a jump to another object).
  return m>2?Infinity:1.1*m*m;
}
function radiusCost(b:Node,c:Node,view:BallView){
  const ratio=Math.log(Math.max(.5,c.r)/Math.max(.5,b.r));
  // pitcher_rear: ball recedes (radius shrinks); catcher: ball approaches (radius grows). Soft prior only.
  const wrong=view==='pitcher_rear'?ratio:-ratio;
  return .6*Math.max(0,wrong-.45);
}
function linkChain(nodes:Node[],frames:number,p:LinkParams){
  const byFrame:Node[][]=Array.from({length:frames},()=>[]);nodes.forEach(n=>byFrame[n.k].push(n));
  type St={a:number;val:number;gate:boolean};
  const states:Map<number,St>[]=nodes.map(()=>new Map());// states[c] : prev node id (b) -> best value and back-pointer a
  const prevOf:Map<number,number>[]=nodes.map(()=>new Map());
  const val=(n:Node)=>n.u-p.theta+(n.forced?40:0);
  let bestVal=-Infinity,bestC=-1,bestB=-1;
  for(let kc=0;kc<frames;kc++)for(const c of byFrame[kc]){
    for(let kb=Math.max(0,kc-p.gapMax);kb<kc;kb++)for(const b of byFrame[kb]){
      const gb=kc-kb,dist=Math.hypot(c.x-b.x,c.y-b.y);
      if(dist>p.maxStep*gb||dist<p.minStep*gb)continue;
      const gapPen=.45*(gb-1),pair=val(b)+val(c)-gapPen-0.2*dist/(p.maxStep*gb);
      let best=pair,back=-1;
      // extend from any state ending at b
      for(const [aId,st] of states[b.id]){
        const ac=accCost(nodes[aId],b,c,p);if(!Number.isFinite(ac))continue;
        const t=st.val+val(c)-gapPen-ac-radiusCost(b,c,p.view);
        if(t>best){best=t;back=aId;}
      }
      states[c.id].set(b.id,{a:back,val:best,gate:true});
      prevOf[c.id].set(b.id,back);
      if(best>bestVal){bestVal=best;bestC=c.id;bestB=b.id;}
    }
  }
  if(bestC<0)return {chain:[] as Node[],score:-Infinity};
  const chain:Node[]=[nodes[bestC]];let c=bestC,b=bestB;
  while(b>=0){
    chain.push(nodes[b]);const a=states[c].get(b)!.a;c=b;b=a;
  }
  chain.reverse();
  return {chain,score:bestVal};
}

// ───────────────────────── main entry ─────────────────────────
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function analyzeBallFrames(win:PFrame[],bg:PFrame[],opts:BallTrackOptions):BallTrackResult{
  const t0=(typeof performance!=='undefined'?performance:Date).now();const tm:Record<string,number>={};let tlast=t0;const lap=(name:string)=>{const n=(typeof performance!=='undefined'?performance:Date).now();tm[name]=(tm[name]||0)+n-tlast;tlast=n;};
  const empty=(status:BallTrackResult['status'],message:string,extra:Partial<BallTrackResult>={}):BallTrackResult=>({
    status,message,points:[],observedCount:0,estimatedCount:0,work:{width:win[0]?.width??0,height:win[0]?.height??0},
    camera:{maxShiftPx:0,maxShiftFrac:0,tripodAdvised:false,shifts:[]},
    stats:{windowFrames:win.length,backgroundFrames:bg.length,candidates:0,staticDropped:0,chainScore:0,segments:0,ms:(typeof performance!=='undefined'?performance:Date).now()-t0},...extra});
  if(win.length<4)return empty('insufficient_frames','飛行區間影格太少，無法找球。');
  if(bg.length<3)return empty('insufficient_frames','區間以外的影格太少，無法建立背景。請把出手與進手套標在影片中間，前後留一些畫面。');
  const w=win[0].width,h=win[0].height,maxDim=Math.max(w,h),scale=maxDim/1280,T=opts.contrastThreshold??20,maxFrac=opts.maxShiftFrac??.1;
  const speed=24/Math.max(1,opts.fps);

  // 2. camera shake relative to the first window frame
  const winPl=win.map(planes),refPyr=pyramid(winPl[0].gray,w,h);
  const shifts=[{dx:0,dy:0}];let limitHit=false;
  for(let i=1;i<win.length;i++){const s=estimateShift(refPyr,pyramid(winPl[i].gray,w,h),maxFrac);shifts.push({dx:s.dx,dy:s.dy});if(Math.max(Math.abs(s.dx),Math.abs(s.dy))>=s.limit-1)limitHit=true;}
  const bgShifts=bg.map(f=>{const s=estimateShift(refPyr,pyramid(planes(f).gray,w,h),maxFrac);if(Math.max(Math.abs(s.dx),Math.abs(s.dy))>=s.limit-1)limitHit=true;return {dx:s.dx,dy:s.dy};});

  lap('shift');
  const maxShift=Math.max(0,...shifts.map(s=>Math.hypot(s.dx,s.dy)));

  const camera={maxShiftPx:maxShift,maxShiftFrac:maxShift/maxDim,tripodAdvised:maxShift/maxDim>.03,shifts:win.map((f,i)=>({frame:f.index,dx:shifts[i].dx,dy:shifts[i].dy}))};
  // Too much camera motion for a static-background method: say so instead of guessing.
  if(limitHit||camera.maxShiftFrac>.08)return empty('camera_motion_too_large','畫面晃動太大，請使用腳架或固定手機後重拍。',{camera});

  // 3. background (median of aligned outside frames) and its dilated maximum
  const bgPl=bg.map(planes),n=w*h,BW=new Uint8Array(n),vw=new Array<number>(bg.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let k=0;
    for(let i=0;i<bg.length;i++){const sx=x-bgShifts[i].dx,sy=y-bgShifts[i].dy;if(sx<0||sy<0||sx>=w||sy>=h)continue;vw[k++]=bgPl[i].mn[sy*w+sx];}
    BW[y*w+x]=k<3?255:median(vw,k);
  }
  lap('background');
  // Excess whiteness is measured at two smoothing levels: level 0 sees everything, level 1 first removes structures
  // thinner than the ball (fence wire, mesh nodes, noise) so a ball in front of bright, textured background is still visible.
  const dr=Math.max(1,Math.round(scale)),levels=(opts.__levels??[0,1]).map(o=>o===0?0:Math.max(1,Math.round(o*scale)));
  const lv=levels.map(o=>({o,Bm:dilateMax(openPlane(BW,w,h,o),w,h,dr)}));

  lap('levels');
  // 4. candidates per window frame
  const minArea=Math.max(4,5*scale*scale),maxArea=1600*scale*scale;
  const nodes:Node[]=[];let candTotal=0,staticDropped=0;
  const E=new Uint8Array(n);
  for(let i=0;i<win.length;i++){
    const P=winPl[i],s=shifts[i];E.fill(0);
    for(const L of lv){
      const fw=openPlane(P.mn,w,h,L.o);
      for(let y=0;y<h;y++){
        const by=y+s.dy;if(by<0||by>=h)continue;const row=y*w;
        for(let x=0;x<w;x++){
          const bx=x+s.dx;if(bx<0||bx>=w)continue;
          const e=fw[row+x]-L.Bm[by*w+bx];
          if(e>E[row+x])E[row+x]=e;
        }
      }
    }
    lap('energy');
    const cands=components(E,P,T,minArea,maxArea,i);lap('components');
    candTotal+=cands.length;
    cands.sort((a,b)=>b.u-a.u);
    for(const c of cands.slice(0,28))nodes.push({...c,k:i,id:nodes.length});
  }
  // static distractors (lights, a resting ball, marks the background median missed): same place, in camera-aligned
  // coordinates, in several frames. A ball in flight never sits still.
  {
    const q=nodes.map(c=>({x:c.x+shifts[c.k].dx,y:c.y+shifts[c.k].dy})),rad=2.5*scale,need=Math.max(3,Math.round(win.length*.2));
    const cell=Math.max(4,Math.ceil(rad*2)),grid=new Map<string,number[]>();
    nodes.forEach((c,i)=>{const key=Math.floor(q[i].x/cell)+','+Math.floor(q[i].y/cell);(grid.get(key)||grid.set(key,[]).get(key)!).push(i);});
    const drop=new Set<number>();
    nodes.forEach((c,i)=>{
      const frames=new Set<number>(),cx=Math.floor(q[i].x/cell),cy=Math.floor(q[i].y/cell);
      for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++)for(const j of grid.get(gx+','+gy)||[])if(nodes[j].k!==c.k&&Math.hypot(q[j].x-q[i].x,q[j].y-q[i].y)<=rad)frames.add(nodes[j].k);
      if(frames.size>=need)drop.add(i);
    });
    staticDropped=drop.size;
    const keep=nodes.filter((_,i)=>!drop.has(i));nodes.length=0;keep.forEach((c,i)=>{c.id=i;nodes.push(c);});
  }
  // anchors (user taps) become forced candidates
  const anchors=opts.anchors??[];
  for(const a of anchors){
    const k=win.findIndex(f=>f.index===a.frame);if(k<0)continue;
    const x=a.xNorm*w,y=a.yNorm*h,near=nodes.find(c=>c.k===k&&Math.hypot(c.x-x,c.y-y)<=Math.max(8*scale,c.r*2));
    if(near){near.forced=true;near.user=true;near.x=x;near.y=y;}
    else nodes.push({frame:k,x,y,r:4*scale,area:50,peak:0,mean:0,white:1,u:3,forced:true,user:true,k,id:nodes.length});
  }
  lap('static');
  const params:LinkParams={maxStep:.12*maxDim*speed,minStep:1.2*scale*speed,accTol:Math.max(2.2*scale,5*scale*speed*speed+2*scale),gapMax:9,theta:1.9,view:opts.view,scale};
  // A pitched ball moves fast (median image speed well above what a rolling ball or a drifting light shows).
  // Chains without one are rejected and the search continues on the remaining candidates.
  const vMin=3.5*scale*speed;
  const fast=(ch:Node[])=>{const v:number[]=[];for(let i=1;i<ch.length;i++)v.push(Math.hypot(ch[i].x-ch[i-1].x,ch[i].y-ch[i-1].y)/(ch[i].k-ch[i-1].k));v.sort((a,b)=>a-b);return v[v.length>>1]>=vMin;};
  // Perspective: seen from behind the pitcher the ball recedes and must not grow; from behind the plate it approaches
  // and must not shrink. A chain that does the opposite is a body part or other clutter, not the ball.
  const sizeOk=(ch:Node[])=>{
    if(ch.length<5)return true;
    const avg=(l:Node[])=>l.reduce((t,c)=>t+c.r,0)/l.length,head=avg(ch.slice(0,2)),tail=avg(ch.slice(-2));
    return opts.view==='pitcher_rear'?tail<=head*1.2:tail>=head*.85;
  };
  const plausible=(ch:Node[])=>fast(ch)&&sizeOk(ch);
  let pool=nodes,chain:Node[]=[],score=-Infinity,rejected=0;
  for(let attempt=0;attempt<4;attempt++){
    const reindexed=pool.map((c,i)=>({...c,id:i}));const r=linkChain(reindexed,win.length,params);
    if(r.chain.length<4||r.score<=0){chain=[];score=r.score;break;}
    const mapBack=r.chain.map(c=>pool[c.id]);
    if(mapBack.some(c=>c.user)||plausible(r.chain)){chain=r.chain.map(c=>({...c,...pool[c.id],id:pool[c.id].id}));score=r.score;break;}
    rejected++;const bad=new Set(mapBack);pool=pool.filter(c=>!bad.has(c));
  }
  lap('link');
  const ms=()=>(typeof performance!=='undefined'?performance:Date).now()-t0;
  if(chain.length<4||score<=0)return empty('no_ball_found','影片中沒有找到球。',{camera,stats:{windowFrames:win.length,backgroundFrames:bg.length,candidates:candTotal,staticDropped,chainScore:Number.isFinite(score)?score:0,segments:0,ms:ms()}});

  // 5a. refine centres with a matched disc: around each node find the disc whose inside is brightest above the
  // background and whose surrounding ring is not. Works for blurred, streaked or half-hidden balls where the
  // thresholded blob is only a fragment. Background here is the actual aligned median (no dilation).
  const bgRef=openPlane(BW,w,h,0);
  const refine=(k:number,c:{x:number;y:number;r:number})=>{
    const P=winPl[k],sh=shifts[k],r=clamp(c.r,2.5*scale,11*scale),R2=Math.ceil(r*1.7),srch=Math.ceil(Math.max(5*scale,r*1.1));
    const V=(x:number,y:number)=>{
      if(x<0||y<0||x>=w||y>=h)return 0;const bx=x+sh.dx,by=y+sh.dy;if(bx<0||by<0||bx>=w||by>=h)return 0;
      const v=P.mn[y*w+x]-bgRef[by*w+bx];return v<-10?-10:v>80?80:v;
    };
    const cx0=Math.round(c.x),cy0=Math.round(c.y);let best=-Infinity,bx0=cx0,by0=cy0;const sc=new Map<number,number>();
    for(let dy=-srch;dy<=srch;dy++)for(let dx=-srch;dx<=srch;dx++){
      let inS=0,inN=0,ringS=0,ringN=0;
      for(let y=-R2;y<=R2;y++)for(let x=-R2;x<=R2;x++){
        const d2=x*x+y*y;if(d2>R2*R2)continue;const v=V(cx0+dx+x,cy0+dy+y);
        if(d2<=r*r){inS+=v;inN++;}else if(d2<=(1.7*r)*(1.7*r)){ringS+=v;ringN++;}
      }
      const score=inS/Math.max(1,inN)-.6*(ringS/Math.max(1,ringN));
      sc.set((dy+srch)*(2*srch+1)+dx+srch,score);
      if(score>best){best=score;bx0=cx0+dx;by0=cy0+dy;}
    }
    if(best<6)return null;
    // sub-pixel: parabola through the neighbours on each axis
    const at=(x:number,y:number)=>sc.get((y-cy0+srch)*(2*srch+1)+(x-cx0+srch));
    const par=(m:number|undefined,c0:number,p:number|undefined)=>{if(m===undefined||p===undefined)return 0;const d=m-2*c0+p;return Math.abs(d)<1e-6?0:clamp(.5*(m-p)/d,-.5,.5);};
    const ox=par(at(bx0-1,by0),best,at(bx0+1,by0)),oy=par(at(bx0,by0-1),best,at(bx0,by0+1));
    return {x:bx0+ox,y:by0+oy,score:best};
  };
  for(const c of chain){if(c.user)continue;const g=refine(c.k,c);if(g){c.x=g.x;c.y=g.y;}}
  if(opts.releaseFrame!==undefined)while(chain.length>4&&!chain[0].user&&win[chain[0].k].index<opts.releaseFrame-1)chain.shift();
  // 5. assemble points: observations and estimates for gaps
  const byK=new Map<number,Node>();chain.forEach(c=>byK.set(c.k,c));
  const first=chain[0].k,last=chain.at(-1)!.k,points:BallPoint[]=[];
  const mk=(k:number,x:number,y:number,r:number,conf:number,source:BallPoint['source']):BallPoint=>({frame:win[k].index,time:win[k].time,x,y,xNorm:x/w,yNorm:y/h,radius:r,confidence:conf,source});
  const interp=(k:number)=>{ // Catmull-Rom style through nearest chain nodes on both sides
    let a=k-1;while(a>=first&&!byK.has(a))a--;let b=k+1;while(b<=last&&!byK.has(b))b++;
    const A=byK.get(a)!,Bn=byK.get(b)!;const u=(k-a)/(b-a);return {x:A.x+(Bn.x-A.x)*u,y:A.y+(Bn.y-A.y)*u,r:A.r+(Bn.r-A.r)*u};
  };
  let segments=1,observed=0,estimated=0;
  for(let k=first;k<=last;k++){
    const c=byK.get(k);
    if(c){points.push(mk(k,c.x,c.y,c.r,clamp((c.u-params.theta+2)/5,.05,1),c.user?'user':'observation'));observed++;continue;}
    const e=interp(k);
    // No evidence on this frame (hidden or not detected): report the interpolated position as an estimate only.
    {points.push(mk(k,e.x,e.y,e.r,.1,'estimated'));estimated++;}
  }
  // number of physical segments: a big acceleration jump inside the chain marks a break (e.g. the net)
  for(let i=2;i<chain.length;i++){const a=chain[i-2],b=chain[i-1],c=chain[i];if(accCost(a,b,c,params)>=1.1*1.9*1.9)segments++;}
  const result:BallTrackResult={status:'tracked',message:`找到 ${observed} 個球點${estimated?`，${estimated} 格被遮住（只標為推估）`:''}。`,points,observedCount:observed,estimatedCount:estimated,work:{width:w,height:h},camera,stats:{windowFrames:win.length,backgroundFrames:bg.length,candidates:candTotal,staticDropped,chainScore:score,segments,ms:ms()}};
  lap('refine');result.stats.timing=tm;return result;
}

// ───────────────────────── orchestration ─────────────────────────
/** Background frames: evenly spaced outside [first,last] with a 3-frame guard, up to `max`, split between both sides. */
export function pickBackgroundFrames(total:number,first:number,last:number,max=8):number[]{
  const before:number[]=[],after:number[]=[];
  for(let i=0;i<=first-4;i++)before.push(i);
  for(let i=last+4;i<total;i++)after.push(i);
  const spread=(list:number[],n:number)=>{if(n<=0||!list.length)return [];if(list.length<=n)return list;return Array.from({length:n},(_,i)=>list[Math.round(i*(list.length-1)/Math.max(1,n-1))]);};
  const nb=Math.min(before.length,after.length?Math.ceil(max/2):max),na=Math.min(after.length,max-nb);
  return [...spread(before,Math.min(before.length,max-na)),...spread(after,na)].sort((a,b)=>a-b);
}
export interface BallTrackRun extends BallTrackResult{window:{first:number;last:number};backgroundIndices:number[];captureMs:number;source:{width:number;height:number;workWidth:number;workHeight:number};}
/** Release/glove are source frame indices (the user's marks). Window = release − 2 … glove + 5. */
export async function trackPitchBall(source:{info:{sourceWidth:number;sourceHeight:number;width:number;height:number};count:number;capture:(i:number)=>Promise<PFrame|null>},
  releaseFrame:number,gloveFrame:number,opts:BallTrackOptions,isCancelled?:()=>boolean):Promise<BallTrackRun>{
  const t0=performance.now(),first=Math.max(0,releaseFrame-2),last=Math.min(source.count-1,gloveFrame+5);
  const bgIdx=pickBackgroundFrames(source.count,first,last);
  const grab=async(list:number[])=>{const out:PFrame[]=[];for(const i of list){if(isCancelled?.())throw new DOMException('已取消','AbortError');const f=await source.capture(i);if(f)out.push(f);}return out;};
  const win=await grab(Array.from({length:last-first+1},(_,i)=>first+i)),bg=await grab(bgIdx);
  const captureMs=performance.now()-t0,res=analyzeBallFrames(win,bg,opts);
  return {...res,window:{first,last},backgroundIndices:bgIdx,captureMs,source:{width:source.info.sourceWidth,height:source.info.sourceHeight,workWidth:source.info.width,workHeight:source.info.height}};
}
