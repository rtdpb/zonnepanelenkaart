// Reviewed outlines are tied to the original JPEGs. A newer aerial survey
// automatically falls back to the detector until the roof has been reviewed again.
function maakDakcontrole(data) {
  const matches=new Set(), checked=new Set();
  const extent=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),
    Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  const overlaps=(a,b)=>a[0]<b[2] && a[2]>b[0] && a[1]<b[3] && a[3]>b[1];
  const inside=(p,v)=>p[0]>=v[0] && p[1]>=v[1] && p[0]<v[2] && p[1]<v[3];
  function contains(points,[x,y]) {
    let hit=false, a=points[points.length-1];
    for(const b of points) {
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
      a=b;
    }
    return hit;
  }
  function tilesFor(bounds) {
    const keys=[];
    for(let x=Math.floor(bounds[0]/256);x<Math.ceil(bounds[2]/256);x++)
      for(let y=Math.floor(bounds[1]/256);y<Math.ceil(bounds[3]/256);y++)keys.push("21/"+x+"/"+y);
    return keys;
  }
  const fields=data.fields.map(field=>{
    const unpack=coords=>{
      const points=[];
      for(let i=0;i<coords.length;i+=2)points.push([field.origin[0]+coords[i],field.origin[1]+coords[i+1]]);
      return points;
    };
    const points=unpack(field.outline), bounds=extent(points);
    function boxes(coords,estimated) {
      return coords.map(row=>{
        const p=unpack(row), center=p.reduce((a,b)=>[a[0]+b[0]/4,a[1]+b[1]/4],[0,0]);
        // merge() clips against counter-clockwise quadrilaterals in image coordinates.
        if((p[1][0]-p[0][0])*(p[2][1]-p[0][1])<(p[1][1]-p[0][1])*(p[2][0]-p[0][0]))p.reverse();
        return {center,points:p,estimated,score:estimated?350:400};
      });
    }
    return {points,bounds,keys:tilesFor(bounds),unresolved:field.unresolved===true,
      panels:boxes(field.confirmed||[],false).concat(boxes(field.estimated||[],true))};
  });
  async function recordTile(key,blob) {
    if(!data.tiles[key] || !globalThis.crypto?.subtle)return;
    try {
      const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
      const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      if(hex===data.tiles[key])matches.add(key);else matches.delete(key);
      checked.add(key);
    } catch {matches.delete(key);}
  }
  // A tiny viewport can show one end of an array whose last tile lies outside
  // the scan block. Check that tile as well before using the reviewed layout.
  function missing(bounds) {
    if(!globalThis.crypto?.subtle)return [];
    return [...new Set(fields.filter(f=>overlaps(f.bounds,bounds)).flatMap(f=>f.keys))]
      .filter(key=>data.tiles[key] && !checked.has(key));
  }
  function apply(detected,bounds) {
    const active=fields.filter(f=>overlaps(f.bounds,bounds) && f.keys.every(key=>matches.has(key)));
    if(!active.length)return {panels:detected,unresolved:[]};
    const panels=detected.filter(box=>!active.some(f=>inside(box.center,f.bounds) && contains(f.points,box.center)));
    for(const field of active)for(const panel of field.panels)if(inside(panel.center,bounds))panels.push(panel);
    return {panels,unresolved:active.filter(f=>f.unresolved)};
  }
  function visibleFields(fields,bounds) {
    return fields.filter(f=>{
      if(!overlaps(f.bounds,bounds))return false;
      if(f.points.some(p=>inside(p,bounds)))return true;
      const [w,n,e,s]=bounds, corners=[[w,n],[e,n],[e,s],[w,s]];
      if(corners.some(p=>contains(f.points,p)))return true;
      let a=f.points[f.points.length-1];
      for(const b of f.points){
        for(const x of [w,e])if((a[0]<x)!==(b[0]<x)){
          const y=a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0]);
          if(y>=n && y<s)return true;
        }
        for(const y of [n,s])if((a[1]<y)!==(b[1]<y)){
          const x=a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]);
          if(x>=w && x<e)return true;
        }
        a=b;
      }
      return false;
    });
  }
  return {recordTile,missing,apply,visibleFields};
}
if(typeof module!=="undefined" && module.exports)module.exports=maakDakcontrole;
