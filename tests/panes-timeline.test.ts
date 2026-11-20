import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TIMELINE, mergeItems, applyTimelineEvent, applyOlder, displayItems, overlaps } from '../client/panes/timeline.ts';
import type { ChatItem } from '../shared/chat/rpc.ts';
const row=(seq:number,text=String(seq)):ChatItem=>({id:String(seq),seq,kind:'assistant',text});
test('merges items by id, incoming wins and sorts',()=>{
 assert.deepEqual(mergeItems([row(3),row(1)],[row(1,'updated'),row(2)]),[row(1,'updated'),row(2),row(3)]);
 assert.deepEqual(EMPTY_TIMELINE,{epoch:null,items:[],hasMore:false,error:null});
});
test('snapshot, append, errors, epoch changes and older page protection',()=>{
 let state=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e1',items:[row(3)],hasMore:true});
 state=applyOlder(state,'a','e1',{items:[row(1),row(2)],hasMore:false});
 state=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e1',items:[row(3,'fresh'),row(4)],hasMore:true});
 assert.deepEqual(state.get('a')?.items,[row(1),row(2),row(3,'fresh'),row(4)]); assert.equal(state.get('a')?.hasMore,false);
 state=applyTimelineEvent(state,{type:'append',agentId:'a',epoch:'e1',items:[row(5)]});
 state=applyTimelineEvent(state,{type:'error',agentId:'a',message:'offline'}); assert.equal(state.get('a')?.error,'offline');
 state=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e2',items:[row(9)],hasMore:false});
 state=applyOlder(state,'a','e1',{items:[row(0)],hasMore:true});
 state=applyTimelineEvent(state,{type:'append',agentId:'a',epoch:'e1',items:[row(10)]});
 assert.deepEqual(state.get('a'),{epoch:'e2',items:[row(9)],hasMore:false,error:null});
});


test('display joins adjacent assistant and reasoning chunks without changing raw rows',()=>{
 const input:ChatItem[]=[row(1,'Hello '),row(2,'world'),{...row(3,'think '),kind:'reasoning'}, {...row(4,'again'),kind:'reasoning'}, {...row(5,'tool'),kind:'tool'}, row(6,'next'), {...row(7,'user'),kind:'user'}, {...row(8,'user2'),kind:'user'}];
 const before=structuredClone(input);
 assert.deepEqual(displayItems(input),[{...row(1,'Hello world'),seq:2},{...row(3,'think again'),kind:'reasoning',seq:4},input[4],input[5],input[6],input[7]]);
 assert.deepEqual(input,before); assert.deepEqual(displayItems([]),[]);
});
test('overlap detection and reconnect snapshots avoid gaps',()=>{
 const cached=[row(1),row(3)];
 assert.equal(overlaps([], [row(3)],true),false); assert.equal(overlaps(cached,[],false),false);
 assert.equal(overlaps(cached,[row(3),row(4)],true),true);
 assert.equal(overlaps(cached,[row(4)],true),false);
 assert.equal(overlaps(cached,[row(4)],false),true);
 const state=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:cached,hasMore:true});
 const gap=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e',items:[row(5),row(6)],hasMore:true});
 assert.deepEqual(gap.get('a')?.items,[row(5),row(6)]); assert.equal(gap.get('a')?.hasMore,true);
 const overlap=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e',items:[row(3,'new'),row(4)],hasMore:true});
 assert.deepEqual(overlap.get('a')?.items,[row(1),row(3,'new'),row(4)]);
 const whole=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e',items:[row(4)],hasMore:false});
 assert.deepEqual(whole.get('a')?.items,[row(1),row(3),row(4)]);
});
test('older page must match epoch and original oldest sequence when supplied',()=>{
 const state=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:[row(5),row(6)],hasMore:true});
 const page={items:[row(3),row(4)],hasMore:false};
 assert.deepEqual(applyOlder(state,'a','e',page,5).get('a')?.items,[row(3),row(4),row(5),row(6)]);
 assert.deepEqual(applyOlder(state,'a','e',page,6).get('a'),state.get('a'));
 assert.deepEqual(applyOlder(state,'a','old',page,5).get('a'),state.get('a'));
 assert.deepEqual(applyOlder(state,'a','e',page).get('a')?.items,[row(3),row(4),row(5),row(6)]);
 assert.equal(applyOlder(state,'missing','e',page,5).has('missing'),false);
});

test('tool update retains its original position and separates assistant bubbles',()=>{
 const tool:ChatItem={id:'tool:c1',seq:2,kind:'tool',text:'shell (running)',toolName:'shell',at:'old'};
 const update:ChatItem={...tool,seq:5,text:'shell (completed)',toolName:'updated',at:'new'};
 const initial=[row(1,'A'),tool,row(3,'B'),row(4,'C')];
 const expected=[row(1,'A'),{...update,seq:2},row(3,'B'),row(4,'C')];
 assert.deepEqual(mergeItems(initial,[update]),expected);
 let state=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:initial,hasMore:false});
 state=applyTimelineEvent(state,{type:'append',agentId:'a',epoch:'e',items:[update]});
 assert.deepEqual(state.get('a')?.items,expected);
 assert.deepEqual(displayItems(state.get('a')!.items),[row(1,'A'),{...update,seq:2},{...row(3,'BC'),seq:4}]);
});
