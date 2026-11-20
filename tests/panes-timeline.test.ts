import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TIMELINE, mergeItems, applyTimelineEvent, applyOlder, displayItems, overlaps, toolStatusText, rowWording, errorBanner, clearTimelineError, armAutoRetry, autoRetryDue, AUTO_RETRY_DELAY_MS, type ErrorBanner, type HostStatus } from '../client/panes/timeline.ts';
import type { ChatItem } from '../shared/chat/rpc.ts';
import { COMPACTED_FALLBACK_TEXT, COMPACTING_FALLBACK_TEXT, toChatItem } from '../shared/chat/convert.ts';
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

const asst=(seq:number,text:string,extra:Partial<ChatItem>={}):ChatItem=>({id:String(seq),seq,kind:'assistant',text,...extra});
const summary=(items:ChatItem[])=>items.map(i=>[i.id,i.seq,i.text]);
test('toolStatusText words known states through t and leaves others as they are',()=>{
 const t=(key:string)=>key;
 assert.equal(toolStatusText('running',t),'toolRunning'); assert.equal(toolStatusText('completed',t),'toolCompleted');
 assert.equal(toolStatusText('failed',t),'toolFailed'); assert.equal(toolStatusText('canceled',t),'toolCanceled');
 assert.equal(toolStatusText('cancelled',t),'toolCanceled'); assert.equal(toolStatusText('weird',t),'weird');
 assert.equal(toolStatusText(undefined,t),''); assert.equal(toolStatusText('',t),'');
});
test('displayItems never joins a projected row, and joins live chunks onto the row before them',()=>{
 const A=asst(1,'A',{projected:true}), B=asst(2,'B',{projected:true});
 assert.deepEqual(summary(displayItems([A,B])),[['1',1,'A'],['2',2,'B']]);
 assert.deepEqual(summary(displayItems([A,asst(2,'b1'),asst(3,'b2')])),[['1',3,'Ab1b2']]);
 assert.deepEqual(summary(displayItems([asst(1,'a1'),B])),[['1',1,'a1'],['2',2,'B']]);
 assert.deepEqual(summary(displayItems([A,asst(2,'b1'),asst(3,'C',{projected:true})])),[['1',2,'Ab1'],['3',3,'C']]);
});
test('displayItems keeps assistant messages with different messageIds apart and joins equal or missing ones',()=>{
 assert.equal(displayItems([asst(1,'a',{messageId:'m1'}),asst(2,'b',{messageId:'m2'})]).length,2);
 assert.deepEqual(summary(displayItems([asst(1,'a',{messageId:'m1'}),asst(2,'b',{messageId:'m1'})])),[['1',2,'ab']]);
 assert.deepEqual(summary(displayItems([asst(1,'a',{messageId:'m1'}),asst(2,'b')])),[['1',2,'ab']]);
 assert.deepEqual(summary(displayItems([asst(1,'a'),asst(2,'b',{messageId:'m2'})])),[['1',2,'ab']]);
});
test('displayItems applies the same rules to reasoning rows and never joins across kinds',()=>{
 const r=(seq:number,text:string,extra:Partial<ChatItem>={}):ChatItem=>({id:String(seq),seq,kind:'reasoning',text,...extra});
 assert.equal(displayItems([r(1,'A',{projected:true}),r(2,'B',{projected:true})]).length,2);
 assert.deepEqual(summary(displayItems([r(1,'A',{projected:true}),r(2,'b1'),r(3,'b2')])),[['1',3,'Ab1b2']]);
 assert.equal(displayItems([r(1,'a',{messageId:'m1'}),r(2,'b',{messageId:'m2'})]).length,2);
 assert.equal(displayItems([r(1,'a',{messageId:'m1'}),r(2,'b',{messageId:'m1'})]).length,1);
 assert.equal(displayItems([asst(1,'a'),r(2,'b')]).length,2);
 assert.equal(displayItems([r(1,'a'),asst(2,'b')]).length,2);
});

