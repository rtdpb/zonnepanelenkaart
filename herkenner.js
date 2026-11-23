function combineerDetailmaskers(size,margin,context,rotated,middle,fine) {
  const n=size/2, probability=new Uint8Array(n*n);
  function sample(field,x,y) {
    x=Math.max(0,Math.min(255,x)); y=Math.max(0,Math.min(255,y));
    const a=Math.floor(x), b=Math.floor(y), r=Math.min(a+1,255), t=Math.min(b+1,255);
    const dx=x-a, dy=y-b;
    return (field[b*256+a]*(1-dx)+field[b*256+r]*dx)*(1-dy)
      +(field[t*256+a]*(1-dx)+field[t*256+r]*dx)*dy;
  }
  for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    const px=2*x+1, py=2*y+1;
    const upright=sample(context,px/4-.5,py/4-.5);
    const wide=sample(rotated,px/4-.5,py/4-.5);
    const edge=Math.min(px-margin,py-margin,size-margin-px,size-margin-py);
    const blend=Math.max(0,Math.min(1,edge/64));
    const mid=blend ? blend*sample(middle,(px-margin)/3-.5,(py-margin)/3-.5)+(1-blend)*wide : wide;
    const consensus=.7*Math.max(wide,mid)+.3*Math.min(wide,mid);
    let sum=0, weights=0;
    for (const patch of fine) {
      const dx=x-patch.x/2, dy=y-patch.y/2;
      if (dx<0||dy<0||dx>=256||dy>=256) continue;
      const w=Math.min(1,(dx+1)/32,(256-dx)/32)*Math.min(1,(dy+1)/32,(256-dy)/32);
      sum+=patch.values[dy*256+dx]*w; weights+=w;
    }
    const detail=weights ? sum/weights : 0;
    probability[y*n+x]=Math.round(Math.max(consensus,.93*upright,.83*detail+.10*consensus));
  }
  return probability;
}

function markeerDetailpanelen(pixels,size,probability,context,metres,bounds) {
  const scene={pixels,width:size,height:size,probability,metres,bounds};
  const detail=zoekPaneelvormen(scene);
  const n=size/2, small=new Uint8ClampedArray(n*n*4);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++){
    const p=(2*y*size+2*x)*4, j=4*(y*n+x), stride=size*4;
    for(let k=0;k<3;k++) small[j+k]=(pixels[p+k]+pixels[p+k+4]+pixels[p+k+stride]+pixels[p+k+stride+4])/4;
    small[j+3]=255;
  }
  const contextBoxes=zoekPaneelvormen({pixels:small,width:n,height:n,probability:context,metres:metres*2,
    bounds:bounds.map(v=>v/2)});
  const enlarge=p=>[2*p[0],2*p[1]];
  const coarse=contextBoxes.map(b=>({center:enlarge(b.center),points:b.points.map(enlarge),score:b.score}));
  const rows=zoekPaneelrijen(scene,coarse.concat(detail));
  return rows.concat(detail,coarse);
}

