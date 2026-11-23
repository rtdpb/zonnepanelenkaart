(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const dataZoom=20, core=208, halo=24, limit=42;
  const country=L.latLngBounds([[50.74,3.3],[53.57,7.24]]);
  const coverage=L.latLngBounds([[50.68,3.01],[53.67,7.37]]);
  const map=L.map("map",{zoomControl:false,attributionControl:false,minZoom:6,maxZoom:24,zoomSnap:.25,zoomDelta:1,
    zoomAnimation:false,markerZoomAnimation:false,preferCanvas:true,maxBounds:[[49.8,1.2],[54.6,9.1]],maxBoundsViscosity:.85});
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  const credit=L.control.attribution({prefix:false,position:"bottomright"}).addTo(map);
  credit.addAttribution('Luchtfoto © <a href="https://www.beeldmateriaal.nl/" target="_blank" rel="noreferrer">Samenwerkingsverband Beeldmateriaal</a> / PDOK · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY</a>');
  L.control.scale({position:"bottomleft",metric:true,imperial:false,maxWidth:95}).addTo(map);
  function merc(x,y){return L.CRS.EPSG3857.unproject(L.point(x,y));}
  const overview=L.imageOverlay("overzicht.webp",[merc(-550000,5890000),merc(1650000,7880000)],{
    interactive:false,alt:"Landelijke luchtfoto met satellietbeeld van de omgeving",attribution:"NASA Earth Observatory / GIBS"
  });
  const tileUrl=(z,x,y)=>"https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/"+String(z).padStart(2,"0")+"/"+x+"/"+y+".jpeg";
  const Aerial=L.TileLayer.extend({
    getTileUrl(c){return tileUrl(c.z,c.x,c.y);},
    createTile(c,done){
      if(c.z>=14)return L.TileLayer.prototype.createTile.call(this,c,done);
      const tile=document.createElement("canvas");tile.width=tile.height=256;
      const pic=new Image();pic.crossOrigin="anonymous";
      pic.onload=()=>{
        try{
          const ctx=tile.getContext("2d",{willReadFrequently:true});ctx.drawImage(pic,0,0);
          const img=ctx.getImageData(0,0,256,256),d=img.data;
          for(let p=0;p<d.length;p+=4)if(d[p]>249 && d[p+1]>249 && d[p+2]>249)d[p+3]=0;
          ctx.putImageData(img,0,0);done(null,tile);
        }catch(err){done(err,tile);}
      };
      pic.onerror=()=>done(new Error("Luchtfoto niet geladen"),tile);
      pic.src=this.getTileUrl(c);return tile;
    }
  });
  const aerial=new Aerial("",{minZoom:9,maxZoom:24,maxNativeZoom:21,bounds:coverage,noWrap:true,crossOrigin:"anonymous",
    updateWhenIdle:true,keepBuffer:1});
  let mapErrors=0,mapLoaded=0;
  aerial.on("loading",()=>{mapErrors=0;mapLoaded=0;});
  aerial.on("tileerror",()=>{mapErrors++;});
  aerial.on("tileload",()=>{mapLoaded++;});
  aerial.on("load",()=>{$("tileAlert").hidden=!(mapErrors && (!mapLoaded || mapErrors>1));});
  $("retryTiles").onclick=()=>{$("tileAlert").hidden=true;aerial.redraw();};
  const labels=L.layerGroup();
  for(const [name,lat,lng,kind] of [
    ["Amsterdam",52.372,4.90],["Rotterdam",51.921,4.48],["Den Haag",52.07,4.3],["Utrecht",52.09,5.12],
    ["Groningen",53.219,6.567],["Leeuwarden",53.202,5.80],["Zwolle",52.51,6.09],["Arnhem",51.985,5.9],
    ["Eindhoven",51.44,5.48],["Maastricht",50.85,5.69],["Middelburg",51.50,3.61],
    ["Noordzee",52.81,3.5,"sea"],["BELGIË",50.97,3.9,"land"],["DUITSLAND",52.13,7.63,"land"]
  ]){
    const el=document.createElement("div");if(!kind)el.append(document.createElement("span"));el.append(document.createTextNode(name));
    L.marker([lat,lng],{interactive:false,keyboard:false,icon:L.divIcon({className:kind?"geo-name "+kind:"place-name",
      html:el.innerHTML,iconSize:[1,1],iconAnchor:[2,6]})}).addTo(labels);
  }
  function layerState(){
    const z=map.getZoom();
    for(const [layer,visible] of [[overview,z<13],[aerial,z>=8.75],[labels,z<10.5]]){
      if(visible&&!map.hasLayer(layer))map.addLayer(layer); else if(!visible&&map.hasLayer(layer))map.removeLayer(layer);
    }
    if(z<9)$("tileAlert").hidden=true;
  }
  function home(){map.fitBounds(country,{padding:[24,24],maxZoom:8,animate:false});}
  home();layerState();
  $("home").onclick=home;$("zoomIn").onclick=()=>map.zoomIn();$("zoomOut").onclick=()=>map.zoomOut();
  const paper=document.createElement("canvas");paper.id="vakjes";paper.setAttribute("aria-hidden","true");
  Object.assign(paper.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:425,pointerEvents:"none"});
  document.querySelector(".map-shell").append(paper);
  const view=()=>{
    const size=map.getSize(),a=map.project(map.containerPointToLatLng([0,0]),dataZoom);
    const b=map.project(map.containerPointToLatLng(size),dataZoom);
    return [a.x,a.y,b.x,b.y];
  };
  function plan(v){
    const stride=2*core,padding=32;
    const gx=Math.floor((v[0]-padding)/stride),gy=Math.floor((v[1]-padding)/stride);
    const nx=Math.ceil((v[2]+padding)/stride)-gx,ny=Math.ceil((v[3]+padding)/stride)-gy;
    return {gridX:gx,gridY:gy,nx,ny,left:gx*stride-2*halo,top:gy*stride-2*halo,
      width:nx*stride+4*halo,height:ny*stride+4*halo};
  }
  const covered=(outer,inner)=>outer&&inner[0]>=outer[0]-.06&&inner[1]>=outer[1]-.06&&inner[2]<=outer[2]+.06&&inner[3]<=outer[3]+.06;
  const inView=(q,v)=>q[0]>=v[0]&&q[1]>=v[1]&&q[0]<v[2]&&q[1]<v[3];
  function contains(shape,x,y){
    let hit=false;
    for(let i=0,j=shape.length-1;i<shape.length;j=i++){
      const a=shape[i],b=shape[j];
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }
    return hit;
  }
  let job=null,serial=0,last=null,visible=[],animation=null,frameId=0;
  let edit="",corners=[],editsAdded=[],editsRemoved=[],lastError="";
  const tileCache=new Map();
  function showTotal(n){$("total").value=n==null?"—":n.toLocaleString("nl-NL");$("unit").textContent=n===1?"paneel":"panelen";}
  function finishEdit(){
    edit="";corners=[];$("tools").hidden=true;
    document.querySelector(".map-shell").classList.remove("editing");
  }
  function stopAnimation(){if(animation)cancelAnimationFrame(animation.frame);animation=null;}
  function drawing(){
    const size=map.getSize(),dpr=Math.min(devicePixelRatio||1,2),ctx=paper.getContext("2d");
    const pw=Math.round(size.x*dpr),ph=Math.round(size.y*dpr);
    if(paper.width!==pw||paper.height!==ph){paper.width=pw;paper.height=ph;}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size.x,size.y);
    const v=view(),scale=map.getZoomScale(map.getZoom(),dataZoom);
    const screen=point=>[(point[0]-v[0])*scale,(point[1]-v[1])*scale];
    function outline(path,pts){
      pts.forEach((q,i)=>{const [x,y]=screen(q);if(i)path.lineTo(x,y);else path.moveTo(x,y);});path.closePath();
    }
    if(!job&&covered(last?.bounds,v)){
      const n=animation?animation.n:visible.length,path=new Path2D(),hot=new Path2D();
      for(let i=0;i<n;i++)outline(animation&&i===n-1?hot:path,visible[i].points);
      ctx.lineJoin="round";ctx.fillStyle="rgba(69,250,184,.10)";ctx.fill(path);
      ctx.strokeStyle="rgba(11,42,29,.95)";ctx.lineWidth=3.0;ctx.stroke(path);
      ctx.strokeStyle="#71ffbd";ctx.lineWidth=1.65;ctx.stroke(path);
      if(animation){ctx.fillStyle="rgba(255,199,69,.21)";ctx.fill(hot);ctx.strokeStyle="#4d3916";ctx.lineWidth=3.9;ctx.stroke(hot);ctx.strokeStyle="#ffcd60";ctx.lineWidth=2.4;ctx.stroke(hot);}
    }
    if(corners.length){
      ctx.beginPath();corners.forEach((p,i)=>{const [x,y]=screen(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
      ctx.strokeStyle="#ffd266";ctx.lineWidth=2;ctx.stroke();
      for(const p of corners){const [x,y]=screen(p);ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle="#ffd266";ctx.fill();}
    }
  }
  function requestDrawing(){if(!frameId)frameId=requestAnimationFrame(()=>{frameId=0;drawing();});}
  function currentResults(v){
    if(!covered(last?.bounds,v))return [];
    const automatic=last.panels.filter(p=>inView(p.center,v)&&!editsRemoved.some(q=>contains(q,...p.center))&&!editsAdded.some(q=>contains(q.points,...p.center)));
    return automatic.concat(editsAdded.filter(p=>inView(p.center,v))).sort((a,b)=>a.center[0]-b.center[0]||a.center[1]-b.center[1]);
  }
  function updateUI(){
    const v=view(),z=map.getZoom(),p=plan(v);
    const ready=z>=18.99 && p.nx*p.ny<=limit;
    const seen=covered(last?.bounds,v);
    const count=$("count");
    count.querySelector("span").textContent=job?"Annuleren":"Tel panelen hier";
    count.classList.toggle("busy",!!job);count.disabled=!job&&!ready;
    $("example").hidden=!!job||seen||z>=18.99;
    $("correct").hidden=!!job||!seen||!!edit||!!animation;
    $("progress").hidden=!job;
    $("zoomIn").disabled=z>=map.getMaxZoom();$("zoomOut").disabled=z<=map.getMinZoom();
    const center=map.getCenter();$("coords").textContent=center.lat.toFixed(5)+"° N   "+center.lng.toFixed(5)+"° E";
    if(!job){
      visible=currentResults(v);showTotal(seen?(animation?animation.n:visible.length):null);
      if(!seen&&edit)finishEdit();
      let msg=lastError;
      if(!msg&&seen){
        if(animation)msg="De vakjes verschijnen van links naar rechts.";
        else if(last.partial)msg="Schatting voor het deel met luchtfotodekking.";
        else if(!visible.length)msg="Geen panelen herkend in dit kaartbeeld.";
        else msg="Schatting voor dit kaartbeeld. Controleer de groene vakjes.";
      }
      if(!msg)msg=!ready?(z<15?"Zoom in op een straat of zoek een adres.":"Zoom verder in om afzonderlijke panelen te tellen."):"Druk op de knop om de daken in dit kaartbeeld te tellen.";
      $("status").textContent=msg;
    }
    requestDrawing();
  }
  function stopJob(){
    if(!job)return;
    const old=job;job=null;old.ctrl.abort();paneelRekenkern.cancel(old.id);old.detach?.();
  }
  function startMotion(){
    lastError="";stopJob();stopAnimation();finishEdit();
    $("tileAlert").hidden=true;
    visible=[];showTotal(null);requestDrawing();
  }
  map.on("movestart",startMotion);
  map.on("move",requestDrawing);
  map.on("moveend zoomend resize",()=>{layerState();updateUI();});
  new ResizeObserver(()=>map.invalidateSize({pan:false,debounceMoveend:true})).observe($("map"));

  async function tileBitmap(z,x,y,signal){
    const key=z+"/"+x+"/"+y;
    if(tileCache.has(key))return tileCache.get(key);
    const a=map.unproject([x*256,(y+1)*256],z),b=map.unproject([(x+1)*256,y*256],z);
    if(!coverage.intersects(L.latLngBounds(a,b)))return null;
    for(let attempt=0;attempt<2;attempt++){
      const timer=new AbortController(),abort=()=>timer.abort();signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)timer.abort();
      const deadline=setTimeout(abort,18000);
      try{
        const r=await fetch(tileUrl(z,x,y),{signal:timer.signal,credentials:"omit"});
        if(!r.ok)throw new Error("PDOK antwoordde met "+r.status+".");
        const blob=await r.blob();
        const bmp=await createImageBitmap(blob);
        if(signal.aborted){bmp.close();throw new DOMException("Afgebroken","AbortError");}
        tileCache.set(key,bmp);
        if(tileCache.size>150){const first=tileCache.keys().next().value;tileCache.get(first).close();tileCache.delete(first);}
        return bmp;
      }catch(e){
        if(signal.aborted)throw e;
        if(attempt===1)throw new Error("De luchtfoto kon niet volledig worden geladen. Controleer je internetverbinding en probeer opnieuw.");
      }finally{clearTimeout(deadline);signal.removeEventListener("abort",abort);}
    }
  }
  async function snapshot(p,v,j){
    const canvas=document.createElement("canvas");canvas.width=p.width;canvas.height=p.height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.fillStyle="white";ctx.fillRect(0,0,p.width,p.height);
    const tiles=[];
    for(let y=Math.floor(p.top/256);y<Math.ceil((p.top+p.height)/256);y++)for(let x=Math.floor(p.left/256);x<Math.ceil((p.left+p.width)/256);x++)tiles.push([x,y]);
    let pos=0,done=0;
    await Promise.all(Array.from({length:Math.min(7,tiles.length)},async()=>{
      while(pos<tiles.length){
        const [x,y]=tiles[pos++];const bmp=await tileBitmap(dataZoom,x,y,j.ctrl.signal);
        if(job!==j)throw new DOMException("Afgebroken","AbortError");
        if(bmp)ctx.drawImage(bmp,x*256-p.left,y*256-p.top);
        $("progress").value=.16*(++done/tiles.length);
      }
    }));
    const rgba=ctx.getImageData(0,0,p.width,p.height).data;
    const bounds=[v[0]-p.left,v[1]-p.top,v[2]-p.left,v[3]-p.top];
    let empty=0,total=0;
    for(let y=Math.max(0,Math.floor(bounds[1]));y<bounds[3];y+=4)for(let x=Math.max(0,Math.floor(bounds[0]));x<bounds[2];x+=4){
      const i=(y*p.width+x)*4;total++;
      if(rgba[i]>=249&&rgba[i+1]>=249&&rgba[i+2]>=249)empty++;
    }
    if(!total || empty/total>.993)throw new Error("PDOK heeft hier geen bruikbare luchtfoto. Kies een plek binnen Nederland.");
    return {raw:rgba.buffer,bounds,partial:empty/total>.04};
  }

  function animateResult(){
    if(reduced.matches||!visible.length){updateUI();return;}
    const n=visible.length,duration=Math.min(2200,Math.max(300,n*28));
    const a={n:0,frame:0},start=performance.now();animation=a;
    updateUI();
    const step=now=>{
      if(animation!==a)return;
      a.n=Math.min(n,Math.floor(n*(now-start)/duration));
      showTotal(a.n);drawing();
      if(a.n<n)a.frame=requestAnimationFrame(step);
      else {animation=null;updateUI();}
    };
    a.frame=requestAnimationFrame(step);
  }
  async function countHere(){
    if(job){stopJob();lastError="Telling geannuleerd.";updateUI();return;}
    const v=view(),p=plan(v);
    if(map.getZoom()<18.99||p.nx*p.ny>limit)return;
    lastError="";stopAnimation();finishEdit();
    const j={id:++serial,ctrl:new AbortController()};job=j;visible=[];
    showTotal(null);updateUI();$("progress").value=0;$("status").textContent="Luchtfoto voor dit kaartbeeld ophalen…";
    try{
      const snap=await snapshot(p,v,j);if(job!==j)return;
      $("status").textContent="Paneelherkenner starten…";
      const engine=await paneelRekenkern.ready();if(job!==j)return;
      const metres=156543.03392804097*Math.cos(map.getCenter().lat*Math.PI/180)/2**dataZoom;
      const message=e=>{
        const m=e.data;
        if(m.id!==j.id||job!==j)return;
        if(m.kind==="progress"){
          $("progress").value=.17+.76*m.done/m.total;
          $("status").textContent="Daken analyseren… "+Math.round(100*m.done/m.total)+"%";
        } else if(m.kind==="refine"){
          $("progress").value=.95;$("status").textContent="Paneelranden op de luchtfoto bepalen…";
        } else if(m.kind==="error"){fail(new Error("De beeldherkenning is onderbroken. Probeer opnieuw of zoom een stap verder in."));}
        else if(m.kind==="result"){
          j.detach();job=null;
          last={bounds:v,partial:snap.partial,panels:m.panels.map(box=>({
            center:[box.center[0]+p.left,box.center[1]+p.top],
            points:box.points.map(q=>[q[0]+p.left,q[1]+p.top])
          }))};
          visible=currentResults(v);animateResult();
        }
      };
      const failure=()=>{paneelRekenkern.reset();fail(new Error("De herkenner is gestopt. Zoom een stap in en probeer opnieuw."));};
      const fail=err=>{if(job!==j)return;stopJob();lastError=err.message;updateUI();};
      j.detach=()=>{engine.removeEventListener("message",message);engine.removeEventListener("error",failure);};
      engine.addEventListener("message",message);engine.addEventListener("error",failure);
      $("status").textContent="Daken analyseren…";$("progress").value=.17;
      engine.postMessage({kind:"run",id:j.id,width:p.width,height:p.height,nx:p.nx,ny:p.ny,gridX:p.gridX,gridY:p.gridY,
        bounds:snap.bounds,raw:snap.raw,metres},[snap.raw]);
    }catch(err){
      if(job!==j)return;
      stopJob();lastError=err.message||"De telling is mislukt. Probeer opnieuw.";updateUI();
    }
  }
  $("count").onclick=countHere;
  $("example").onclick=()=>{
    $("search").value="Voorbeelddak, Den Haag";closeSearch();
    map.fitBounds([merc(475960.6,6814224.6),merc(475984.4,6814250.2)],{padding:[15,15],maxZoom:22.5,animate:false});
  };
  function editMode(mode){
    if(!last)return;
    edit=mode;corners=[];
    $("tools").hidden=false;$("correct").hidden=true;
    $("add").classList.toggle("active",mode==="add");$("remove").classList.toggle("active",mode==="remove");
    document.querySelector(".map-shell").classList.add("editing");
    $("editHint").textContent=mode==="add"?"Klik op de twee uiteinden van één paneelrand en daarna op de overliggende rand.":"Klik op het vakje dat je wilt verwijderen.";
    requestDrawing();
  }
  $("correct").onclick=()=>editMode("remove");$("add").onclick=()=>editMode("add");$("remove").onclick=()=>editMode("remove");
  $("finish").onclick=()=>{finishEdit();updateUI();};
  map.on("click",e=>{
    if(!edit)return;
    const loc=map.project(e.latlng,dataZoom),pt=[loc.x,loc.y];
    if(edit==="remove"){
      const p=visible.find(q=>contains(q.points,...pt));if(!p)return;
      if(editsAdded.includes(p))editsAdded=editsAdded.filter(q=>q!==p);
      editsRemoved.push(p.points);$("editHint").textContent="Vakje verwijderd. Klik op een volgend vakje of kies Klaar.";
    } else {
      corners.push(pt);
      if(corners.length<3){
        $("editHint").textContent=corners.length===1?"Klik op het andere uiteinde van dezelfde rand.":"Klik op de tegenoverliggende rand om de breedte vast te leggen.";
        requestDrawing();return;
      }
      const [a,b,d]=corners;corners=[];
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      const offset=((-dy)*(d[0]-a[0])+dx*(d[1]-a[1]))/len;
      if(len<1||!Number.isFinite(offset)||Math.abs(offset)<1){$("editHint").textContent="Deze punten vormen geen vlak. Klik opnieuw op de eerste hoek.";requestDrawing();return;}
      const qx=-dy*offset/len,qy=dx*offset/len;
      const points=[a,b,[b[0]+qx,b[1]+qy],[a[0]+qx,a[1]+qy]];
      const center=[(a[0]+b[0]+qx)/2,(a[1]+b[1]+qy)/2];
      if(visible.some(q=>contains(q.points,...center))){$("editHint").textContent="Dit paneel heeft al een vakje.";requestDrawing();return;}
      editsAdded.push({center,points});$("editHint").textContent="Paneel toegevoegd. Klik op een nieuwe hoek of kies Klaar.";
    }
    updateUI();
  });
  $("info").onclick=()=>$("about").showModal();$("closeAbout").onclick=()=>$("about").close();
  $("about").addEventListener("click",e=>{if(e.target===$("about")){const r=$("about").getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$("about").close();}});

  const search=$("search");let queryJob=null,debounce=0,hits=[],selected=-1,searchVersion=0,hitText="";
  function closeSearch(){clearTimeout(debounce);queryJob?.abort();queryJob=null;++searchVersion;$("searchPop").hidden=true;search.setAttribute("aria-expanded","false");search.removeAttribute("aria-activedescendant");hits=[];selected=-1;hitText="";}
  function resultsMessage(text){
    $("results").replaceChildren();$("searchMsg").textContent=text;$("searchPop").hidden=false;search.setAttribute("aria-expanded","true");
  }
  function coordinates(q){
    const m=q.trim().match(/^([+-]?\d{1,3}(?:[.,]\d+)?)\s*(?:[;,]\s*|\s+)([+-]?\d{1,3}(?:[.,]\d+)?)$/);
    if(!m)return null;
    let a=Number(m[1].replace(",",".")),b=Number(m[2].replace(",","."));
    if(a>1&&a<10&&b>48&&b<56)[a,b]=[b,a];
    return [a,b];
  }
  function choose(i){
    const h=hits[i];if(!h)return;closeSearch();search.value=h.name;
    map.setView(h.latlng,h.zoom,{animate:false});search.blur();updateUI();
  }
  async function find(q,auto=false){
    q=q.trim();closeSearch();if(q.length<2)return;
    const version=searchVersion;
    const gps=coordinates(q);
    if(gps){
      if(!coverage.contains(gps)){resultsMessage("Kies coördinaten in Nederland.");return;}
      hits=[{name:gps.map(v=>v.toFixed(5)).join(", "),latlng:gps,zoom:21}];hitText=q;
    }else{
      queryJob=new AbortController();const ctrl=queryJob;
      resultsMessage("Locatie zoeken…");
      const timer=setTimeout(()=>ctrl.abort(),10000);
      try{
        const url=new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
        url.search=new URLSearchParams({q,rows:"5",fl:"weergavenaam,centroide_ll,type"});
        const response=await fetch(url,{signal:ctrl.signal,credentials:"omit"});if(!response.ok)throw Error();
        const data=await response.json();if(version!==searchVersion)return;
        hits=(data.response?.docs||[]).flatMap(d=>{
          const m=/POINT\s*\(\s*([-+.\d]+)\s+([-+.\d]+)\s*\)/i.exec(d.centroide_ll||"");
          if(!m)return [];
          return [{name:d.weergavenaam,latlng:[+m[2],+m[1]],zoom:({adres:21,postcode:20,weg:18,woonplaats:14,gemeente:12,provincie:9})[d.type]||17}];
        });
        hitText=q;
      }catch(err){if(version===searchVersion)resultsMessage("Zoeken bij PDOK lukt nu niet. Probeer GPS-coördinaten.");return;}
      finally{clearTimeout(timer);}
    }
    if(!hits.length){resultsMessage("Geen locatie gevonden. Probeer een adres of GPS-coördinaten.");return;}
    if(auto){choose(0);return;}
    resultsMessage("");
    hits.forEach((h,i)=>{
      const opt=document.createElement("button");opt.type="button";opt.role="option";opt.id="locatie-"+i;opt.textContent=h.name;
      opt.addEventListener("click",()=>choose(i));$("results").append(opt);
    });
  }
  search.addEventListener("input",()=>{closeSearch();const q=search.value.trim();if(q.length>=3)debounce=setTimeout(()=>find(q),380);});
  search.addEventListener("keydown",e=>{
    if(e.key==="Escape"){closeSearch();return;}
    if(!hits.length||!["ArrowDown","ArrowUp"].includes(e.key))return;
    e.preventDefault();selected=(selected+(e.key==="ArrowDown"?1:-1)+hits.length)%hits.length;
    Array.from($("results").children).forEach((b,i)=>{b.classList.toggle("sel",i===selected);b.setAttribute("aria-selected",String(i===selected));});
    search.setAttribute("aria-activedescendant","locatie-"+selected);
  });
  $("searchForm").onsubmit=e=>{e.preventDefault();if(hits.length&&hitText===search.value.trim())choose(Math.max(0,selected));else void find(search.value,true);};
  document.addEventListener("pointerdown",e=>{if(!$("searchForm").contains(e.target))closeSearch();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&edit){finishEdit();updateUI();}});
  updateUI();
})();

