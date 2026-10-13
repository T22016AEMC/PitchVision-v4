export interface PixelFrame { width:number; height:number; data:Uint8ClampedArray }
export interface MotionVector { dx:number;dy:number;error:number;texture:number;valid:boolean }
export interface MotionField { columns:number; rows:number; spacing:number; vectors:MotionVector[] }
export interface InterpolationQuality { level:'limited'|'low'; reliableFraction:number; movingFraction:number; maxMotionPx:number; meanResidual:number; identicalSources:boolean; note:string }
export interface MotionPair { a:PixelFrame;b:PixelFrame;forward:MotionField;backward:MotionField;quality:InterpolationQuality }

const gray=(f:PixelFrame)=>{const out=new Float32Array(f.width*f.height);for(let i=0;i<out.length;i++)out[i]=(f.data[4*i]*0.299+f.data[4*i+1]*0.587+f.data[4*i+2]*0.114);return out;};
function half(a:Float32Array,w:number,h:number){const nw=Math.ceil(w/2),nh=Math.ceil(h/2),out=new Float32Array(nw*nh);for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){let s=0,n=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++){const px=x*2+i,py=y*2+j;if(px<w&&py<h){s+=a[py*w+px];n++;}}out[y*nw+x]=s/n;}return{data:out,w:nw,h:nh};}
function patchError(a:Float32Array,b:Float32Array,w:number,h:number,x:number,y:number,dx:number,dy:number){
  let cost=0,n=0;for(let yy=-3;yy<=3;yy+=2)for(let xx=-3;xx<=3;xx+=2){const ax=x+xx,ay=y+yy,bx=ax+dx,by=ay+dy;if(ax<0||ay<0||bx<0||by<0||ax>=w||bx>=w||ay>=h||by>=h)continue;cost+=Math.abs(a[ay*w+ax]-b[by*w+bx]);n++;}return n>=9?cost/n:255;
}
function search(a:Float32Array,b:Float32Array,w:number,h:number,x:number,y:number,cx:number,cy:number,r:number){
  let best=Infinity,dx=0,dy=0;const costs:{cost:number;dx:number;dy:number}[]=[];
  for(let j=cy-r;j<=cy+r;j++)for(let i=cx-r;i<=cx+r;i++){const cost=patchError(a,b,w,h,x,y,i,j);costs.push({cost,dx:i,dy:j});if(cost<best){best=cost;dx=i;dy=j;}}
  const second=Math.min(...costs.filter(p=>Math.hypot(p.dx-dx,p.dy-dy)>2).map(p=>p.cost));
  return{dx,dy,error:best,margin:second-best};
}
function field(a:Float32Array,b:Float32Array,w:number,h:number,spacing=8):MotionField{
  const pa=half(a,w,h),pb=half(b,w,h),qa=half(pa.data,pa.w,pa.h),qb=half(pb.data,pb.w,pb.h);
  const columns=Math.ceil(w/spacing),rows=Math.ceil(h/spacing),vectors:MotionVector[]=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const x=Math.min(w-4,col*spacing+spacing/2),y=Math.min(h-4,row*spacing+spacing/2);
    const stay=patchError(a,b,w,h,x,y,0,0);
    let mean=0,sq=0,n=0;for(let j=-3;j<=3;j+=2)for(let i=-3;i<=3;i+=2){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h){const v=a[yy*w+xx];mean+=v;sq+=v*v;n++;}}
    const texture=Math.sqrt(Math.max(0,sq/n-(mean/n)**2));
    if(stay<1.5){vectors.push({dx:0,dy:0,error:stay,texture,valid:true});continue;}
    const coarse=search(qa.data,qb.data,qa.w,qa.h,Math.round(x/4),Math.round(y/4),0,0,8);
    const mid=search(pa.data,pb.data,pa.w,pa.h,Math.round(x/2),Math.round(y/2),coarse.dx*2,coarse.dy*2,3);
    const fine=search(a,b,w,h,x,y,mid.dx*2,mid.dy*2,3);
    // Also consider a full-resolution local solution, protecting small moving details from pyramid loss.
    const local=search(a,b,w,h,x,y,0,0,8),best=local.error<fine.error?local:fine;
    vectors.push({...best,texture,valid:texture>=5&&best.error<26&&(best.margin>0.8||best.error<2)});
  }return{columns,rows,spacing,vectors};
}
function vectorAt(f:MotionField,x:number,y:number):MotionVector {
  const col=Math.max(0,Math.min(f.columns-1,Math.round(x/f.spacing-0.5))),row=Math.max(0,Math.min(f.rows-1,Math.round(y/f.spacing-0.5)));
  return f.vectors[row*f.columns+col];
}
export function estimateMotionPair(a:PixelFrame,b:PixelFrame):MotionPair{
  if(a.width!==b.width||a.height!==b.height||a.width<16||a.height<16||a.data.length!==a.width*a.height*4||b.data.length!==a.data.length)throw Error('相鄰來源影像尺寸不合法');
  const ga=gray(a),gb=gray(b),forward=field(ga,gb,a.width,a.height),backward=field(gb,ga,a.width,a.height);
  let reliable=0,moving=0,maxMotion=0,residual=0,difference=0;
  for(let i=0;i<ga.length;i++)difference+=Math.abs(ga[i]-gb[i]);
  // Forward/backward consistency rejects occlusion, ambiguous matches and nonlocal jump estimates.
  for(const f of [forward,backward]){const opposite=f===forward?backward:forward;
    f.vectors.forEach((v,i)=>{const x=(i%f.columns)*f.spacing+f.spacing/2,y=Math.floor(i/f.columns)*f.spacing+f.spacing/2;
      const back=vectorAt(opposite,x+v.dx,y+v.dy);v.valid=v.valid&&back.valid&&Math.hypot(v.dx+back.dx,v.dy+back.dy)<=2.5;
    });
  }
  for(const v of forward.vectors){if(Math.hypot(v.dx,v.dy)>0.5||v.error>3){moving++;if(v.valid)reliable++;}maxMotion=Math.max(maxMotion,Math.hypot(v.dx,v.dy));residual+=v.error;}
  const fraction=moving?reliable/moving:1,identical=difference/ga.length<0.1;
  return {a,b,forward,backward,quality:{level:fraction>=0.45?'limited':'low',reliableFraction:fraction,movingFraction:moving/forward.vectors.length,maxMotionPx:maxMotion,meanResidual:residual/forward.vectors.length,identicalSources:identical,note:identical?'相鄰來源相同，無額外運動資訊；不宣稱補出新影像':'局部雙向運動推算；遮蔽／模糊／不一致區保留鄰近原像素。棒球位置未驗證，事件精度仍受原始間距限制。'}};
}
function pixel(f:PixelFrame,x:number,y:number,c:number){x=Math.max(0,Math.min(f.width-1,x));y=Math.max(0,Math.min(f.height-1,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,nx=Math.min(ix+1,f.width-1),ny=Math.min(iy+1,f.height-1);return f.data[(iy*f.width+ix)*4+c]*(1-fx)*(1-fy)+f.data[(iy*f.width+nx)*4+c]*fx*(1-fy)+f.data[(ny*f.width+ix)*4+c]*(1-fx)*fy+f.data[(ny*f.width+nx)*4+c]*fx*fy;}
export function renderMotionIntermediate(pair:MotionPair,alpha:number):Uint8ClampedArray{
  if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw Error('插值時間比例不合法');
  if(alpha===0)return pair.a.data.slice();if(alpha===1)return pair.b.data.slice();
  const {a,b,forward,backward}=pair,out=new Uint8ClampedArray(a.data.length);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
    let ax=x,ay=y,bx=x,by=y;
    for(let i=0;i<2;i++){const va=vectorAt(forward,ax,ay),vb=vectorAt(backward,bx,by);ax=x-alpha*va.dx;ay=y-alpha*va.dy;bx=x-(1-alpha)*vb.dx;by=y-(1-alpha)*vb.dy;}
    const va=vectorAt(forward,ax,ay),vb=vectorAt(backward,bx,by),valid=va.valid&&vb.valid;
    for(let c=0;c<3;c++)out[(y*a.width+x)*4+c]=valid?pixel(a,ax,ay,c)*(1-alpha)+pixel(b,bx,by,c)*alpha:(alpha<0.5?a:b).data[(y*a.width+x)*4+c];
    out[(y*a.width+x)*4+3]=255;
  }return out;
}