test('rowWording words rows from structured fields, with t returning its key',()=>{
 const t=(key:string)=>key;
 const w=(item:Partial<ChatItem>)=>rowWording({id:'1',seq:1,kind:'other',text:'',...item} as ChatItem,t);
 assert.deepEqual(w({kind:'tool',toolName:'shell',status:'running',text:'shell (running)'}),{label:'shell',body:'toolRunning'});
 assert.deepEqual(w({kind:'status',code:'compacted',text:'Context compacted'}),{label:null,body:'compacted'});
 assert.deepEqual(w({kind:'status',code:'compacting',text:'Compacting context'}),{label:null,body:'compacting'});
 assert.deepEqual(w({code:'plugin',text:'Plugin'}),{label:'plugin',body:''});
 assert.deepEqual(w({code:'plugin',text:'plug: note'}),{label:'plugin',body:'plug: note'});
 assert.deepEqual(w({code:'unknown',text:'Unknown timeline item'}),{label:'unknownItem',body:''});
 assert.deepEqual(w({code:'unknown',text:'future'}),{label:'unknownItem',body:'future'});
 assert.deepEqual(w({kind:'reasoning',text:'hmm'}),{label:'thinking',body:'hmm'});
 assert.deepEqual(w({code:'brand-new',text:'x'}),{label:'unknownItem',body:'x'});
 assert.deepEqual(w({kind:'status',text:'plain'}),{label:null,body:'plain'});
});
test('errorBanner picks the line above a pane',()=>{
 assert.equal(errorBanner(true,null,true),'liveLost'); assert.equal(errorBanner(true,'x',false),'liveLost');
 assert.equal(errorBanner(false,'x',true),'reconnecting'); assert.equal(errorBanner(false,'x',false),'loadFailed');
 assert.equal(errorBanner(false,null,true),null); assert.equal(errorBanner(false,null,false),null);
});
test('a same-epoch snapshot overlapping the newest cached rows keeps the older rows loaded earlier',()=>{
 let state=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:[row(3),row(4)],hasMore:true});
 state=applyOlder(state,'a','e',{items:[row(1),row(2)],hasMore:false});
 state=applyTimelineEvent(state,{type:'snapshot',agentId:'a',epoch:'e',items:[row(3),row(4),row(5)],hasMore:true});
 assert.deepEqual(state.get('a')?.items.map(i=>i.seq),[1,2,3,4,5]);
 assert.equal(state.get('a')?.hasMore,false);
});

test('clearTimelineError drops an error-only entry, keeps rows and epoch otherwise, and returns the same state when there is no error',()=>{
 const errorOnly=applyTimelineEvent(new Map(),{type:'error',agentId:'a',message:'offline'});
 assert.equal(errorOnly.get('a')?.error,'offline');
 const cleared=clearTimelineError(errorOnly,'a');
 assert.equal(cleared.has('a'),false);
 assert.equal(errorOnly.has('a'),true,'the input state is not mutated');

 let loaded=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:[row(1),row(2)],hasMore:true});
 loaded=applyTimelineEvent(loaded,{type:'error',agentId:'a',message:'offline'});
 const kept=clearTimelineError(loaded,'a').get('a');
 assert.deepEqual(kept,{epoch:'e',items:[row(1),row(2)],hasMore:true,error:null});
 assert.equal(loaded.get('a')?.error,'offline');

 const clean=applyTimelineEvent(new Map(),{type:'snapshot',agentId:'a',epoch:'e',items:[row(1)],hasMore:false});
 assert.equal(clearTimelineError(clean,'a'),clean);
 assert.equal(clearTimelineError(clean,'missing'),clean);
 const other=applyTimelineEvent(errorOnly,{type:'snapshot',agentId:'b',epoch:'e',items:[row(1)],hasMore:false});
 assert.equal(clearTimelineError(other,'a').has('b'),true,'other agents are untouched');
});
test('rowWording words compaction rows from an older server that sends no code',()=>{
 const t=(key:string)=>key;
 const w=(item:Partial<ChatItem>)=>rowWording({id:'1',seq:1,kind:'other',text:'',...item} as ChatItem,t);
 assert.deepEqual(w({kind:'status',text:'Context compacted'}),{label:null,body:'compacted'});
 assert.deepEqual(w({kind:'status',text:'Compacting context'}),{label:null,body:'compacting'});
 assert.deepEqual(w({kind:'user',text:'Context compacted'}),{label:null,body:'Context compacted'});
 assert.deepEqual(w({kind:'assistant',text:'Compacting context'}),{label:null,body:'Compacting context'});
 assert.deepEqual(w({kind:'status',text:'Context compacted soon'}),{label:null,body:'Context compacted soon'});
});
test('the compaction fallback constants are exactly the text the converter produces',()=>{
 const convert=(status:string)=>toChatItem({item:{type:'compaction',status},seqStart:1,timestamp:'t'} as Parameters<typeof toChatItem>[0]);
 assert.equal(convert('completed').text,COMPACTED_FALLBACK_TEXT);
 assert.equal(convert('running').text,COMPACTING_FALLBACK_TEXT);
 assert.equal(COMPACTED_FALLBACK_TEXT,'Context compacted'); assert.equal(COMPACTING_FALLBACK_TEXT,'Compacting context');
});