function zonWorker() {
  let session, latest = 0, waiting = null, running = false;
  const pause = () => new Promise(resolve => setTimeout(resolve,0));

  async function unpack(value) {
    const bytes = typeof Uint8Array.fromBase64 === "function" ? Uint8Array.fromBase64(value)
      : Uint8Array.from(atob(value),c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function init(assets) {
    const binary = await unpack(assets.wasm);
    const url = URL.createObjectURL(new Blob([binary],{type:"application/wasm"}));
    try {
      ort.env.wasm.numThreads=1; ort.env.wasm.simd=true; ort.env.wasm.proxy=false;
      ort.env.wasm.wasmPaths={"ort-wasm-simd.wasm":url};
      ort.env.logLevel="error";
      session=await ort.InferenceSession.create(await unpack(assets.model),{
        executionProviders:["wasm"],graphOptimizationLevel:"all"
      });
      self.postMessage({kind:"ready"});
    } finally { URL.revokeObjectURL(url); }
  }
  function tensorIndex(x,y,rotate) {
    return rotate ? (255-x)*256+y : y*256+x;
  }

  async function predict(pixels, width, x0, y0, step, rotate=false) {
    const plane=256*256, input=new Float32Array(plane*3);
    const divisor=255*step*step;
    for (let y=0;y<256;y++) for (let x=0;x<256;x++) {
      let red=0, green=0, blue=0;
      const origin=((y0+y*step)*width+x0+x*step)*4;
      for (let j=0;j<step;j++) {
        let i=origin+j*width*4;
        for (let k=0;k<step;k++,i+=4) { red+=pixels[i]; green+=pixels[i+1]; blue+=pixels[i+2]; }
      }
      const pos=tensorIndex(x,y,rotate);
      input[pos]=(red/divisor-.485)/.229;
      input[plane+pos]=(green/divisor-.456)/.224;
      input[2*plane+pos]=(blue/divisor-.406)/.225;
    }
    const tensor=new ort.Tensor("float32",input,[1,3,256,256]);
    const out=await session.run({input:tensor});
    try {
      const raw=out.prob.data, values=new Uint8Array(plane);
      for (let y=0;y<256;y++) for (let x=0;x<256;x++) {
        values[y*256+x]=Math.round(255*Math.max(0,Math.min(1,raw[tensorIndex(x,y,rotate)])));
      }
      return values;
    } finally {
      tensor.dispose?.(); out.prob.dispose?.();
    }
  }

  async function analyze(job) {
    const {id,size,margin,overlap,metres}=job;
    const pixels=new Uint8ClampedArray(job.raw);
    let done=0;
    async function pass(x,y,step,rotate) {
      const values=await predict(pixels,size,x,y,step,rotate);
      self.postMessage({kind:"progress",id,done:++done,total:7});
      await pause();
      return values;
    }
    // Zoom 21 retains the source pixels. Different receptive fields distinguish
    // dark arrays in roof context and the narrower divisions in light/reflecting rows.
    const context=await pass(0,0,4,false);
    if (latest!==id) return;
    const rotated=await pass(0,0,4,true);
    if (latest!==id) return;
    const middle=await pass(margin,margin,3,true);
    if (latest!==id) return;
    const fine=[];
    const origins=[margin/2, size-margin/2-512];
    for (const y of origins) for (const x of origins) {
      fine.push({x,y,values:await pass(x,y,2,true)});
      if (latest!==id) return;
    }
    self.postMessage({kind:"refine",id});
    await pause();
    if (latest!==id) return;
    const probability=combineerDetailmaskers(size,margin,context,rotated,middle,fine);
    const bounds=[margin-overlap,margin-overlap,size-margin+overlap,size-margin+overlap];
    const panels=markeerDetailpanelen(pixels,size,probability,context,metres,bounds);
    if (latest===id) self.postMessage({kind:"result",id,panels});
  }
  async function drain() {
    if(running)return;
    running=true;
    try {
      while(waiting){
        const job=waiting;waiting=null;
        try{await analyze(job);}catch(err){
          self.postMessage({kind:"error",id:job.id,error:String(err.message||err)});
        }
      }
    } finally {running=false;}
  }
  self.onmessage=async event=>{
    const m=event.data;
    if(m.kind==="init"){
      try {await init(m.assets);} catch(err) {self.postMessage({kind:"initError",error:String(err.message||err)});}
    } else if(m.kind==="run"){
      latest=m.id;waiting=m;void drain();
    } else if(m.kind==="cancel"&&latest===m.id){latest=0;waiting=null;}
  };
}

const paneelRekenkern = (() => {
  let engine = null, starting = null;
  const loaded = new Map();
  function localScript(path) {
    if(!loaded.has(path)) loaded.set(path,new Promise((resolve,reject)=>{
      const js=document.createElement("script");js.src=path;
      js.onload=resolve;js.onerror=()=>{loaded.delete(path);js.remove();reject(new Error("Modelbestand ontbreekt. Open index.html in de volledige map Zonnepanelenkaart."));};
      document.head.append(js);
    }));
    return loaded.get(path);
  }
  async function ready() {
    if(starting)return starting;
    starting=(async()=>{
      await Promise.all([localScript("vendor/ort-loader.js"),localScript("model/assets.js")]);
      if(typeof DecompressionStream==="undefined"||typeof Worker==="undefined")throw new Error("Open deze kaart in een recente versie van Edge, Chrome, Firefox of Safari.");
      const code=[ "("+globalThis.zonOrtRuntime.toString()+")();", zoekPaneelvormen.toString(),
        zoekPaneelrijen.toString(), combineerDetailmaskers.toString(), markeerDetailpanelen.toString(),
        "("+zonWorker.toString()+")();" ].join("\n");
      const url=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));
      try {engine=new Worker(url);} finally {URL.revokeObjectURL(url);}
      await new Promise((resolve,reject)=>{
        const finish=(error)=>{
          engine.removeEventListener("message",message);engine.removeEventListener("error",failure);
          if(error)reject(error);else resolve();
        };
        const message=e=>{
          if(e.data.kind==="ready")finish();
          if(e.data.kind==="initError")finish(new Error(e.data.error));
        };
        const failure=e=>finish(new Error(e.message||"De herkenner kon niet starten."));
        engine.addEventListener("message",message);engine.addEventListener("error",failure);
        engine.postMessage({kind:"init",assets:globalThis.zonModelAssets});
      });
      return engine;
    })().catch(error=>{engine?.terminate();engine=null;starting=null;throw error;});
    return starting;
  }
  async function runBlock(message,signal,progress) {
    const worker=await ready();
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      function detach() {
        worker.removeEventListener("message",receive); worker.removeEventListener("error",failure);
        signal.removeEventListener("abort",abort);
      }
      function abort() {
        detach(); worker.postMessage({kind:"cancel",id:message.id}); reject(signal.reason);
      }
      function failure() {
        detach(); worker.terminate(); engine=null; starting=null;
        reject(new Error("De herkenner is gestopt. Probeer de telling opnieuw."));
      }
      function receive(event) {
        const m=event.data;
        if (m.id!==message.id) return;
        if (m.kind==="result") { detach(); resolve(m.panels); }
        else if (m.kind==="error") { detach(); reject(new Error("De herkenning van dit deelgebied is mislukt. Probeer de telling opnieuw.")); }
        else progress(m);
      }
      worker.addEventListener("message",receive); worker.addEventListener("error",failure);
      signal.addEventListener("abort",abort,{once:true});
      try { worker.postMessage({kind:"run",...message},[message.raw]); }
      catch (err) { detach(); reject(err); }
    });
  }
  return {runBlock};
})();

