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

test('saved widths preserve old format, clamp values and deduplicate pane keys', () => {
 const ps=[p('a'),p('b'),p('c'),p('a')];
 const old='[["host","a","a"],["host","b","b"],["host","c","c"]]';
 assert.equal(L.serializePanes(ps),old);
 assert.deepEqual(L.parsePanes(old),ps.slice(0,3));
 assert.deepEqual([...L.parsePaneWidths(old)],[]);
 const widths=new Map([['a',299.6],['b',950],['c',455.5]]);
 const saved=L.serializePanes(ps,widths);
 assert.equal(saved,'[["host","a","a",300],["host","b","b",900],["host","c","c",456]]');
 assert.deepEqual(L.parsePanes(saved),ps.slice(0,3));
 assert.deepEqual([...L.parsePaneWidths(saved)],[['a',300],['b',900],['c',456]]);
 assert.equal(L.serializePanes([p('a')],new Map([['a',NaN]])),'[["host","a","a"]]');
 const mixed='[["h","first","k",450.6],["h","second","k",800],["h","old","old"],["h","new","old",700],["h","str","str","600"],["h","lo","lo",1],["h","hi","hi",1000]]';
 assert.deepEqual(L.parsePanes(mixed).map(x=>x.id),['first','old','str','lo','hi']);
 assert.deepEqual([...L.parsePaneWidths(mixed)],[['k',451],['lo',300],['hi',900]]);
 for(const bad of [null,undefined,'','{','null','{}','[null,[],[1,2,3]]']) {
  assert.deepEqual(L.parsePanes(bad),[]); assert.deepEqual([...L.parsePaneWidths(bad)],[]);
 }
});

test('width bounds round, reject non-finite and resolve without clamping',()=>{
 assert.equal(L.PANE_MIN_WIDTH,300); assert.equal(L.PANE_MAX_WIDTH,900);
 for(const [input,expected] of [[-1,300],[300.4,300],[300.5,301],[899.6,900],[999,900]] as const) assert.equal(L.clampPaneWidth(input),expected);
 for(const input of [NaN,Infinity,-Infinity]) assert.equal(L.clampPaneWidth(input),null);
 assert.deepEqual(L.resolveWidths([p('a'),p('b'),p('c')],new Map([['a',100],['b',1000]]),42),[100,1000,42]);
});

test('reorderTarget moves family blocks and clamps children within their family',()=>{
 const ps=['a','b','c','x','y'].map(p);
 const parentOf=(key:string)=>({b:'a',c:'a'} as Record<string,string>)[key];
 for(const [drag,gap,expected] of [
  ['a',5,['x','y','a','b','c']], ['a',4,['x','a','b','c','y']],
  ['a',2,['a','b','c','x','y']], ['a',0,['a','b','c','x','y']], ['a',3,['a','b','c','x','y']],
  ['y',1,['y','a','b','c','x']], ['y',2,['a','b','c','y','x']],
  ['c',1,['a','c','b','x','y']], ['b',5,['a','c','b','x','y']],
  ['y',-99,['y','a','b','c','x']], ['a',99,['x','y','a','b','c']],
 ] as const) assert.deepEqual(keys(L.reorderTarget(ps,parentOf,drag,gap)),expected,`${drag} to ${gap}`);
 assert.deepEqual(keys(L.reorderTarget(['b','x','a','c','y'].map(p),parentOf,'unknown',0)),['a','b','c','x','y']);
 const even=['a','b','x'].map(p);
 assert.deepEqual(keys(L.reorderTarget(even,parentOf,'x',1)),['x','a','b']);
});

test('edge scroll scales at edges and handles narrow or invalid viewport',()=>{
 assert.equal(L.edgeScrollDelta(0,0,1000),-24); assert.equal(L.edgeScrollDelta(500,0,1000),0);
 assert.equal(L.edgeScrollDelta(976,0,1000),12); assert.equal(L.edgeScrollDelta(24,0,1000),-12);
 assert.equal(L.edgeScrollDelta(-100,0,1000),-24); assert.equal(L.edgeScrollDelta(1100,0,1000),24);
 assert.equal(L.edgeScrollDelta(10,0,20),0); assert.equal(L.edgeScrollDelta(5,0,20),-12);
 assert.equal(L.edgeScrollDelta(10,0,0),0); assert.equal(L.edgeScrollDelta(10,20,0),0);
 assert.equal(L.edgeScrollDelta(0,0,100,0),0); assert.equal(L.edgeScrollDelta(0,0,100,-1),0);
});

test('readable text chooses contrast for hex colors and defaults to white',()=>{
 assert.equal(L.readableOn('#000'),'#ffffff'); assert.equal(L.readableOn('#fff'),'#000000');
 assert.equal(L.readableOn('#00ff00'),'#000000'); assert.equal(L.readableOn('#0000ff'),'#ffffff');
 assert.equal(L.readableOn(' #FFFFFF00 '),'#000000'); assert.equal(L.readableOn('invalid'),'#ffffff');
});
test('family offer excludes open descendants and preserves depth first sibling order',()=>{
 const ps=['root','b','a','grand','c','other'].map(p);
 const parentOf=(k:string)=>({a:'root',b:'root',c:'root',grand:'a'} as Record<string,string>)[k];
 assert.deepEqual(keys(L.familyOfferChildren('root',ps,[p('root'),p('a')],parentOf)),['b','grand','c']);
 assert.deepEqual(L.familyOfferChildren('root',ps,ps,parentOf),[]);
 assert.deepEqual(L.familyOfferChildren('other',ps,[],parentOf),[]);
});
test('family members insert after last open family member without moving existing panes',()=>{
 const parentOf=(k:string)=>({b:'a',c:'a',d:'a',e:'a'} as Record<string,string>)[k];
 const open=['a','b','x','y'].map(p);
 assert.deepEqual(keys(L.addFamilyMembers(open,parentOf,'a',['c','b','d','c'].map(p))),['a','b','c','d','x','y']);
 assert.deepEqual(keys(L.addFamilyMembers(['x','a','b','y'].map(p),parentOf,'b',['d','c'].map(p))),['x','a','b','d','c','y']);
 assert.deepEqual(keys(L.addFamilyMembers(['x','y'].map(p),parentOf,'a',['c','d'].map(p))),['x','y','c','d']);
 assert.deepEqual(keys(L.addFamilyMembers(open,parentOf,'a',[p('b')])),['a','b','x','y']);
});

test('groupByFamily keeps every pane exactly once even when parents form a loop',()=>{
 const check=(names:string[],parents:Record<string,string>)=>{
  const ps=names.map(p); const groups=L.groupByFamily(ps,(k)=>parents[k]);
  const all=groups.flatMap(g=>keys(g.panes)); const unique=[...new Set(names)].sort();
  assert.deepEqual([...all].sort(),unique,JSON.stringify(parents));
  for(const g of groups) assert.equal(g.depths.length,g.panes.length);
  assert.deepEqual([...keys(L.arrangeByFamily(ps,(k)=>parents[k]))].sort(),unique);
 };
 check(['a','b'],{a:'b',b:'a'});
 check(['b','a'],{a:'b',b:'a'});
 check(['a','b','c'],{a:'b',b:'c',c:'a'});
 check(['a'],{a:'a'});
 check(['x','a','b','c','y'],{a:'b',b:'a',c:'a',y:'x'});
 check(['a','b','c','d'],{a:'b',b:'a',c:'d',d:'c'});
 check(['a','b','a'],{a:'b',b:'a'});
});
