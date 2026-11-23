// Refine a solar-probability raster into individual, oriented modules on the original photograph.
function zoekPaneelvormen({ pixels, width, height, probability, metres, bounds }) {
  const mw = width / 2, mh = height / 2;
  const regionThreshold = 59;
  const labels = new Int32Array(mw * mh);
  const queue = new Int32Array(labels.length);
  const luma = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
    luma[i] = (77 * pixels[j] + 150 * pixels[j + 1] + 29 * pixels[j + 2]) >> 8;
  }
  const result = [];
  let id = 0;

  function bilinear(arr, w, h, x, y) {
    x = Math.max(0, Math.min(w - 1.001, x));
    y = Math.max(0, Math.min(h - 1.001, y));
    const a = Math.floor(x), b = Math.floor(y), i = b * w + a;
    const dx = x - a, dy = y - b;
    return (arr[i] * (1-dx) + arr[i+1] * dx) * (1-dy)
      + (arr[i+w] * (1-dx) + arr[i+w+1] * dx) * dy;
  }

  function examine(component, size, peak) {
    if (size * (2 * metres) ** 2 < 0.65 || peak < 99) return;
    const histogram = new Float64Array(90);
    const subsample = Math.max(1, Math.floor(size / 16000));
    for (let j = 0; j < size; j += subsample) {
      const m = component[j], mx = m % mw, my = Math.floor(m / mw);
      for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) {
        const x = mx*2+u, y = my*2+v;
        if (x < 1 || y < 1 || x >= width-1 || y >= height-1) continue;
        const q = y * width + x;
        const dx = luma[q+1] - luma[q-1], dy = luma[q+width] - luma[q-width];
        const magnitude = Math.hypot(dx,dy);
        if (magnitude < 7) continue;
        const bin = (Math.round(Math.atan2(dy,dx)*180/Math.PI) + 360) % 90;
        histogram[bin] += Math.min(55,magnitude) ** 1.6;
      }
    }
    let bestAngle = 0, strongest = 0;
    for (let i = 0; i < 90; i++) {
      let sum = 0;
      for (let d = -5; d <= 5; d++) sum += histogram[(i+d+90)%90] * (6-Math.abs(d));
      if (sum > strongest) { strongest=sum; bestAngle=i; }
    }
    const angle = bestAngle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let j = 0; j < size; j++) {
      const m = component[j], x = (m % mw)*2+1, y = Math.floor(m/mw)*2+1;
      const u = c*x+s*y, v = -s*x+c*y;
      u0=Math.min(u0,u); u1=Math.max(u1,u); v0=Math.min(v0,v); v1=Math.max(v1,v);
    }
    const pad = Math.ceil(.62/metres)+3;
    u0 = Math.floor(u0)-pad; v0 = Math.floor(v0)-pad;
    const w = Math.ceil(u1)-u0+pad+1, h = Math.ceil(v1)-v0+pad+1;
    const stride=w+1;
    const tone = new Float32Array(w*h), chroma = new Float32Array(w*h), prob = new Uint8Array(w*h);
    const colors = new Float64Array(32*32);
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const x = (u+u0)*c-(v+v0)*s, y = (u+u0)*s+(v+v0)*c;
      const i=v*w+u;
      tone[i]=bilinear(luma,width,height,x-.5,y-.5);
      if (x<0 || y<0 || x>=width || y>=height) continue;
      const maskIndex = Math.floor(y/2)*mw+Math.floor(x/2);
      const lab = labels[maskIndex];
      if (lab===id || probability[maskIndex]<regionThreshold) {
        prob[i]=Math.round(bilinear(probability,mw,mh,x/2-.5,y/2-.5));
      }
      const rgb=(Math.floor(y)*width+Math.floor(x))*4;
      chroma[i]=pixels[rgb+2]-pixels[rgb];
      if(lab===id && prob[i]>Math.max(89,peak*.7)) {
        const lbin=Math.min(31,Math.floor(tone[i]/8));
        const bbin=Math.min(31,Math.max(0,Math.floor(chroma[i]/4)+12));
        colors[lbin*32+bbin]+=(prob[i]/peak)**2;
      }
    }
    let mode=0,modeWeight=0;
    for(let l=0;l<32;l++)for(let b=0;b<32;b++){
      let weight=0;
      for(let dl=-2;dl<=2;dl++)for(let db=-1;db<=1;db++) {
        if(l+dl>=0&&l+dl<32&&b+db>=0&&b+db<32)weight+=colors[(l+dl)*32+b+db]*(3-Math.abs(dl))*(2-Math.abs(db));
      }
      if(weight>modeWeight){modeWeight=weight;mode=l*32+b;}
    }
    const faceTone=(Math.floor(mode/32)+.5)*8, faceChroma=(mode%32-11.5)*4;
    const vert = new Float32Array(w*h), horiz = new Float32Array(w*h);
    for (let y=2;y<h-2;y++) for(let x=2;x<w-2;x++) {
      const i=y*w+x;
      const rx=Math.abs(tone[i]-(tone[i-2]+tone[i+2])*.5);
      const ry=Math.abs(tone[i]-(tone[i-2*w]+tone[i+2*w])*.5);
      vert[i]=Math.min(55,.59*Math.abs(tone[i+1]-tone[i-1])+rx);
      horiz[i]=Math.min(55,.59*Math.abs(tone[i+w]-tone[i-w])+ry);
    }
    // Row and column sums let candidate edges be measured at every plausible panel size.
    const col = new Float32Array(w*(h+1)), row = new Float32Array(stride*h);
    const ps = new Float64Array(stride*(h+1)), ts = new Float64Array(ps.length);
    const same = new Float64Array(ps.length), squared=new Float64Array(ps.length);
    for (let y=0;y<h;y++) {
      let rp=0,rt=0,rs=0,rq=0;
      for(let x=0;x<w;x++) {
        const i=y*w+x,t=(y+1)*stride+x+1;
        rp+=prob[i]; rt+=tone[i]; ps[t]=ps[t-stride]+rp; ts[t]=ts[t-stride]+rt;
        const distance=((tone[i]-faceTone)/27)**2+((chroma[i]-faceChroma)/9.5)**2;
        rs+=1/(1+distance*.74);rq+=tone[i]*tone[i];
        same[t]=same[t-stride]+rs;squared[t]=squared[t-stride]+rq;
        col[i+w]=col[i]+vert[i]; row[y*stride+x+1]=row[y*stride+x]+horiz[i];
      }
    }
    function areaSum(integral,x,y,r,b) {
      return integral[b*stride+r]-integral[y*stride+r]-integral[b*stride+x]+integral[y*stride+x];
    }
    function ve(x,y,b) { return (col[b*w+x]-col[y*w+x])/(b-y); }
    function he(y,x,r) { return (row[y*stride+r]-row[y*stride+x])/(r-x); }
    const shapes=[];
    const shorts=[.72,.86,.98,1.09,1.22], longs=[1.22,1.40,1.58,1.76,1.94,2.12];
    for(const a of shorts) for(const b of longs) {
      if(b/a<1.14 || b/a>2.6 || a*b<1.03 || a*b>2.48) continue;
      const nx=Math.round(a/metres),ny=Math.round(b/metres);
      const prior=Math.exp(-.5*((a-1.04)/.28)**2-.5*((b-1.75)/.50)**2);
      shapes.push([nx,ny,prior],[ny,nx,prior]);
    }
    const cut = peak >= 145 ? 48 : 66;
    // On a single array, a busbar can resemble a module edge. A second scan can use the
    // area of well-supported neighbours, irrespective of portrait/landscape rotation.
    function proposals(typicalArea = 0) {
      const candidates = [];
      const sizes = shapes.flatMap(([rw, rh, prior]) => {
        const ratio = typicalArea ? rw * rh / typicalArea : 1;
        if (ratio < .75 || ratio > 1.4) return [];
        const sizeWeight = Math.exp(-1.65 * Math.log(ratio) ** 2);
        return [[rw, rh, prior, sizeWeight]];
      });
      for (let y = 4; y < h-4; y += 2) {
        for (let x = 4; x < w-4; x += 2) {
          if (prob[y*w+x] < cut) continue;
          let best = null;
          for (const [rw, rh, prior, sizeWeight] of sizes) {
            const a = x-Math.floor(rw/2), t = y-Math.floor(rh/2), r = a+rw, b = t+rh;
            if (a < 2 || t < 2 || b > h-3 || r > w-3) continue;
            const avg = areaSum(ps,a+1,t+1,r,b) / ((rw-1)*(rh-1));
            if (avg < 49) continue;
            const pairV = Math.sqrt(ve(a,t+1,b) * ve(r,t+1,b));
            const pairH = Math.sqrt(he(t,a+1,r) * he(b,a+1,r));
            const evidence = .47*Math.sqrt(pairV*pairH) + .265*(pairV+pairH);
            const innerArea = (rw-3)*(rh-3);
            const interior = areaSum(ts,a+2,t+2,r-1,b-1) / innerArea;
            const alike = areaSum(same,a+2,t+2,r-1,b-1) / innerArea;
            const spread = Math.sqrt(Math.max(0, areaSum(squared,a+2,t+2,r-1,b-1)/innerArea - interior*interior));
            const outside = (areaSum(ts,a-1,t-1,r+2,b+2) - areaSum(ts,a+1,t+1,r,b))
              / ((rw+3)*(rh+3)-(rw-1)*(rh-1));
            if (alike < .34 || (spread > 28 && alike < .60)) continue;
            if (avg < Math.max(84,peak*.48) && (alike < .70 || spread > 17 || evidence < 13)) continue;
            const score = (evidence*(.56+.44*prior) + Math.min(2,Math.abs(outside-interior)*.065))
              * (.52+.48*alike) * (.56+.44*Math.min(1,avg/160)) * sizeWeight / (1+Math.max(0,spread-12)*.012);
            if (!best || score > best.score) {
              best = {a,t,r,b,rw,rh,x:(a+r)/2,y:(t+b)/2,score,evidence,avg,alike,spread};
            }
          }
          if (best && best.evidence > 6.5 && best.score > 5.8) candidates.push(best);
        }
      }
      return candidates.sort((p,q)=>q.score-p.score);
    }
    const cellSize=Math.max(12,Math.ceil(2.3/metres));
    function key(x,y){return y*(Math.ceil(w/cellSize)+2)+x;}
    function select(candidates) {
      const chosen = [], cells = new Map();
      for (const candidate of candidates) {
        const gx = Math.floor(candidate.x/cellSize), gy = Math.floor(candidate.y/cellSize);
        let collision = false;
        for (let yy = Math.max(0,gy-1); yy <= gy+1 && !collision; yy++) {
          for (let xx = Math.max(0,gx-1); xx <= gx+1 && !collision; xx++) {
            for (const old of cells.get(key(xx,yy)) || []) {
              const ix = Math.max(0, Math.min(candidate.r,old.r) - Math.max(candidate.a,old.a));
              const iy = Math.max(0, Math.min(candidate.b,old.b) - Math.max(candidate.t,old.t));
              if (ix*iy > .16*Math.min(candidate.rw*candidate.rh, old.rw*old.rh)) {
                collision = true;
                break;
              }
            }
          }
        }
        if (collision) continue;
        const cell = key(gx,gy);
        if (!cells.has(cell)) cells.set(cell,[]);
        cells.get(cell).push(candidate);
        chosen.push(candidate);
      }
      return {chosen, cells};
    }
    let {chosen, cells} = select(proposals());
    if (!chosen.length) return;
    const initialStandard = chosen[Math.floor(chosen.length * .28)].score;
    const confident = chosen.filter(box => box.score >= .63 * initialStandard && box.alike >= .57 && box.avg >= 91);
    if (confident.length >= 4) {
      const areas = confident.map(box => box.rw * box.rh).sort((a,b) => a-b);
      const median = areas[Math.floor(areas.length / 2)];
      const middleHalf = areas[Math.floor(areas.length * .75)] / areas[Math.floor(areas.length * .25)];
      if (middleHalf < 1.5) {
        ({chosen, cells} = select(proposals(median)));
      }
    }
    const direction = confident.reduce((sum,box) => sum + (box.rw > box.rh ? 1 : -1), 0);
    const commonDirection = confident.length >= 4 && Math.abs(direction) >= .56 * confident.length ? Math.sign(direction) : 0;
    const localStandard=chosen.length ? chosen[Math.floor(chosen.length*.28)].score : 0;
    for(const box of chosen) {
      if(box.score<localStandard*.38)continue;
      const orientation = box.rw > box.rh ? 1 : -1;
      if(commonDirection && commonDirection!==orientation && box.alike<.59 && box.score<localStandard*.68)continue;
      const gx=Math.floor(box.x/cellSize),gy=Math.floor(box.y/cellSize);
      let supported=false;
      for(let yy=Math.max(0,gy-3);yy<=Math.min(Math.ceil(h/cellSize),gy+3)&&!supported;yy++){
        for(let xx=Math.max(0,gx-3);xx<=Math.min(Math.ceil(w/cellSize),gx+3)&&!supported;xx++){
          supported=(cells.get(key(xx,yy))||[]).some(other=>other!==box && other.avg>70 &&
            Math.abs(other.x-box.x)<3*Math.max(other.rw,box.rw) && Math.abs(other.y-box.y)<3*Math.max(other.rh,box.rh) &&
            (Math.abs(other.x-box.x)<.31*Math.max(other.rw,box.rw)||Math.abs(other.y-box.y)<.31*Math.max(other.rh,box.rh)));
        }
      }
      if(!supported && (box.avg<125 || box.alike<.58 || box.evidence<11))continue;
      if(box.avg<Math.max(98,peak*.50) && (box.alike<.69 || box.spread>19 || box.evidence<12))continue;
      const cy=(box.t+box.b)/2,cx=(box.a+box.r)/2;
      const px=(u0+cx)*c-(v0+cy)*s,py=(u0+cx)*s+(v0+cy)*c;
      if(px<bounds[0]||py<bounds[1]||px>=bounds[2]||py>=bounds[3]) continue;
      const inset=.32;
      const pts=[[box.a+inset,box.t+inset],[box.r-inset,box.t+inset],
                 [box.r-inset,box.b-inset],[box.a+inset,box.b-inset]].map(([x,y])=>[
                   +(c*(u0+x)-s*(v0+y)).toFixed(2),+(s*(u0+x)+c*(v0+y)).toFixed(2)]);
      result.push({center:[px,py],points:pts,score:box.score});
    }
  }
  for(let p=0;p<probability.length;p++){
    if(labels[p]||probability[p]<regionThreshold)continue;
    ++id;
    let tail=1,peak=0;queue[0]=p;labels[p]=id;
    for(let head=0;head<tail;head++){
      const m=queue[head],x=m%mw,y=Math.floor(m/mw);peak=Math.max(peak,probability[m]);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;
        if(xx<0||xx>=mw||yy<0||yy>=mh)continue;
        const k=yy*mw+xx;
        if(!labels[k]&&probability[k]>=regionThreshold){labels[k]=id;queue[tail++]=k;}
      }
    }
    examine(queue,tail,peak);
  }
  return result.sort((p,q)=>p.center[0]-q.center[0]||p.center[1]-q.center[1]);
}
if (typeof module !== "undefined" && module.exports) module.exports = zoekPaneelvormen;

