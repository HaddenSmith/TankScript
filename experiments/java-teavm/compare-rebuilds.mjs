import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function sections(bytes){
  let offset=8;
  function leb(){let result=0,shift=0,byte;do{byte=bytes[offset++];result|=(byte&127)<<shift;shift+=7;if(shift>35)throw Error('Invalid Wasm section size');}while(byte&128);return result>>>0;}
  const result=[];
  while(offset<bytes.length){
    const id=bytes[offset++],length=leb(),start=offset,end=start+length;
    if(end>bytes.length)throw Error('Truncated Wasm');
    let name;
    if(id===0){const size=leb();name=bytes.subarray(offset,offset+size).toString('utf8');}
    result.push({id,name,bytes:length,sha256:hash(bytes.subarray(start,end))});offset=end;
  }
  return result;
}
const report={measuredAt:new Date().toISOString(),note:'Comparison only; working compiler and release pins are never modified.',sets:{}};
const pinned=JSON.parse(await readFile(new URL('../../frontend/src/game/tank-script/java/javaToolchain.json',import.meta.url)));
for(const [name,directory] of [['working','assets'],['first','rebuild-1'],['second','rebuild-2']]){
  const files={};
  for(const file of Object.keys(pinned.files)){
    const bytes=await readFile(new URL('./generated/'+directory+'/'+file,import.meta.url));
    files[file]={bytes:bytes.length,sha256:hash(bytes)};
    if(file==='compiler.wasm')files[file].sections=sections(bytes);
  }
  report.sets[name]=files;
}
report.repeatBuildMatches=Object.keys(pinned.files).every(file=>report.sets.first[file].sha256===report.sets.second[file].sha256);
report.matchesWorking=Object.keys(pinned.files).every(file=>report.sets.first[file].sha256===pinned.files[file]);
await writeFile(new URL('./results/rebuild-comparison.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({repeatBuildMatches:report.repeatBuildMatches,matchesWorking:report.matchesWorking}));
