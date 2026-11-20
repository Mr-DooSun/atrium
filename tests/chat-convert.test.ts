import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toChatItem, computeChatLinks } from '../shared/chat/convert.ts';
import { chatTimelines, chatOlder, chatLinks, ChatItem } from '../shared/chat/rpc.ts';

test('converts all timeline item kinds with sequence, timestamp and summaries', () => {
  const cases = [
    [{type:'user_message', text:'u'}, 'user', 'u'], [{type:'assistant_message', text:'a'}, 'assistant', 'a'],
    [{type:'reasoning', text:'r'}, 'reasoning', 'r'], [{type:'tool_call', name:'shell', status:'running'}, 'tool', 'shell (running)'],
    [{type:'todo', items:[{text:'done', completed:true},{text:'next', completed:false}]}, 'status', '- [x] done\n- [ ] next'],
    [{type:'error', message:'oops'}, 'status', 'oops'], [{type:'notification', message:'notice'}, 'status', 'notice'],
    [{type:'compaction', status:'completed'}, 'status', 'Context compacted'], [{type:'compaction', status:'running'}, 'status', 'Compacting context'],
    [{type:'plugin', pluginId:'plug', id:'entry', kind:'note'}, 'other', 'plug: note'],
  ] as const;
  for (const [item, kind, text] of cases) {
    const row = toChatItem({item, seqStart:42, timestamp:'2026-01-01'} as Parameters<typeof toChatItem>[0]);
    assert.equal(row.kind, kind); assert.equal(row.text, text); assert.equal(row.seq, 42); assert.equal(row.at, '2026-01-01');
    assert.equal(row.id, kind === 'other' ? JSON.stringify(['plug','entry']) : '42');
    if (kind === 'tool') assert.equal(row.toolName, 'shell');
  }
});

test('links include external relatives, handle missing parents, duplicates and cycles', () => {
  const p = (id:string, parent?:string): {id:string; labels:Record<string,string>} => ({id, labels: parent ? {'paseo.parent-agent-id':parent} : {}});
  const links = computeChatLinks(['child','root','missing','cycle1','cycle2','self','child'], [p('root'),p('child',' root '),p('sibling','root'),p('missing','absent'),p('cycle1','cycle2'),p('cycle2','cycle1'),p('self','self')]);
  assert.deepEqual(links, [
    {agentId:'child',parentAgentId:'root',rootAgentId:'root',childAgentIds:[]},
    {agentId:'root',parentAgentId:null,rootAgentId:'root',childAgentIds:['child','sibling']},
    {agentId:'missing',parentAgentId:'absent',rootAgentId:'absent',childAgentIds:[]},
    {agentId:'cycle1',parentAgentId:'cycle2',rootAgentId:'cycle1',childAgentIds:['cycle2']},
    {agentId:'cycle2',parentAgentId:'cycle1',rootAgentId:'cycle1',childAgentIds:['cycle1']},
    {agentId:'self',parentAgentId:null,rootAgentId:'self',childAgentIds:[]},
  ]);
});

test('chat contracts validate events, responses, defaults and limits', () => {
  const ids = (n:number) => Array.from({length:n}, (_,i)=>String(i));
  assert.equal(chatTimelines.input.parse({agentIds:ids(64)}).tail, 100);
  assert.equal(chatTimelines.input.safeParse({agentIds:ids(65)}).success, false);
  assert.equal(chatLinks.input.safeParse({agentIds:ids(256)}).success, true);
  assert.equal(chatLinks.input.safeParse({agentIds:ids(257)}).success, false);
  assert.equal(chatOlder.input.parse({agentId:'a',beforeSeq:3}).limit, 100);
  for (const n of [0,501,1.5]) {
    assert.equal(chatTimelines.input.safeParse({agentIds:[],tail:n}).success,false);
    assert.equal(chatOlder.input.safeParse({agentId:'a',beforeSeq:1,limit:n}).success,false);
  }
  for (const n of [1,500]) { assert.equal(chatTimelines.input.safeParse({agentIds:[],tail:n}).success,true); assert.equal(chatOlder.input.safeParse({agentId:'a',beforeSeq:1,limit:n}).success,true); }
  const row = {id:'1',seq:1,kind:'user',text:'hi'};
  for (const event of [{type:'snapshot',agentId:'a',epoch:'e',items:[row],hasMore:true},{type:'append',agentId:'a',epoch:'e',items:[row]},{type:'error',agentId:'a',message:'oops'}]) assert.equal(chatTimelines.event.safeParse(event).success,true);
  assert.equal(chatTimelines.event.safeParse({type:'append',agentId:'a',epoch:'e',items:[{...row,kind:'invalid'}]}).success,false);
  assert.equal(chatOlder.output.safeParse({items:[row],hasMore:false}).success,true);
  assert.equal(chatLinks.output.safeParse({links:[{agentId:'a',parentAgentId:null,rootAgentId:'a',childAgentIds:[]}]}).success,true);
});

test('unknown and incomplete items always convert to valid chat rows',()=>{
 const cases:unknown[]=[{type:'future_kind'},{},null,{type:'user_message'},{type:'assistant_message'},{type:'reasoning'},{type:'error'},{type:'notification'},{type:'tool_call'},{type:'tool_call',name:'shell'},{type:'tool_call',status:'running'},{type:'todo'},{type:'plugin'}];
 for(const item of cases){
  const converted=toChatItem({item,seqStart:17,timestamp:'now'} as Parameters<typeof toChatItem>[0]);
  assert.equal(ChatItem.safeParse(converted).success,true,JSON.stringify(item));
  assert.equal(typeof converted.text,'string');
 }
 assert.equal(toChatItem({item:{type:'future_kind'},seqStart:17,timestamp:'now'} as never).kind,'other');
});
test('tool updates use call id while retaining event sequence, with sequence id fallback',()=>{
 const convert=(item:unknown,seqStart:number)=>toChatItem({item,seqStart,timestamp:'now'} as Parameters<typeof toChatItem>[0]);
 const first=convert({type:'tool_call',callId:'c1',name:'shell',status:'running'},2);
 const last=convert({type:'tool_call',callId:'c1',name:'shell',status:'completed'},5);
 assert.equal(first.id,'tool:c1'); assert.equal(last.id,'tool:c1'); assert.equal(first.seq,2); assert.equal(last.seq,5);
 assert.equal(ChatItem.safeParse(last).success,true); assert.equal(convert({type:'tool_call',name:'shell'},7).id,'7');
});

test('older history input accepts optional epoch and validates its type',()=>{
 assert.deepEqual(chatOlder.input.parse({agentId:'a',beforeSeq:3}),{agentId:'a',beforeSeq:3,limit:100});
 assert.deepEqual(chatOlder.input.parse({agentId:'a',beforeSeq:3,epoch:'epoch-1'}),{agentId:'a',beforeSeq:3,limit:100,epoch:'epoch-1'});
 assert.equal(chatOlder.input.safeParse({agentId:'a',beforeSeq:3,epoch:123}).success,false);
});
