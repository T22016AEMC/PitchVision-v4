export function isCompactBrightRegion(image:{width:number;height:number;data:Uint8ClampedArray},x:number,y:number,maxRadius:number):boolean {
 const {width:w,height:h,data}=image,r=Math.max(6,Math.ceil(maxRadius)),side=r*2+1,visited=new Uint8Array(side*side),queue:number[]=[r*side+r];let count=0,minX=side,maxX=0,minY=side,maxY=0;
 const bright=(xx:number,yy:number)=>{if(xx<0||yy<0||xx>=w||yy>=h)return false;const i=(yy*w+xx)*4,red=data[i],green=data[i+1],blue=data[i+2];return(red+green+blue)/3>125&&Math.max(red,green,blue)-Math.min(red,green,blue)<50;};
 if(!bright(x,y))return false;
 for(let q=0;q<queue.length;q++){const index=queue[q];if(visited[index])continue;visited[index]=1;const xx=index%side,yy=Math.floor(index/side);
  if(!bright(x+xx-r,y+yy-r))continue;
  if(xx===0||yy===0||xx===side-1||yy===side-1)return false; // Clothing/paint/net regions leave the local ball-sized window.
  count++;minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);
  if(count>Math.PI*r*r*0.8)return false;
  for(const offset of [-1,1,-side,side])if(!visited[index+offset])queue.push(index+offset);
 }
 const bw=maxX-minX+1,bh=maxY-minY+1;
 return count>=2&&Math.max(bw,bh)/Math.max(1,Math.min(bw,bh))<4&&count/(bw*bh)>0.2;
}
