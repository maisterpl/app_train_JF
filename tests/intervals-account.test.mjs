import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAccount,saveAccount,removeAccount,KEY_PREFIX} from '../web/intervals-account.mjs';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('saved accounts are isolated by profile and can be removed',()=>{const store=storage(),a={id:'i1',name:'Test',key:'fake'};saveAccount('p1',a,store);assert.deepEqual(loadAccount('p1',store),a);assert.equal(loadAccount('p2',store),null);removeAccount('p1',store);assert.equal(loadAccount('p1',store),null);});
test('malformed storage ignored and storage errors reported',()=>{const store=storage();store.setItem(KEY_PREFIX+'p','bad json');assert.equal(loadAccount('p',store),null);store.setItem(KEY_PREFIX+'p','{}');assert.equal(loadAccount('p',store),null);assert.throws(()=>saveAccount('p',{}, {setItem(){throw Error('quota');}}),/quota/);});
