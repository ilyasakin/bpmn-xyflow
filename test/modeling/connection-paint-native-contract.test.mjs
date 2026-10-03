import test from 'node:test';
import assert from 'node:assert/strict';
import { assertForwardPaint, connectionPaintCases } from './browser-connection-paint.mjs';

test('native paint oracle rejects actual retained backtracking and endpoint drift independently of implementation',()=>{
  const start={x:615,y:232},end={x:780,y:233};
  const corrected='M615,232L697.5,232C697.75,232,698,232.25,698,232.5L698,232.5C698,232.75,698.25,233,698.5,233L780,233';
  assert.doesNotThrow(()=>assertForwardPaint(corrected,start,end));
  assert.throws(()=>assertForwardPaint('M615,232L697,232C697.5,232,698,232.5,698,233L698,232C698,232.5,698.5,233,699,233L780,233',start,end),/backtracking y/);
  assert.throws(()=>assertForwardPaint(corrected,{x:615,y:231},end));
  assert.throws(()=>assertForwardPaint(corrected,start,{x:780,y:232}));
  assert.throws(()=>assertForwardPaint('M615,232LNaN,233',start,end));
});

test('native paint oracle requires exact straight axes and bounded declared visible-UI cases',()=>{
  assert.doesNotThrow(()=>assertForwardPaint('M20.125,40.75L90.125,40.75',{x:20.125,y:40.75},{x:90.125,y:40.75}));
  assert.throws(()=>assertForwardPaint('M20.125,40.75L30,40.7501L90.125,40.75',{x:20.125,y:40.75},{x:90.125,y:40.75}),/aligned axis/);
  assert.equal(connectionPaintCases.length,6);assert.equal(new Set(connectionPaintCases.map(c=>c.id)).size,6);
  assert.ok(connectionPaintCases.every(c=>c.engine==='local'&&c.sample==='Empty diagram'&&typeof c.run==='function'));
});
