const test = require("node:test");
const assert = require("node:assert/strict");
const scan = require("../deelscan.js");

function panel(x, y, score=25, angle=0) {
  const c=Math.cos(angle), s=Math.sin(angle);
  const points=[[-11,-19],[11,-19],[11,19],[-11,19]].map(([u,v])=>[x+c*u-s*v,y+s*u+c*v]);
  return {center:[x,y],points,score};
}

test("the last pixel of the next block is scanned only when it enters the viewport", () => {
  const x=360000*scan.core, y=225000*scan.core;
  assert.equal(scan.plan([x,y,x+scan.core,y+scan.core]).count,1);
  const plan=scan.plan([x+scan.core-9,y+20,x+scan.core+1,y+200]);
  const blocks=[...scan.blocks(plan)];
  assert.equal(blocks.length,2);
  assert.equal(blocks[1].left-blocks[0].left, scan.core);
  assert.equal(scan.size-scan.core,2*scan.margin);
});

test("two detections across a seam produce one box while its neighbour survives", () => {
  const x=360000*scan.core, y=225000*scan.core;
  const [west,east]=[...scan.blocks(scan.plan([x-50,y+30,x+80,y+120]))];
  const original=scan.locate(panel(x-west.left,y+70-west.top),west);
  const second=scan.locate(panel(x-east.left+2,y+70-east.top+1,22),east);
  const neighbour=scan.locate(panel(x+22-east.left,y+70-east.top),east);
  const merged=scan.merge([second,neighbour,original]);
  assert.deepEqual(merged.map(box=>box.center),[original.center,neighbour.center]);
});

test("adjacent diagonal modules survive even when their screen bounding boxes overlap", () => {
  const a=.73, x=271110000, y=171110000;
  const first=panel(x,y,29,a), second=panel(x+22*Math.cos(a),y+22*Math.sin(a),27,a);
  assert.equal(scan.merge([second,first]).length,2);
});

test("missing image coverage is measured inside the selected view", () => {
  const size=scan.size, pixels=new Uint8ClampedArray(size*size*4).fill(255);
  const block={left:0,top:0}, middle=scan.margin+scan.core/2;
  for(let y=0;y<size;y++) for(let x=0;x<middle;x++) pixels[4*(y*size+x)]=65;
  const mask=scan.coverage(pixels);
  const left=scan.visibleCoverage(block,mask,[scan.margin,scan.margin,middle,scan.margin+scan.core]);
  const right=scan.visibleCoverage(block,mask,[middle,scan.margin,scan.margin+scan.core,scan.margin+scan.core]);
  assert.ok(left.total>0 && left.total===left.valid);
  assert.ok(right.total>0 && right.valid===0);
});