// Compile-time: errorBanner's declared return type is exactly ErrorBanner (tsc fails otherwise).
type Same<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
const errorBannerReturnsErrorBanner:Same<ReturnType<typeof errorBanner>,ErrorBanner>=true;
test('errorBanner returns only ErrorBanner values',()=>{
 assert.equal(errorBannerReturnsErrorBanner,true);
 const all:ErrorBanner[]=[];
 for(const lost of [true,false]) for(const error of [null,'x']) for(const hasRows of [true,false]) all.push(errorBanner(lost,error,hasRows));
 for(const b of all) assert.ok(b===null||['liveLost','reconnecting','loadFailed'].includes(b));
});
test('AUTO_RETRY_DELAY_MS is one second',()=>{ assert.equal(AUTO_RETRY_DELAY_MS,1000); });
test('armAutoRetry arms on any known non-online status and never disarms',()=>{
 assert.equal(armAutoRetry(false,'online'),false); assert.equal(armAutoRetry(false,undefined),false);
 for(const status of ['offline','connecting','error','idle'] as const) assert.equal(armAutoRetry(false,status),true,status);
 assert.equal(armAutoRetry(true,'online'),true); assert.equal(armAutoRetry(true,undefined),true);
 for(const status of ['offline','connecting','error','idle'] as const) assert.equal(armAutoRetry(true,status),true,status);
});
test('autoRetryDue needs the armed flag, an online host and a lost subscription',()=>{
 assert.equal(autoRetryDue(true,'online','liveLost'),true);
 const no:[boolean,HostStatus,ErrorBanner][]=[
  [false,'online','liveLost'],[true,'offline','liveLost'],[true,'connecting','liveLost'],[true,undefined,'liveLost'],
  [true,'online','reconnecting'],[true,'online','loadFailed'],[true,'online',null],
 ];
 for(const [armed,status,banner] of no) assert.equal(autoRetryDue(armed,status,banner),false,`${armed} ${status} ${banner}`);
});
test('auto retry scenario: the host drops and returns before the subscription is seen lost',()=>{
 let a=false;
 a=armAutoRetry(a,'online'); assert.equal(a,false);
 a=armAutoRetry(a,'offline'); assert.equal(a,true);
 a=armAutoRetry(a,'online'); assert.equal(a,true);
 assert.equal(autoRetryDue(a,'online',null),false);
 assert.equal(autoRetryDue(a,'online','liveLost'),true);
});
test('auto retry scenario: the subscription is lost first, while the host is still offline',()=>{
 const a=armAutoRetry(false,'offline');
 assert.equal(autoRetryDue(a,'offline','liveLost'),false);
 assert.equal(autoRetryDue(a,'online','liveLost'),true);
});
test('auto retry scenario: a retry starts a fresh body with the flag cleared, so it cannot loop',()=>{
 const a=false;
 assert.equal(armAutoRetry(a,'online'),false);
 assert.equal(autoRetryDue(a,'online','liveLost'),false);
 assert.equal(armAutoRetry(a,'offline'),true,'a later drop arms it again');
});
test('known limitation: a drop and return batched into one update is never seen, so nothing is armed and no retry happens',()=>{
 const a=armAutoRetry(false,'online');
 assert.equal(a,false);
 assert.equal(autoRetryDue(a,'online','liveLost'),false);
});
