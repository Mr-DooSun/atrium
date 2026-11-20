import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source=readFileSync('client/project-order.tsx','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports: typeof import('../client/project-order.tsx') = {} as never;
runInNewContext(js,{exports,require:()=>({}),Object});
const {outsideSidebar,isPaneDrag,PANE_DRAG_ENTER,PANE_DRAG_FAR,PANE_DRAG_FAR_EXIT}=exports;
test('pane drag entry and exit thresholds have hysteresis',()=>{
 const base={startX:100,left:0,right:500,active:false,dropZones:true};
 assert.equal(isPaneDrag({...base,x:500+PANE_DRAG_ENTER,startX:400}),false);
 assert.equal(isPaneDrag({...base,x:500+PANE_DRAG_ENTER+1,startX:400}),true);
 assert.equal(isPaneDrag({...base,x:501,active:true,startX:400}),true);
 assert.equal(isPaneDrag({...base,x:100+PANE_DRAG_FAR}),false);
 assert.equal(isPaneDrag({...base,x:101+PANE_DRAG_FAR}),true);
 assert.equal(isPaneDrag({...base,x:100+PANE_DRAG_FAR_EXIT,active:true}),false);
 assert.equal(isPaneDrag({...base,x:101+PANE_DRAG_FAR_EXIT,active:true}),true);
 assert.equal(isPaneDrag({...base,x:999,dropZones:false}),true);
 assert.equal(isPaneDrag({...base,left:0,right:0,x:101}),false);
});

test('outside sidebar and drag without drop zones respect boundaries and hysteresis',()=>{
 assert.equal(outsideSidebar(100,0,100),false);
 assert.equal(outsideSidebar(101,0,100),true);
 assert.equal(outsideSidebar(-13,0,100,12),true);
 assert.equal(outsideSidebar(-12,0,100,12),false);
 assert.equal(outsideSidebar(999,10,10),false);
 assert.equal(outsideSidebar(999,20,10),false);
 const base={startX:100,left:0,right:500,active:false,dropZones:false};
 assert.equal(isPaneDrag({...base,x:500+PANE_DRAG_ENTER+1}),true);
 assert.equal(isPaneDrag({...base,x:500+PANE_DRAG_ENTER}),false);
 assert.equal(isPaneDrag({...base,x:400}),false);
 assert.equal(isPaneDrag({...base,x:501,active:true}),true);
 assert.equal(isPaneDrag({...base,x:500,active:true}),false);
 assert.equal(isPaneDrag({...base,left:10,right:10,x:999}),false);
});
