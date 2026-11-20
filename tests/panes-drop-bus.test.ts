import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../client/panes/drop-bus.ts';
const payload = {kind:'atrium.session',agent:{kind:'agent',key:'a',hostId:'h',id:'a'}} as B.SessionDragPayload;
afterEach(()=>B.resetDropBus());
test('register, hover, hit, miss, cancel and unregister', async () => {
 const h: unknown[]=[]; const drops: unknown[]=[];
 const unregister=B.registerDropZone({id:'z',measure:async()=>({x:0,y:0,width:100,height:100}),onHover:(p,at)=>h.push([p,at]),onDrop:(p,at)=>drops.push([p,at])});
 assert.equal(B.hasDropZones(),true); B.beginSessionDrag(payload); await new Promise(resolve=>setImmediate(resolve));
 B.moveSessionDrag(10,20); B.moveSessionDrag(200,200);
 assert.deepEqual(h,[[payload,{x:10,y:20}],[null,undefined]]);
 assert.equal(await B.endSessionDrag(10,20),true); assert.deepEqual(drops,[[payload,{x:10,y:20}]]);
 B.beginSessionDrag(payload); assert.equal(await B.endSessionDrag(200,200),false);
 B.beginSessionDrag(payload); assert.equal(await B.endSessionDrag(null,null),false); assert.equal(B.getSessionDrag(),null);
 unregister(); assert.equal(B.hasDropZones(),false);
});
test('most recently registered overlapping zone receives drop', async () => {
 const hits:string[]=[];
 for(const id of ['first','second']) B.registerDropZone({id,measure:async()=>({x:0,y:0,width:10,height:10}),onDrop:()=>hits.push(id)});
 B.beginSessionDrag(payload); assert.equal(await B.endSessionDrag(5,5),true); assert.deepEqual(hits,['second']);
});
test('queued open requests are delivered once to a later listener', () => {
 const got: unknown[]=[]; B.openInPanes(payload); const off=B.onOpenInPanes(p=>got.push(p)); off(); B.onOpenInPanes(p=>got.push(p)); assert.deepEqual(got,[payload]);
});

test('measureZone handles valid, failed, empty and timed-out measurements', async () => {
 assert.ok(B.MEASURE_TIMEOUT_MS > 0);
 const rect={x:1,y:2,width:3,height:4};
 assert.deepEqual(await B.measureZone({measure:async()=>rect},10),rect);
 assert.equal(await B.measureZone({measure:()=>{throw new Error('broken');}},10),null);
 assert.equal(await B.measureZone({measure:async()=>{throw new Error('rejected');}},10),null);
 assert.equal(await B.measureZone({measure:async()=>null},10),null);
 assert.equal(await B.measureZone({measure:async()=>({...rect,width:0})},10),null);
 assert.equal(await B.measureZone({measure:async()=>({...rect,height:0})},10),null);
 assert.equal(await B.measureZone({measure:()=>new Promise(()=>{})},5),null);
});
test('end drag finishes when a zone never measures', {timeout:2000}, async () => {
 B.registerDropZone({id:'stuck',measure:()=>new Promise(()=>{}),onDrop:()=>assert.fail('unexpected drop')});
 B.beginSessionDrag(payload);
 assert.equal(await B.endSessionDrag(5,5),false); assert.equal(B.getSessionDrag(),null);
});
test('a stale end cannot clear a newer drag', async () => {
 let finish!:(r:B.Rect)=>void;
 const measurement=new Promise<B.Rect>(resolve=>{finish=resolve;});
 B.registerDropZone({id:'slow',measure:()=>measurement,onDrop:()=>{}});
 B.beginSessionDrag(payload);
 const ending=B.endSessionDrag(5,5);
 const next={...payload,title:'new'};
 B.beginSessionDrag(next);
 finish({x:0,y:0,width:10,height:10});
 await ending;
 assert.equal(B.getSessionDrag(),next);
 assert.equal(await B.endSessionDrag(null,null),false);
});
