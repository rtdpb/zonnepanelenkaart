// The worker stores probability tiles in the national Web Mercator grid so panning reuses the same pixels.
function zonWorker() {
  let session, latest = 0, waiting = null, running = false;
  const cache = new Map();
  const core = 208, border = 24, chip = core + 2*border;
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
  function imageTensor(data,width,mx,my) {
    const plane=chip*chip,input=new Float32Array(plane*3);
    const mean=[.485,.456,.406],dev=[.229,.224,.225];
    for(let y=0;y<chip;y++){
      let loc=((my*core+y)*2*width+mx*core*2)*4;
      for(let x=0;x<chip;x++,loc+=8){
        const i=y*chip+x, next=loc+width*4;
        for(let b=0;b<3;b++){
          const val=(data[loc+b]+data[loc+4+b]+data[next+b]+data[next+4+b])/1020;
          input[b*plane+i]=(val-mean[b])/dev[b];
        }
      }
    }
    return new ort.Tensor("float32",input,[1,3,chip,chip]);
  }
  async function analyze(job) {
    const {id,width,height,nx,ny,gridX,gridY,metres,bounds}=job;
    const pixels=new Uint8ClampedArray(job.raw);
    const mw=width/2, sum=new Float32Array(mw*height/2), weights=new Float32Array(sum.length);
    const taper=new Float32Array(chip);
    for(let i=0;i<chip;i++)taper[i]=Math.min(1,(i+1)/border,(chip-i)/border);
    let step=0;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      if(latest!==id)return;
      const key=(gridX+i)+","+(gridY+j);
      let values=cache.get(key);
      if(!values){
        const tensor=imageTensor(pixels,width,i,j);
        const out=await session.run({input:tensor});
        values=Uint8Array.from(out.prob.data,v=>Math.round(255*Math.max(0,Math.min(1,v))));
        if(typeof tensor.dispose==="function")tensor.dispose();
        if(typeof out.prob.dispose==="function")out.prob.dispose();
        cache.set(key,values);
        if(cache.size>80)cache.delete(cache.keys().next().value);
      }
      for(let y=0;y<chip;y++){
        let pos=(j*core+y)*mw+i*core;
        for(let x=0;x<chip;x++,pos++){
          const weight=taper[x]*taper[y];
          sum[pos]+=values[y*chip+x]*weight;weights[pos]+=weight;
        }
      }
      self.postMessage({kind:"progress",id,done:++step,total:nx*ny});
      await pause();
    }
    if(latest!==id)return;
    const probability=Uint8Array.from(sum,(v,i)=>Math.round(v/Math.max(weights[i],1e-7)));
    self.postMessage({kind:"refine",id});
    await pause();
    if(latest!==id)return;
    const panels=zoekPaneelvormen({pixels,width,height,probability,metres,bounds});
    if(latest===id)self.postMessage({kind:"result",id,panels});
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
      const code="("+globalThis.zonOrtRuntime.toString()+")();\n"+zoekPaneelvormen.toString()+"\n("+zonWorker.toString()+")();";
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
  function reset(){engine?.terminate();engine=null;starting=null;}
  return {ready,reset,cancel:id=>engine?.postMessage({kind:"cancel",id})};
})();

