'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FaceRuntime}=require('../application/face-runtime.cjs');
const {expressions}=require('../shared/expressions.json');

test('face application cycles in both directions and preserves interrupted transitions',()=>{
  const face=new FaceRuntime(),before=face.frame().pose;
  face.input({action:'rotate',direction:1});assert.deepEqual(face.frame().pose,before);
  face.advance(200);const middle=face.frame().pose;
  face.input({action:'rotate',direction:1});assert.deepEqual(face.frame().pose,middle);
  face.advance(450);assert.deepEqual(face.frame().pose,expressions[2].pose);
  for(let i=0;i<8;i++)face.input({action:'rotate',direction:1});
  face.advance(450);assert.deepEqual(face.frame().pose,expressions[2].pose);
  face.input({action:'rotate',direction:-1});face.advance(450);
  assert.deepEqual(face.frame().pose,expressions[1].pose);
  const saved=face.frame();assert.throws(()=>face.input({action:'rotate',direction:0}));assert.deepEqual(face.frame(),saved);
});
test('blink timing is owned by the application',()=>{
  const face=new FaceRuntime();face.input({action:'press'});face.advance(90);
  assert.equal(face.frame().effects.blink,1);face.advance(100);assert.equal(face.frame().effects.blink,0);
  face.advance(2900);assert.equal(face.frame().effects.blink,1);
});
