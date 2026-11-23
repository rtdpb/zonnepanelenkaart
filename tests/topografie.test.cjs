const test = require("node:test");
const assert = require("node:assert/strict");
const topografie = require("../topografie.js");
const half=20037508.342789244, pixel=2*half/2**29;
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const polygon=(...rings)=>({geometry:{type:"Polygon",coordinates:rings}});
const panel=(x,y,roofOnly=false)=>({center:[(x+half)/pixel,(half-y)/pixel],roofOnly});

test("street markings inside a carriageway disappear, including close to its edge", () => {
  const data={roads:topografie.shapes([polygon(ring(0,0,120,14),ring(40,4,8,6))]),buildings:[],canopies:[]};
  for(const mark of [panel(9,.16),panel(37,13.33)])assert.equal(topografie.retain(mark,data),false);
  assert.equal(topografie.retain(panel(44,7),data),true);
  assert.equal(topografie.retain(panel(44,20),data),true);
});

test("buildings and canopies protect rooftop modules and weak rows need a roof", () => {
  const data={roads:topografie.shapes([polygon(ring(0,0,120,20))]),
    buildings:topografie.shapes([polygon(ring(0,10,15,20))]),
    canopies:topografie.shapes([{geometry:{type:"MultiPolygon",coordinates:[[ring(31,2,8,7)],[ring(75,2,8,7)]]}}])};
  assert.equal(topografie.retain(panel(5,9.4),data),true);
  assert.equal(topografie.retain(panel(34,6,true),data),true);
  assert.equal(topografie.retain(panel(77,6,true),data),true);
  assert.equal(topografie.retain(panel(130,6,true),data),false);
  assert.equal(topografie.retain(panel(130,6),data),true);
  assert.equal(topografie.retain(panel(60,6),{...data,canopies:null}),true);
});
