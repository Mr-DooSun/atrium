import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../client/panes/layout.ts';
const p = (key:string): L.PaneRef => ({kind:'agent',key,id:key,hostId:'host'});
const keys = (ps:readonly L.PaneRef[]) => ps.map(x=>x.key);
const parents: Record<string,string> = {a:'root',b:'root',c:'a',x:'other'};
const parent = (k:string) => parents[k];
test('pane insertion, deduplication, removal and moving', () => {
 const list = ['a','b','c'].map(p);
 assert.deepEqual(keys(L.dedupePanes([...list,p('a')])), ['a','b','c']);
 assert.deepEqual(keys(L.addPanes(list,[p('a'),p('d'),p('a')],3)), ['b','c','a','d']);
 assert.deepEqual(keys(L.addPane(list,p('c'),0)), ['c','a','b']);
 assert.deepEqual(keys(L.removePane(list,'b')), ['a','c']);
 assert.deepEqual(keys(L.movePane(list,'a',99)), ['b','c','a']);
 assert.deepEqual(keys(L.movePane(list,'missing',0)), ['a','b','c']);
});
test('family ordering, ancestors, descendants and group movement', () => {
 const ps=['b','x','c','a','root','other'].map(p);
 assert.equal(L.rootOf('c',parent),'root');
 assert.equal(L.nearestPresentAncestor('c',parent,new Set(['root'])),'root');
 const loop=(s:string)=>({a:'b',b:'a'} as Record<string,string>)[s];
 assert.equal(L.rootOf('a',loop),'b'); assert.equal(L.nearestPresentAncestor('a',loop,new Set(['z'])),null);
 const groups=L.groupByFamily(ps,parent);
 assert.deepEqual(keys(groups[0].panes),['root','b','a','c']); assert.deepEqual(groups[0].depths,[0,1,1,2]);
 assert.deepEqual(keys(L.arrangeByFamily(ps,parent)),['root','b','a','c','other','x']);
 assert.deepEqual(keys(L.descendantsOf('root',ps,parent)),['b','a','c']);
 assert.deepEqual(keys(L.moveGroup(ps,parent,'root',1)),['other','x','root','b','a','c']);
});
test('geometry, viewport bounds, insertion and pane sizes', () => {
 assert.deepEqual(L.paneOffsets([100,200,100],10),{offsets:[0,110,320],total:420});
 assert.deepEqual(L.visibleRange([],10,0,100),{start:0,end:0});
 assert.deepEqual(L.visibleRange([100,100,100],10,0,100,0),{start:0,end:1});
 assert.deepEqual(L.visibleRange([100,100,100],10,110,100,1),{start:0,end:3});
 assert.deepEqual(L.visibleRange([100,100,100],10,999,100,0),{start:2,end:3});
 assert.equal(L.insertionIndex([100,100],10,49),0); assert.equal(L.insertionIndex([100,100],10,50),1); assert.equal(L.insertionIndex([100,100],10,999),2);
 assert.equal(L.paneWidth(200,10),200); assert.equal(L.paneWidth(0,10),360); assert.equal(L.paneWidth(1000,10),495); assert.equal(L.paneWidth(650,10),560);
});
test('persistence ignores garbage and subscriptions are bounded with 1000 panes', () => {
 const ps=Array.from({length:1000},(_,i)=>p(String(i)));
 assert.deepEqual(L.parsePanes(L.serializePanes([...ps,ps[0]])),ps);
 for (const bad of ['{','null','{}','[null,42,[1,2,3],["h","i",""]]']) assert.deepEqual(L.parsePanes(bad),[]);
 assert.equal(L.subscriptionIds(ps).length,64);
 const range=L.visibleRange(ps.map(()=>400),10,200000,800,1);
 assert.ok(range.end-range.start <= 5); assert.ok(range.start>0);
});
