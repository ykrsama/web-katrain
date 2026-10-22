import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveFoxKomi} from '../src/utils/foxImport.ts';
test('encoded Fox komi must not silently become 375 points',()=>{
 assert.throws(()=>resolveFoxKomi('375',''),/confirm/);
});
test('an explicitly confirmed import copy can use 7.5 while the source token stays intact',()=>{
 const raw='375';assert.equal(resolveFoxKomi(raw,'7.5'),7.5);assert.equal(raw,'375');
});
test('ordinary SGF komi is not rewritten',()=>{
 assert.equal(resolveFoxKomi('6.5'),6.5);assert.equal(resolveFoxKomi('-0.5'),-0.5);
 assert.equal(resolveFoxKomi(undefined),undefined);
});
test('explicit zero komi is preserved',()=>assert.equal(resolveFoxKomi('375','0'),0));
test('non-finite and encoded explicit values are rejected',()=>{
 for(const value of ['Infinity','NaN','375','7.5abc'])assert.throws(()=>resolveFoxKomi('375',value),/valid komi/);
});
