import toolchain from './javaToolchain.json';

let download;

export function loadJavaRuntimeAssets() {
  download ??= (async () => {
    const assets = {};
    for (const [name, expected] of Object.entries(toolchain.files)) {
      const response = await fetch('/__java-debugger__/' + name, { credentials: 'omit' });
      if (!response.ok) throw new Error('Java Debugger runtime is unavailable. Check the development setup.');
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== expected) throw new Error('Java Debugger asset checksum mismatch: ' + name);
      assets[name] = bytes;
    }
    return assets;
  })().catch(error => { download = undefined; throw error; });
  return download;
}
