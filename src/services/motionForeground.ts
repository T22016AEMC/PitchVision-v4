export function motionForeground(curr:{width:number;height:number;data:Uint8ClampedArray},prev:{width:number;height:number;data:Uint8ClampedArray}|null){
 if(!prev)return{energy:0,bounds:null};const step=8,gw=Math.ceil(curr.width/step),gh=Math.ceil(curr.height/step),mask=new Uint8Array(gw*gh);let energy=0,n=0;
 for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const i=(Math.min(curr.height-1,gy*step)*curr.width+Math.min(curr.width-1,gx*step))*4;const d=(Math.abs(curr.data[i]-prev.data[i])+Math.abs(curr.data[i+1]-prev.data[i+1])+Math.abs(curr.data[i+2]-prev.data[i+2]))/3;energy+=d;n++;if(d>25)mask[gy*gw+gx]=1;}
 const dilated=new Uint8Array(mask.length);for(let y=1;y<gh-1;y++)for(let x=1;x<gw-1;x++){let active=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)active|=mask[(y+dy)*gw+x+dx];dilated[y*gw+x]=active;}
 const visited=new Uint8Array(mask.length);let largest=0,bounds:null|{xMin:number;xMax:number;yMin:number;yMax:number}=null;
 for(let start=0;start<mask.length;start++){if(!dilated[start]||visited[start])continue;const queue=[start];visited[start]=1;let count=0,x0=gw,y0=gh,x1=0,y1=0;
  for(let q=0;q<queue.length;q++){const p=queue[q],x=p%gw,y=Math.floor(p/gw);count++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
   for(const [xx,yy]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(xx>=0&&xx<gw&&yy>=0&&yy<gh){const j=yy*gw+xx;if(dilated[j]&&!visited[j]){visited[j]=1;queue.push(j);}}
  }if(count>largest&&count>Math.max(25,mask.length*0.004)){largest=count;bounds={xMin:x0/gw,xMax:(x1+1)/gw,yMin:y0/gh,yMax:(y1+1)/gh};}
 }return{energy:energy/Math.max(1,n),bounds};
}
