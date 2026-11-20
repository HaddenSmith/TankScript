import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as stock from './generated/assets/compiler.wasm-runtime.js';
import * as patched from './generated/assets/compiler.csp-runtime.js';

function host(loader) {
  const imports = {};
  const context = loader.defaults(imports, {}, true);
  context.supplyExports({
    'teavm.js.wrapException': error => error,
    'teavm.js.throwException': error => { throw error; },
  });
  return imports.teavmJso;
}
const original = host(stock);
const csp = host(patched);
function arity(fn, count) { Object.defineProperty(fn, 'length', { value: count }); return fn; }

for (let count = 0; count < 32; count++) {
  test('static call/construct/array helpers match stock at arity ' + count, () => {
    const fn = (...args) => args;
    const instance = { marker: true, method(...args) { return { marker:this.marker, args }; } };
    class Value { constructor(...args) { this.args = args; } }
    for (const length of [Math.max(0,count-1), count, count+2]) {
      const args = Array.from({ length }, (_, index) => index + 1);
      for (const [method, prefix] of [['callFunction',[fn]],['callMethod',[instance,'method']],['construct',[Value]],['arrayOf',[]]]) {
        assert.deepEqual(csp[method+count](...prefix,...args), original[method+count](...prefix,...args));
      }
    }
    const failure = new Error('test helper error');
    assert.throws(() => csp['callFunction'+count](() => { throw failure; }), error => error === failure);
  });
  test('static exported wrappers match stock at arity ' + count, () => {
    for (const variableArguments of count ? [false,true] : [false]) {
      const fn = arity((...args) => args,count);
      const actual = csp.defineFunction(fn,variableArguments);
      const expected = original.defineFunction(fn,variableArguments);
      assert.equal(actual.length,expected.length);
      for (const length of [Math.max(0,count-1),count,count+2]) {
        const args=Array.from({length},(_,index)=>index);
        assert.deepEqual(actual(...args),expected(...args));
      }
      const failure = new Error('test export error');
      assert.throws(() => csp.defineFunction(arity(() => { throw failure; },count),variableArguments)(), error=>error===failure);
    }
  });
  test('static instance method wrappers preserve receiver at arity ' + count, () => {
    for (const variableArguments of count ? [false,true] : [false]) {
      function Actual() {}
      function Expected() {}
      const fn=arity((...args)=>args,count+1);
      csp.defineMethod(Actual,'method',fn,variableArguments);
      original.defineMethod(Expected,'method',fn,variableArguments);
      const actual=new Actual(),expected=new Expected();
      for(const length of [Math.max(0,count-1),count,count+2]) {
        const args=Array.from({length},(_,index)=>index);
        const result=actual.method(...args),reference=expected.method(...args);
        assert.equal(result[0],actual);
        assert.deepEqual(result.slice(1),reference.slice(1));
      }
    }
  });
}
test('JSO constructors preserve names, prototypes and Java object wrapping',()=>{
  for(const runtime of [original,csp]) {
    const Base=runtime.createClass('Base',null,null);
    const Derived=runtime.createClass('Derived',Base,null);
    const javaObject={dummy:true};
    const value=new Derived(javaObject);
    assert.equal(Derived.name,'Derived');
    assert.ok(value instanceof Base && value instanceof Derived);
    assert.equal(runtime.unwrapJavaObject(value),javaObject);
  }
});
test('global operations use property paths and reject JavaScript expressions',()=>{
  assert.equal(csp.global('Math.PI'),Math.PI);
  assert.throws(()=>csp.global('tankscriptMissingGlobal'),ReferenceError);
  assert.throws(()=>patched.cspGetGlobal('(() => 42)()'),/Unsupported TeaVM global path/);
  assert.throws(()=>patched.cspGetGlobal('Object.constructor'),/Unsupported TeaVM global path/);
  globalThis.teavmCspTest={value:1};
  try {
    patched.cspSetGlobal('teavmCspTest.value',2);
    assert.equal(globalThis.teavmCspTest.value,2);
    patched.cspSetGlobal('Math.PI',0);
    assert.equal(Math.PI,Math.acos(-1));
  } finally { delete globalThis.teavmCspTest; }
});
test('the pinned compiler inventory needs only fixed harmless helpers',async()=>{
  const inventory=JSON.parse(await readFile(new URL('./generated/compiler-js-bodies.json',import.meta.url),'utf8'));
  assert.equal(new Set(inventory.map(definition=>JSON.stringify(definition))).size,7);
  for(const definition of inventory) assert.equal(typeof patched.cspFunctionBody(null,...definition),'function');
  const object=patched.cspFunctionBody(null,'return Object.create(null);')();
  assert.equal(Object.getPrototypeOf(object),null);
  assert.equal(patched.cspFunctionBody(null,'size','return new Array(size);')(3).length,3);
  assert.throws(()=>patched.cspFunctionBody(null,'return fetch("/probe");'),/Unsupported static TeaVM/);
  assert.throws(()=>patched.cspFunctionBody(null,'str','return eval(str);'),/Unsupported static TeaVM/);
});
