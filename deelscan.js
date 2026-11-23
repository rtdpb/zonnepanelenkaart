// Coordinates are global Web Mercator pixels at the last native PDOK WMTS level.
const deelscan = (() => {
  const zoom = 21;
  const core = 768, margin = 128, size = core + 2*margin;
  const overlap = 40;
  const sampleStep = 12;

  function plan(bounds) {
    const gx = Math.floor(bounds[0]/core), gy = Math.floor(bounds[1]/core);
    const nx = Math.ceil(bounds[2]/core)-gx, ny = Math.ceil(bounds[3]/core)-gy;
    return {gx,gy,nx,ny,count:nx*ny};
  }

  function* blocks(plan) {
    for (let x = plan.gx; x < plan.gx+plan.nx; x++) {
      for (let y = plan.gy; y < plan.gy+plan.ny; y++) {
        yield {key:x+","+y, left:x*core-margin, top:y*core-margin};
      }
    }
  }

  function coverage(pixels) {
    const n = core/sampleStep, mask = new Uint8Array(n*n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = margin + sampleStep*x + sampleStep/2, row = margin + sampleStep*y + sampleStep/2;
      const i = 4*(row*size+col);
      mask[y*n+x] = pixels[i]<249 || pixels[i+1]<249 || pixels[i+2]<249 ? 1 : 0;
    }
    return mask;
  }

  function visibleCoverage(block, mask, bounds) {
    const n=core/sampleStep, x0=block.left+margin, y0=block.top+margin;
    const x1=Math.max(0,Math.floor((bounds[0]-x0)/sampleStep)), y1=Math.max(0,Math.floor((bounds[1]-y0)/sampleStep));
    const x2=Math.min(n,Math.ceil((bounds[2]-x0)/sampleStep)), y2=Math.min(n,Math.ceil((bounds[3]-y0)/sampleStep));
    let valid=0, total=0;
    for (let y=y1;y<y2;y++) for (let x=x1;x<x2;x++) { valid+=mask[y*n+x]; total++; }
    return {valid,total};
  }

  function locate(box, block) {
    const world = p => [p[0]+block.left,p[1]+block.top];
    const [x,y] = box.center;
    const edge = Math.min(x,y,size-x,size-y);
    return {center:world(box.center), points:box.points.map(world), ...(box.roofOnly && {roofOnly:true}),
      score:box.score*(.85+.15*Math.min(1,edge/(margin+overlap)))};
  }

  // Clip convex quadrilaterals. All areas use coordinate differences: global
  // pixel coordinates here are large compared with the area of a single panel.
  function side(a,b,p) { return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]); }
  function area(poly) {
    let sum=0;
    for (let i=2;i<poly.length;i++) sum+=side(poly[0],poly[i-1],poly[i]);
    return Math.abs(sum)/2;
  }
  function sharedArea(first,second) {
    let poly=first;
    for (let i=0;i<4 && poly.length;i++) {
      const a=second[i], b=second[(i+1)%4], next=[];
      let prev=poly[poly.length-1], ds=side(a,b,prev);
      for (const p of poly) {
        const de=side(a,b,p);
        if ((ds>=0)!==(de>=0)) {
          const t=ds/(ds-de);
          next.push([prev[0]+t*(p[0]-prev[0]),prev[1]+t*(p[1]-prev[1])]);
        }
        if (de>=0) next.push(p);
        prev=p; ds=de;
      }
      poly=next;
    }
    return area(poly);
  }
  function merge(boxes) {
    const cells=new Map(), kept=[], bin=64;
    for (const box of boxes.slice().sort((a,b)=>b.score-a.score)) {
      const [x,y]=box.center, gx=Math.floor(x/bin), gy=Math.floor(y/bin);
      const surface=area(box.points);
      let duplicate=false, alreadyCovered=0;
      for (let yy=gy-1;yy<=gy+1 && !duplicate;yy++) {
        for (let xx=gx-1;xx<=gx+1 && !duplicate;xx++) {
          for (const old of cells.get(xx+","+yy)||[]) {
            const intersection=sharedArea(box.points,old.points);
            alreadyCovered+=intersection;
            if (intersection>.46*Math.min(surface,old.surface) || alreadyCovered>.66*surface) { duplicate=true; break; }
          }
        }
      }
      if (duplicate) continue;
      const key=gx+","+gy;
      if (!cells.has(key)) cells.set(key,[]);
      cells.get(key).push({points:box.points,surface});
      kept.push(box);
    }
    return kept.sort((a,b)=>a.center[0]-b.center[0] || a.center[1]-b.center[1]);
  }

  return {zoom,core,margin,size,overlap,plan,blocks,coverage,visibleCoverage,locate,merge};
})();
if (typeof module!=="undefined" && module.exports) module.exports=deelscan;
