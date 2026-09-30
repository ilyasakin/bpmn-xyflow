import assert from 'node:assert/strict';
import {test} from 'node:test';
import CommandStack from '../../lib/modeling/CommandStack.js';
test('nested compounds return values and undo as one unit',()=>{
 const s=CommandStack(),values=[];const add=n=>s.execute({do:()=>values.push(n),undo:()=>values.pop()});
 const result=s.compound('outer',()=>{add(1);s.compound('inner',()=>add(2));return 7;});
 assert.equal(result,7);assert.equal(s.size(),1);s.undo();assert.deepEqual(values,[]);s.redo();assert.deepEqual(values,[1,2]);
});
test('failed transaction rolls back, preserves redo and supports a later transaction',()=>{
 const s=CommandStack(),values=[];const add=n=>s.execute({do:()=>values.push(n),undo:()=>values.pop()});
 add(1);s.undo();assert.throws(()=>s.compound('broken',()=>{add(2);add(3);throw Error('stop');}));
 assert.deepEqual(values,[]);assert.equal(s.size(),0);assert.equal(s.canRedo(),true);
 s.redo();assert.deepEqual(values,[1]);s.compound('next',()=>add(4));s.undo();assert.deepEqual(values,[1]);
});
test('caught nested transaction failure only rolls back its savepoint',()=>{
 const s=CommandStack(),values=[];const add=n=>s.execute({do:()=>values.push(n),undo:()=>values.pop()});
 s.compound('outer',()=>{add(1);try{s.compound('inner',()=>{add(2);throw Error('stop');});}catch{}add(3);});
 assert.deepEqual(values,[1,3]);s.undo();assert.deepEqual(values,[]);
});
test('failed undo/redo do not discard history entry',()=>{
 const s=CommandStack();let failUndo=true,failRedo=false;
 s.execute({do:()=>{if(failRedo)throw Error('redo');},undo:()=>{if(failUndo)throw Error('undo');}});
 assert.throws(()=>s.undo());assert.equal(s.canUndo(),true);
 failUndo=false;s.undo();failRedo=true;assert.throws(()=>s.redo());assert.equal(s.canRedo(),true);
});
test('failed composite redo rolls completed siblings back; failed undo replays completed siblings',()=>{
 const s=CommandStack(),values=[];let redoFails=false,undoFails=false;
 const add=(n)=>s.execute({do:()=>{if(n===2&&redoFails)throw Error('redo');values.push(n);},undo:()=>{if(n===1&&undoFails)throw Error('undo');values.pop();}});
 s.compound('pair',()=>{add(1);add(2);});s.undo();redoFails=true;
 assert.throws(()=>s.redo());assert.deepEqual(values,[]);assert.equal(s.canRedo(),true);
 redoFails=false;s.redo();undoFails=true;assert.throws(()=>s.undo());assert.deepEqual(values,[1,2]);assert.equal(s.canUndo(),true);
 undoFails=false;s.undo();assert.deepEqual(values,[]);
});
