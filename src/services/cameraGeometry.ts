export type ImagePoint={x:number;y:number};
export interface CameraGeometry {method:'assumed'|'line_assisted'|'planar_reference'|'standard_prior';positionM?:[number,number,number];yawDeg?:number;pitchDeg?:number;azimuthDeg:number;elevationDeg:number;rollDeg:number;quality:number;limitations:string[];width:number;height:number;focalPx?:number;rotation?:number[][];translation?:number[];homography?:number[][];referenceWidthM?:number;referenceLengthM?:number;reprojectionRmsePx?:number;}
export interface GroundReference {points:ImagePoint[];widthM:number;lengthM:number;focalPx?:number;}
export function solveLinear(matrix:number[][],rhs:number[]):number[]{const a=matrix.map((r,i)=>[...r,rhs[i]]),n=rhs.length;
  for(let i=0;i<n;i++){let best=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[best][i]))best=j;
    [a[i],a[best]]=[a[best],a[i]];if(Math.abs(a[i][i])<1e-10)throw Error('幾何參考退化，需不共線標記');
    const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const s=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=s*a[i][k];}
  }return a.map(r=>r[n]);}
const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=(a:number[])=>Math.hypot(...a);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function calibrateGroundReference(width:number,height:number,ref:GroundReference):CameraGeometry {
  if(ref.points.length!==4||ref.widthM<=0||ref.lengthM<=0)throw Error('需4個已知矩形角點與正確公尺尺度');
  const world=[[0,0],[ref.widthM,0],[ref.widthM,ref.lengthM],[0,ref.lengthM]],A:number[][]=[],b:number[]=[];
  world.forEach(([x,z],i)=>{const u=ref.points[i].x*width,v=ref.points[i].y*height;A.push([x,z,1,0,0,0,-u*x,-u*z],[0,0,0,x,z,1,-v*x,-v*z]);b.push(u,v);});
  const h=solveLinear(A,b),H=[h.slice(0,3),h.slice(3,6),[h[6],h[7],1]];
  const cx=width/2,cy=height/2;
  const a=[h[0]-cx*h[6],h[3]-cy*h[6],h[6]],c=[h[1]-cx*h[7],h[4]-cy*h[7],h[7]];
  const f2=-(a[0]*c[0]+a[1]*c[1])/(a[2]*c[2]);
  const focal=ref.focalPx||Math.sqrt(f2);if(!Number.isFinite(focal)||focal<width*0.25||focal>width*8)throw Error('無法從單平面求焦距；需提供可信焦距或其他參考');
  const k=(v:number[])=>[v[0]/focal,v[1]/focal,v[2]];const r1=k(a),r2=k(c),scale=2/(norm(r1)+norm(r2));
  let x=r1.map(v=>v*scale),z=r2.map(v=>v*scale);const orthogonality=Math.abs(dot(x,z))/(norm(x)*norm(z));
  if(orthogonality>0.15)throw Error('角點／焦距不符合矩形投影，請重新確認');
  x=x.map(v=>v/norm(x));const p=dot(z,x);z=z.map((v,i)=>v-p*x[i]);z=z.map(v=>v/norm(z));let y=cross(z,x);
  const t=k([h[2]-cx,h[5]-cy,1]).map(v=>v*scale);
  // Ground plane has two normal signs. Select the camera-above-ground solution.
  if(-dot(y,t)<0)y=y.map(v=>-v);
  const R=[0,1,2].map(i=>[x[i],y[i],z[i]]);
  const C=[0,1,2].map(i=>-R.reduce((s,row,j)=>s+row[i]*t[j],0));
  let err=0;world.forEach(([X,Z],i)=>{const q=projectWorld({rotation:R,translation:t,focalPx:focal,width,height} as CameraGeometry,X,0,Z);err+=(q.x-ref.points[i].x*width)**2+(q.y-ref.points[i].y*height)**2;});
  const rmse=Math.sqrt(err/4);if(rmse>Math.max(width,height)*0.03)throw Error('重投影誤差太大，標定被拒絕');
  return {method:'planar_reference',width,height,focalPx:focal,rotation:R,translation:t,homography:H,referenceWidthM:ref.widthM,referenceLengthM:ref.lengthM,reprojectionRmsePx:rmse,azimuthDeg:Math.atan2(-C[0],ref.lengthM/2-C[2])*180/Math.PI,elevationDeg:Math.atan2(C[1],Math.hypot(C[0],ref.lengthM/2-C[2]))*180/Math.PI,rollDeg:Math.atan2(R[1][0],R[0][0])*180/Math.PI,quality:Math.max(0,1-rmse/Math.max(1,width*0.02)-orthogonality),limitations:['假設主點在影像中心、方形像素、無鏡頭畸變；平面角點尺度由使用者確認','離地球體深度仍由飛行時間與距離假设約束，非唯一3D實測']};
}
export function projectWorld(g:CameraGeometry,X:number,Y:number,Z:number):ImagePoint{const R=g.rotation!,t=g.translation!,q=R.map((r,i)=>r[0]*X+r[1]*Y+r[2]*Z+t[i]);return{x:g.width/2+g.focalPx!*q[0]/q[2],y:g.height/2+g.focalPx!*q[1]/q[2]};}
export function reconstructAtDepth(g:CameraGeometry,xNorm:number,yNorm:number,Z:number){if(!g.rotation||!g.translation||!g.focalPx)throw Error('未完成標定');const R=g.rotation,t=g.translation,u=(xNorm*g.width-g.width/2)/g.focalPx,v=(yNorm*g.height-g.height/2)/g.focalPx;
  const xy=solveLinear([[R[0][0]-u*R[2][0],R[0][1]-u*R[2][1]],[R[1][0]-v*R[2][0],R[1][1]-v*R[2][1]]],[u*(R[2][2]*Z+t[2])-R[0][2]*Z-t[0],v*(R[2][2]*Z+t[2])-R[1][2]*Z-t[1]]);return{x:xy[0],y:xy[1],z:Z};}
export function estimateImageLines(image:ImageData):CameraGeometry {
  const {width:w,height:h,data}=image;const bins=Array(61).fill(0);let edges=0;
  const gray=(x:number,y:number)=>{const i=(y*w+x)*4;return(data[i]+data[i+1]+data[i+2])/3;};
  // Gradient normals provide roll evidence only; field orientation/metric scale require known references.
  for(let y=2;y<h-2;y+=3)for(let x=2;x<w-2;x+=3){const gx=gray(x+1,y)-gray(x-1,y),gy=gray(x,y+1)-gray(x,y-1);if(Math.hypot(gx,gy)<55)continue;let a=Math.atan2(-gx,gy)*180/Math.PI;while(a>90)a-=180;while(a< -90)a+=180;if(Math.abs(a)<=30){bins[Math.round(a)+30]++;edges++;}}
  const peak=Math.max(...bins),index=bins.indexOf(peak),quality=edges?peak/edges:0;
  return {method:quality>0.08?'line_assisted':'assumed',width:w,height:h,azimuthDeg:0,elevationDeg:0,rollDeg:quality>0.08?index-30:0,quality:Math.min(0.3,quality),limitations:['影像梯度只提供可能的水平線／roll，未確認場地語義','無已知幾何角點：yaw、pitch、深度與尺度仍無法可靠辨識，沿用原估算且降低信心']};
}
