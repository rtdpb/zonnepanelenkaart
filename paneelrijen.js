// Fit the outline and the internal dividers of a complete, regularly spaced array.
// This pass can recover a weak blue-grey row even when the semantic model missed it.
function zoekPaneelrijen({pixels,width,height,probability,metres,bounds}, anchors=[]) {
  const w=width/2,h=height/2, length=w*h;
  const red=new Float32Array(length), green=new Float32Array(length), blue=new Float32Array(length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=(2*y*width+2*x)*4, q=y*w+x, row=4*width;
    red[q]=(pixels[p]+pixels[p+4]+pixels[p+row]+pixels[p+row+4])/4;
    green[q]=(pixels[p+1]+pixels[p+5]+pixels[p+row+1]+pixels[p+row+5])/4;
    blue[q]=(pixels[p+2]+pixels[p+6]+pixels[p+row+2]+pixels[p+row+6])/4;
  }
  const tint=new Float32Array(length), bright=new Float32Array(length);
  const toneMap=new Float32Array(length), darkGlass=new Uint8Array(length);
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    const i=y*w+x;
    const blur=arr=>(4*arr[i]+2*(arr[i-1]+arr[i+1]+arr[i-w]+arr[i+w])+
      arr[i-w-1]+arr[i-w+1]+arr[i+w-1]+arr[i+w+1])/16;
    const r=blur(red),g=blur(green),b=blur(blue);
    toneMap[i]=.30*r+.59*g+.11*b;
    if (b>=g && g>=r-3 && b<211 && r>27 && b-r<75) tint[i]=b-r;
    if (Math.abs(b-r)<24 && Math.abs(g-r)<15) bright[i]=.30*r+.59*g+.11*b;
  }
  for(let y=3;y<h-3;y++) for(let x=3;x<w-3;x++){
    const i=y*w+x, value=toneMap[i];
    if(value<28 || value>105 || green[i]-red[i]>26 || green[i]-blue[i]>19 ||
      red[i]-blue[i]>17 || blue[i]-red[i]>40)continue;
    // Smooth glass against the fine repeating relief of roof tiles.
    let sum=0, square=0;
    for(let j=-2;j<=2;j+=2)for(let k=-2;k<=2;k+=2){
      const v=toneMap[i+j*w+k];sum+=v;square+=v*v;
    }
    if(square/9-(sum/9)**2<35)darkGlass[i]=255-Math.round(value);
  }

  const mask=new Uint8Array(length), dilated=new Uint8Array(length), queue=new Int32Array(length);
  function closedMask(field,threshold,open=false) {
    dilated.fill(0); mask.fill(0);
    for(let i=w+1;i<length-w-1;i++) if(field[i]>=threshold) {
      for(let dy=-w;dy<=w;dy+=w) {
        dilated[i+dy-1]=1; dilated[i+dy]=1; dilated[i+dy+1]=1;
      }
    }
    for(let i=w+1;i<length-w-1;i++) {
      mask[i]=dilated[i] && dilated[i-1] && dilated[i+1] && dilated[i-w] && dilated[i+w] &&
        dilated[i-w-1] && dilated[i-w+1] && dilated[i+w-1] && dilated[i+w+1];
    }
    if(open){
      dilated.fill(0);
      for(let i=w+1;i<length-w-1;i++) if(mask[i-1] && mask[i+1] && mask[i-w] && mask[i+w] &&
        mask[i] && mask[i-w-1] && mask[i-w+1] && mask[i+w-1] && mask[i+w+1])dilated[i]=1;
      mask.fill(0);
      for(let i=w+1;i<length-w-1;i++) if(dilated[i]) {
        for(let dy=-w;dy<=w;dy+=w)mask[i+dy-1]=mask[i+dy]=mask[i+dy+1]=1;
      }
    }
  }
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function hull(points) {
    points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const lower=[], upper=[];
    function push(side,p) {
      while(side.length>=2 && cross(side[side.length-2],side[side.length-1],p)<=0) side.pop();
      side.push(p);
    }
    for(const p of points) push(lower,p);
    for(let i=points.length-1;i>=0;i--) push(upper,points[i]);
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  function rectangle(n,yMin,yMax) {
    const rows=yMax-yMin+1, lo=new Int32Array(rows).fill(w), hi=new Int32Array(rows).fill(-1);
    for(let i=0;i<n;i++) {
      const p=queue[i], row=Math.floor(p/w)-yMin, x=p%w;
      lo[row]=Math.min(lo[row],x); hi[row]=Math.max(hi[row],x);
    }
    const ends=[];
    for(let y=0;y<rows;y++) if(hi[y]>=0) {
      ends.push([lo[y]*2+1,(y+yMin)*2+1],[hi[y]*2+1,(y+yMin)*2+1]);
    }
    const poly=hull(ends); let best=null;
    for(let i=0;i<poly.length;i++) {
      const a=poly[i], b=poly[(i+1)%poly.length], angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
      const cs=Math.cos(angle),sn=Math.sin(angle);
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const [x,y] of poly) {
        const u=cs*x+sn*y,v=-sn*x+cs*y;
        left=Math.min(left,u);right=Math.max(right,u);top=Math.min(top,v);bottom=Math.max(bottom,v);
      }
      const wide=right-left+2,high=bottom-top+2,surface=wide*high;
      if(best && best.surface<=surface) continue;
      const u=(right+left)/2,v=(bottom+top)/2;
      best={x:u*cs-v*sn,y:u*sn+v*cs,wide:Math.max(wide,high),high:Math.min(wide,high),
        angle:wide>=high?angle:angle+Math.PI/2,fill:4*n/surface,surface};
    }
    return best;
  }
  function fit(rect) {
    const pad=Math.ceil(.43/metres), W=Math.ceil(rect.wide)+2*pad+1, H=Math.ceil(rect.high)+2*pad+1;
    const cs=Math.cos(rect.angle), sn=Math.sin(rect.angle);
    const x0=rect.x-cs*(W-1)/2+sn*(H-1)/2, y0=rect.y-sn*(W-1)/2-cs*(H-1)/2;
    const world=(u,v)=>[x0+cs*u-sn*v,y0+sn*u+cs*v];
    const tone=new Float32Array(W*H), chroma=new Float32Array(W*H), prob=new Uint8Array(W*H);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const px=x0+cs*x-sn*y,py=y0+sn*x+cs*y;
      const xx=Math.max(0,Math.min(width-1,Math.floor(px))), yy=Math.max(0,Math.min(height-1,Math.floor(py)));
      const k=(yy*width+xx)*4,i=y*W+x;
      tone[i]=.30*pixels[k]+.59*pixels[k+1]+.11*pixels[k+2];
      chroma[i]=pixels[k+2]-pixels[k]; prob[i]=probability[(yy>>1)*w+(xx>>1)];
    }
    const gap=Math.max(2,Math.round(.115/metres));
    function edge(axis,pos,from,to,inside) {
      let sum=0,n=0;
      for(let t=from;t<=to;t+=2){
        const i=axis?t*W+pos:pos*W+t, delta=(axis?1:W)*gap*inside;
        const dy=tone[i+delta]-tone[i-delta], dc=chroma[i+delta]-chroma[i-delta];
        sum+=Math.min(65,Math.hypot(dy,.8*dc)+.25*Math.max(dc,0));n++;
      }
      return sum/Math.max(1,n);
    }
    const search=Math.floor(.27/metres);
    function border(axis,start,from,to,inside) {
      let best=-Infinity,pos=start;
      for(let k=start-search;k<=start+search;k++) {
        const strength=edge(axis,k,from,to,inside)-.18*Math.abs(k-start);
        if(strength>best){best=strength;pos=k;}
      }
      return {pos,strength:best};
    }
    const L=border(1,pad,pad+3,H-pad-4,1), R=border(1,W-pad-1,pad+3,H-pad-4,-1);
    const T=border(0,pad,pad+3,W-pad-4,1), B=border(0,H-pad-1,pad+3,W-pad-4,-1);
    const l=L.pos,r=R.pos,t=T.pos,b=B.pos;
    if(r-l<8||b-t<8)return null;
    const sides=[L,R,T,B].map(e=>e.strength).sort((a,b)=>a-b);
    if(sides[1]<7 || sides[2]<11) return null;
    let mean=0,square=0,hue=0,pv=0,n=0;
    for(let y=t+2;y<b-1;y+=2) for(let x=l+2;x<r-1;x+=2){
      const i=y*W+x;mean+=tone[i];square+=tone[i]**2;hue+=chroma[i];pv+=prob[i];n++;
    }
    mean/=n; hue/=n; pv/=255*n;
    const deviation=Math.sqrt(Math.max(0,square/n-mean*mean));
    if(rect.dark || rect.glare){
      if(Math.abs(hue)>25 || sides[1]<10 ||
        (rect.dark ? mean>106 || deviation>12 : mean<148 || deviation>15))return null;
    } else if(rect.silver) {
      if(mean<160 || Math.abs(hue)>21 || deviation>21) return null;
      // Inclined, reflective strings show a strip of shadow along a long side.
      let shadow=false;
      for(const sign of [-1,1]) {
        let dark=0,total=0,drop=0;
        for(let u=l+3;u<r-2;u+=3){
          let outside=255;
          for(const distance of [.12,.22,.34]){
            const [x,y]=world(u,(sign<0?t:b)+sign*distance/metres);
            const i=Math.max(0,Math.min(h-1,Math.floor(y/2)))*w+Math.max(0,Math.min(w-1,Math.floor(x/2)));
            outside=Math.min(outside,.30*red[i]+.59*green[i]+.11*blue[i]);
          }
          const diff=mean-outside;
          if(diff>35) dark++;
          drop+=diff; total++;
        }
        if(dark>.72*total && drop/total>43)shadow=true;
      }
      if(!shadow)return null;
    } else if(hue<5 || deviation>22 || (pv<.22 && (hue<8 || deviation>17))) return null;
    function profile(axis,start,end,from,to) {
      const lines=new Float32Array(end-start+1);
      const d=(axis?1:W)*gap;
      for(let k=start+gap;k<=end-gap;k++) {
        let sum=0,count=0;
        for(let s=from+2;s<=to-2;s++){
          const i=axis?s*W+k:k*W+s;
          const dy=Math.abs(tone[i]-.5*(tone[i-d]+tone[i+d]))+.35*Math.abs(tone[i+d]-tone[i-d]);
          const dc=Math.abs(chroma[i]-.5*(chroma[i-d]+chroma[i+d]));
          sum+=Math.min(45,dy+.48*dc); count++;
        }
        lines[k-start]=sum/Math.max(1,count);
      }
      return lines;
    }
    const vlines=profile(1,l,r,t,b), hlines=profile(0,t,b,l,r);
    function seams(lines,count) {
      const step=(lines.length-1)/count;
      let contrast=0,signal=0,hits=0;
      for(let j=1;j<count;j++) {
        const p=Math.round(j*step), wiggle=Math.max(1,Math.round(step*.085));
        let peak=0,off=0,weight=0;
        for(let k=-wiggle;k<=wiggle;k++) peak=Math.max(peak,lines[p+k]);
        for(let k=Math.round(.20*step);k<=Math.round(.38*step);k++){
          off+=lines[p+k]+lines[p-k];weight+=2;
        }
        off/=Math.max(1,weight); contrast+=peak-off;signal+=peak;
        if(peak>1.12*off+.6) hits++;
      }
      return {contrast,signal,hits};
    }
    const wide=(r-l)*metres, high=(b-t)*metres;
    const nearby=[];
    for (const anchor of anchors) {
      const dx=anchor.center[0]-x0,dy=anchor.center[1]-y0;
      const u=dx*cs+dy*sn-l,v=-dx*sn+dy*cs-t;
      if (u<0 || u>r-l || v<0 || v>b-t || anchor.score<8) continue;
      const us=anchor.points.map(p=>p[0]*cs+p[1]*sn),vs=anchor.points.map(p=>-p[0]*sn+p[1]*cs);
      nearby.push({u,v,w:Math.max(...us)-Math.min(...us),h:Math.max(...vs)-Math.min(...vs)});
    }
    function agreement(cols,rows) {
      const cw=(r-l)/cols,ch=(b-t)/rows;
      const votes=new Map();
      for(const a of nearby){
        const col=Math.min(cols-1,Math.floor(a.u/cw)),row=Math.min(rows-1,Math.floor(a.v/ch));
        const du=(a.u/cw-col-.5),dv=(a.v/ch-row-.5);
        const sizeError=Math.log(a.w/cw)**2+Math.log(a.h/ch)**2;
        const value=Math.exp(-11*(du*du+dv*dv)-5*sizeError);
        const key=row*cols+col;votes.set(key,Math.max(votes.get(key)||0,value));
      }
      let sum=0;for(const v of votes.values())sum+=v;
      return sum/(cols*rows);
    }
    let best=null;
    for(let cols=1;cols<=Math.floor(wide/.70);cols++) for(let rows=1;rows<=Math.floor(high/.70);rows++){
      if(cols*rows<3 || cols*rows>220)continue;
      if(rect.silver && (rows!==1 || cols<3))continue;
      if(rect.glare && (cols<2 || rows<2))continue;
      const a=wide/cols,c=high/rows,short=Math.min(a,c),long=Math.max(a,c);
      if(short<.70||short>1.29||long<1.15||long>2.17||long/short<1.12||long/short>2.65||a*c<1.03||a*c>2.53)continue;
      const xx=seams(vlines,cols), yy=seams(hlines,rows), total=cols+rows-2;
      const confirmed=agreement(cols,rows);
      if(confirmed<.68 && ((cols>1 && xx.hits<(cols-1)*.40) || (rows>1 && yy.hits<(rows-1)*.40)))continue;
      const contrast=(xx.contrast+yy.contrast)/total, hit=(xx.hits+yy.hits)/total, signal=(xx.signal+yy.signal)/total;
      const prior=Math.exp(-.5*((short-1.025)/.22)**2-.5*((long-1.66)/.39)**2);
      const merit=contrast+.13*Math.min(16,signal)+2.7*prior+1.3*hit+8*confirmed;
      if(!best || merit>best.merit)best={cols,rows,merit,contrast,hit,prior};
    }
    if(!best || best.contrast<.4 || best.hit<.4) return null;
    if(rect.dark || rect.glare) {
      if(rect.fill<.85 || best.prior<.35 || best.hit<.74 ||
        best.contrast<(rect.dark?1.15:2.5))return null;
      // A dark roof or shadow can be rectangular too. Without independent
      // model support, require dividers that stand out against the glass texture.
      if(rect.dark && pv<.16 && best.contrast<3)return null;
    } else if(rect.silver) {
      if(best.contrast<2.4 || best.hit<.63 || best.prior<.27) return null;
    } else if(pv<.22 && (best.contrast<1.05||best.hit<.58||rect.fill<.80||sides[1]<10)) return null;
    if(Math.max(best.cols,best.rows)<3 && pv<.43 && nearby.length<2) return null;
    const quality=best.merit+3*rect.fill+.07*Math.min(sides[1],32)+2*pv;
    const boxes=[], cw=(r-l)/best.cols, ch=(b-t)/best.rows;
    for(let row=0;row<best.rows;row++) for(let col=0;col<best.cols;col++){
      const u=l+cw*col,v=t+ch*row,center=world(u+cw/2,v+ch/2),inset=.55;
      if(center[0]<bounds[0]||center[0]>=bounds[2]||center[1]<bounds[1]||center[1]>=bounds[3])continue;
      let cellChroma=0,cellTone=0,inside=0;
      for(let yy=Math.ceil(v+.17*ch);yy<v+.84*ch;yy+=2)for(let xx=Math.ceil(u+.17*cw);xx<u+.84*cw;xx+=2){
        const i=yy*W+xx;cellChroma+=chroma[i];cellTone+=tone[i];inside++;
      }
      cellChroma/=inside;cellTone/=inside;
      if(rect.dark || rect.glare || rect.silver ? Math.abs(cellTone-mean)>20 || Math.abs(cellChroma-hue)>13 :
        cellChroma<Math.max(4,.34*hue) || (cellTone>mean+23 && cellChroma<.73*hue))continue;
      boxes.push({center,points:[world(u+inset,v+inset),world(u+cw-inset,v+inset),
        world(u+cw-inset,v+ch-inset),world(u+inset,v+ch-inset)],
        score:(rect.dark || rect.glare ? 2 : 55)+quality,...((rect.dark || rect.glare) && {roofOnly:true})});
    }
    const [cx,cy]=world((l+r)/2,(t+b)/2);
    return {boxes,quality,cx,cy,cs,sn,wide:r-l,high:b-t,cols:best.cols,rows:best.rows,hue,mean,
      silver:rect.silver,roofOnly:rect.dark || rect.glare};
  }
  const candidates=[];
  const passes=[[tint,[7,12,18,26]],[bright,[168,180,192],"silver"],
    [darkGlass,[255-62,255-74,255-88,255-100],"dark"],[bright,[150,164,181],"glare"]];
  for(const [field,thresholds,kind] of passes)for(const threshold of thresholds) {
    closedMask(field,threshold,kind==="dark");
    for(let p=w+1;p<length-w-1;p++) {
      if(!mask[p])continue;
      let n=1,yMin=h,yMax=0,xMin=w,xMax=0; queue[0]=p;mask[p]=0;
      for(let head=0;head<n;head++) {
        const q=queue[head],x=q%w,y=Math.floor(q/w);
        yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);xMin=Math.min(xMin,x);xMax=Math.max(xMax,x);
        for(let yy=Math.max(1,y-1);yy<=Math.min(h-2,y+1);yy++) for(let xx=Math.max(1,x-1);xx<=Math.min(w-2,x+1);xx++){
          const k=yy*w+xx;if(mask[k]){queue[n++]=k;mask[k]=0;}
        }
      }
      const surface=n*(2*metres)**2;
      if(surface<2.25||surface>270||xMin<2||yMin<2||xMax>w-3||yMax>h-3)continue;
      const rect=rectangle(n,yMin,yMax);
      if(!rect||rect.fill<.77||rect.high*metres<.69||rect.high*metres>13||rect.wide*metres>35)continue;
      if(kind)rect[kind]=true;
      const group=fit(rect);
      if(group?.boxes.length)candidates.push(group);
    }
  }
  const chosen=[];
  function alreadyFound(group) {
    return chosen.some(other=>{
      const dx=group.cx-other.cx,dy=group.cy-other.cy;
      return Math.abs(other.cs*dx+other.sn*dy)<other.wide*.48 && Math.abs(-other.sn*dx+other.cs*dy)<other.high*.48;
    });
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  for(const group of candidates){
    if(!group.roofOnly && !alreadyFound(group))chosen.push(group);
  }
  // Parallel strings can touch a blue gutter in the colour mask. A confirmed
  // neighbouring string supplies a size to search for; each new row must still
  // show its own colour, two outer edges and its own repeated dividers.
  function parallelRows(group) {
    const pitch=group.wide/group.cols, half=group.high/2, proposals=[];
    const index=(cx,cy,u,v)=>Math.max(0,Math.min(h-1,Math.floor((cy+u*group.sn+v*group.cs)/2)))*w
      + Math.max(0,Math.min(w-1,Math.floor((cx+u*group.cs-v*group.sn)/2)));
    const lum=i=>.30*red[i]+.59*green[i]+.11*blue[i];
    const colour=i=>blue[i]-red[i];
    for(const sign of [-1,1]) {
      for(let v=group.high*.95;v<Math.min(group.high*5.5,7/metres);v+=Math.max(3,.16/metres)){
        for(const slide of [-.5,-.25,0,.25,.5]) {
          const u=slide*pitch,cx=group.cx+u*group.cs-sign*v*group.sn,cy=group.cy+u*group.sn+sign*v*group.cs;
          if(cx<20||cy<20||cx>width-20||cy>height-20||alreadyFound({cx,cy}))continue;
          let match=0,total=0,topEdge=0,bottomEdge=0;
          for(let k=0;k<group.cols;k++)for(const phase of [.25,.65]){
            const t=-group.wide/2+(k+phase)*pitch;
            for(const off of [-.48,0,.48]) {
              const i=index(cx,cy,t,half*off);
              if(Math.abs(lum(i)-group.mean)<23 && Math.abs(colour(i)-group.hue)<13 && (group.silver?lum(i)>155:colour(i)>5)) match++;
              total++;
            }
            for(const s of [-1,1]){
              const inside=index(cx,cy,t,s*(half-.13/metres)), outside=index(cx,cy,t,s*(half+.15/metres));
              const difference=Math.hypot(lum(inside)-lum(outside),colour(inside)-colour(outside));
              if(s<0)topEdge+=Math.min(52,difference);else bottomEdge+=Math.min(52,difference);
            }
          }
          const fill=match/total, edge=Math.min(topEdge,bottomEdge)/(2*group.cols);
          if(fill<.82||edge<11)continue;
          proposals.push({cx,cy,fill,rank:edge+18*fill});
        }
      }
    }
    const tried=[];
    for(const guess of proposals.sort((a,b)=>b.rank-a.rank)){
      if(alreadyFound(guess)||tried.some(old=>Math.hypot(guess.cx-old.cx,guess.cy-old.cy)<group.high*.55))continue;
      tried.push(guess);
      const next=fit({x:guess.cx,y:guess.cy,angle:Math.atan2(group.sn,group.cs),wide:group.wide,high:group.high,fill:guess.fill,silver:group.silver});
      if(next && next.rows===1 && next.cols===group.cols && next.boxes.length && next.quality>=10 && !alreadyFound(next)) chosen.push(next);
      if(tried.length>=4)break;
    }
  }
  for(const group of chosen.slice()){
    if(group.rows===1 && group.cols>=3 && group.cols<=14 && group.quality>=11)parallelRows(group);
  }
  function hasParallelString(group) {
    return chosen.some(other=>{
      if(other===group || !other.silver || other.cols!==group.cols || Math.abs(other.wide/group.wide-1)>.14) return false;
      if(Math.abs(other.cs*group.cs+other.sn*group.sn)<.985) return false;
      const dx=other.cx-group.cx,dy=other.cy-group.cy;
      const along=Math.abs(group.cs*dx+group.sn*dy),across=Math.abs(-group.sn*dx+group.cs*dy);
      return along<.65*group.wide/group.cols && across>.84*group.high && across<5.5*group.high;
    });
  }
  const supported=chosen.filter(group=>!group.silver || hasParallelString(group));
  chosen.length=0;chosen.push(...supported);
  for(const group of candidates)if(group.roofOnly && !alreadyFound(group))chosen.push(group);
  return chosen.flatMap(group=>group.boxes);
}
if (typeof module!=="undefined" && module.exports) module.exports=zoekPaneelrijen;
