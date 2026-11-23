// PDOK returns the current BGT polygons in Web Mercator metres.
const topografie = (() => {
  const base="https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/";
  const crs="http://www.opengis.net/def/crs/EPSG/0/3857";
  const half=20037508.342789244, worldSize=2**29, resolution=2*half/worldSize;
  const cache=[];
  const xy=p=>[p[0]*resolution-half,half-p[1]*resolution];
  function shapes(features) {
    const out=[];
    for(const feature of features) {
      const geom=feature.geometry;
      if(!geom || !["Polygon","MultiPolygon"].includes(geom.type))continue;
      for(const rings of geom.type==="Polygon" ? [geom.coordinates] : geom.coordinates) {
        if(!rings[0]?.length)continue;
        let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
        for(const [x,y] of rings[0]) {
          west=Math.min(west,x); east=Math.max(east,x); south=Math.min(south,y); north=Math.max(north,y);
        }
        out.push({west,south,east,north,rings});
      }
    }
    return out;
  }
  function inRing(x,y,ring) {
    let inside=false, a=ring[ring.length-1];
    for(const b of ring) {
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
      a=b;
    }
    return inside;
  }
  function nearRing(x,y,ring,radius) {
    let a=ring[ring.length-1];
    for(const b of ring) {
      const dx=b[0]-a[0], dy=b[1]-a[1], length=dx*dx+dy*dy;
      const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length)):0;
      if((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2<=radius*radius)return true;
      a=b;
    }
    return false;
  }
  function covers(layer,x,y,radius=0) {
    return layer.some(p=>{
      if(x<p.west-radius||x>p.east+radius||y<p.south-radius||y>p.north+radius)return false;
      if(inRing(x,y,p.rings[0]) && !p.rings.slice(1).some(r=>inRing(x,y,r)))return true;
      return radius>0 && p.rings.some(r=>nearRing(x,y,r,radius));
    });
  }
  async function layer(name,params,signal) {
    const first=new URL(base+name+"/items");
    first.search=new URLSearchParams(params);
    const timeout=new AbortController(), cancel=()=>timeout.abort();
    const deadline=setTimeout(cancel,14000);
    signal.addEventListener("abort",cancel,{once:true});
    if(signal.aborted)cancel();
    try{
      const collected=[],visited=new Set();
      let url=first;
      while(url) {
        if(url.origin!==first.origin || url.pathname!==first.pathname || visited.has(url.href))return null;
        visited.add(url.href);
        const response=await fetch(url,{signal:timeout.signal,credentials:"omit",headers:{Accept:"application/geo+json"}});
        if(!response.ok)return null;
        const page=await response.json();
        if(!Array.isArray(page.features))return null;
        collected.push(...shapes(page.features));
        const next=page.links?.find(link=>link.rel==="next");
        url=next?new URL(next.href,url):null;
      }
      return collected;
    }catch{return null;}
    finally{clearTimeout(deadline);signal.removeEventListener("abort",cancel);}
  }
  async function load(bounds,signal) {
    const now=new Date(), day=now.toISOString().slice(0,10);
    const saved=cache.find(e=>e.day===day && bounds[0]>=e.area[0] && bounds[1]>=e.area[1] &&
      bounds[2]<=e.area[2] && bounds[3]<=e.area[3]);
    if(saved)return saved.data;
    const area=[Math.floor((bounds[0]-80)/256)*256,Math.floor((bounds[1]-80)/256)*256,
      Math.ceil((bounds[2]+80)/256)*256,Math.ceil((bounds[3]+80)/256)*256];
    const sw=xy([area[0],area[3]]), ne=xy([area[2],area[1]]);
    const common={f:"json",bbox:sw.concat(ne).map(n=>n.toFixed(3)).join(","),"bbox-crs":crs,crs,
      datetime:now.toISOString(),limit:"1000"};
    const [roads,buildings,canopies]=await Promise.all([
      layer("wegdeel",{...common,filter:"functie LIKE 'rijbaan%'",relatieve_hoogteligging:"0"},signal),
      layer("pand",common,signal),
      layer("overigbouwwerk",{...common,filter:"type IN ('overkapping','open loods')"},signal)
    ]);
    const data={roads,buildings,canopies};
    if(roads && buildings && canopies && !signal.aborted) {
      cache.push({area,day,data});
      if(cache.length>10)cache.shift();
    }
    return data;
  }
  function retain(box,data) {
    const [x,y]=xy(box.center);
    // The photo shows sloping roof edges, the register maps building footprints.
    const margin=(box.roofOnly ? .35 : 1.35)*Math.cosh(y/6378137);
    const roof=data.buildings && covers(data.buildings,x,y,margin);
    const canopy=data.canopies && covers(data.canopies,x,y,margin);
    if(roof || canopy)return true;
    if(data.roads && data.buildings && data.canopies && covers(data.roads,x,y))return false;
    return !box.roofOnly;
  }
  return {load,retain,shapes};
})();
if(typeof module!=="undefined" && module.exports) module.exports=topografie;
