// Static replacements for TeaVM 0.16.0's JavaScript wrapper generation.
// No argument here is parsed or evaluated as JavaScript.
function argumentsForCall(args, count, variableArguments) {
  const fixedCount = variableArguments ? count - 1 : count;
  const result = Array.from({ length: fixedCount }, (_, index) => args[index]);
  if (variableArguments) result.push(args.slice(fixedCount));
  return result;
}

export function cspExportFunction(fn, variableArguments, rethrow, instanceMethod = false) {
  const count = fn.length - (instanceMethod ? 1 : 0);
  const wrapper = function (...args) {
    try {
      const parameters = argumentsForCall(args, count, variableArguments);
      if (instanceMethod) parameters.unshift(this);
      return fn(...parameters);
    } catch (error) { rethrow(error); }
  };
  Object.defineProperty(wrapper, 'length', { value: count - (variableArguments ? 1 : 0) });
  return wrapper;
}

export function cspConstructor(name, constructor) {
  const wrapper = function (marker, javaObject) {
    return constructor.call(this, marker, javaObject);
  };
  Object.defineProperty(wrapper, 'name', { value: name });
  return wrapper;
}

function globalPath(name) {
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) {
    throw new Error('Unsupported TeaVM global path');
  }
  const parts = name.split('.');
  if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error('Unsupported TeaVM global path');
  }
  return parts;
}

export function cspGetGlobal(name) {
  const [root, ...parts] = globalPath(name);
  if (!(root in globalThis)) throw new ReferenceError(root + ' is not defined');
  let value = globalThis[root];
  for (const part of parts) value = value[part];
  return value;
}

export function cspSetGlobal(name, value) {
  const parts = globalPath(name);
  let object = globalThis;
  for (const part of parts.slice(0, -1)) object = object[part];
  Reflect.set(object, parts.at(-1), value);
}

export function cspCallFunction(count, rethrow, fn, ...args) {
  try { return fn(...argumentsForCall(args, count, false)); }
  catch (error) { rethrow(error); }
}

export function cspCallMethod(count, rethrow, getGlobal, instance, name, ...args) {
  try {
    const parameters = argumentsForCall(args, count, false);
    if (instance !== null) return instance[name](...parameters);
    return getGlobal(name)(...parameters);
  } catch (error) { rethrow(error); }
}

export function cspConstruct(count, rethrow, constructor, ...args) {
  try { return Reflect.construct(constructor, argumentsForCall(args, count, false)); }
  catch (error) { rethrow(error); }
}

export function cspArray(count, ...args) {
  return argumentsForCall(args, count, false);
}

export function cspFunctionBody(_wrapCall, ...definition) {
  // These exact helpers come from the pinned, trusted compiler, not player code.
  // Unknown bodies fail closed. Runtime tanks keep their narrower identity-only hook.
  switch (JSON.stringify(definition)) {
    case '["return Object.create(null);"]': return () => Object.create(null);
    case '["array","return array;"]':
    case '["str","return str;"]':
    case '["value","return value;"]':
    case '["__this__","return __this__;"]':
    case '["number","return number;"]': return value => value;
    case '["size","return new Array(size);"]': return size => new Array(size);
    default: throw new Error('Unsupported static TeaVM JavaScript helper');
  }
}
