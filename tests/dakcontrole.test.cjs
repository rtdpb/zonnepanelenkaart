const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const maakDakcontrole = require("../dakcontrole.js");

const hash = value => createHash("sha256").update(value).digest("hex");
const tileA = "21/0/0", tileB = "21/1/0", full = [0,0,512,256];
const rectangle = (x,y,w,h) => [x,y,x+w,y,x+w,y+h,x,y+h];
const photo = {
  tiles:{[tileA]:hash("west"),[tileB]:hash("oost")},
  fields:[
    {origin:[250,100],outline:rectangle(0,0,26,20),confirmed:[rectangle(0,0,13,20)],estimated:[rectangle(13,0,13,20)]},
    {origin:[305,111],outline:rectangle(0,0,32,92),unresolved:true},
    {origin:[295,20],outline:rectangle(0,0,53,18)}
  ]
};

test("only the matching aerial photograph enables reviewed boxes and exclusions", async () => {
  const review=maakDakcontrole(photo), original=[{center:[259,110]},{center:[320,160]},{center:[320,30]},{center:[80,80]}];
  assert.deepEqual(review.missing(full).sort(),[tileA,tileB]);
  await review.recordTile(tileA,new Blob(["west"]));
  await review.recordTile(tileB,new Blob(["andere opname"]));
  assert.deepEqual(review.apply(original,full),{panels:original,unresolved:[]});
  await review.recordTile(tileB,new Blob(["oost"]));
  const result=review.apply(original,full);
  assert.deepEqual(result.panels.map(p=>p.center),[[80,80],[256.5,110],[269.5,110]]);
  assert.deepEqual(result.panels.slice(1).map(p=>p.estimated),[false,true]);
  assert.equal(result.unresolved.length,1);
  await review.recordTile(tileB,new Blob(["nieuw jaar"]));
  assert.deepEqual(review.apply(original,full),{panels:original,unresolved:[]});
});

test("a narrow viewport counts only a centre in view and keeps an unresolved strip separate", async () => {
  const review=maakDakcontrole(photo);
  const part=[251,103,260,119];
  assert.deepEqual(review.missing(part).sort(),[tileA,tileB]);
  await review.recordTile(tileA,new Blob(["west"]));
  await review.recordTile(tileB,new Blob(["oost"]));
  assert.deepEqual(review.apply([],part).panels.map(p=>p.center),[[256.5,110]]);
  const {unresolved}=review.apply([],full);
  assert.equal(review.visibleFields(unresolved,[311,120,317,150]).length,1);
  assert.equal(review.visibleFields(unresolved,[306,159,342,162]).length,1);
  assert.equal(review.visibleFields(unresolved,part).length,0);
  assert.equal(review.apply([],[311,120,317,150]).panels.length,0);
});
