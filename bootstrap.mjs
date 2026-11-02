import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const dependencies=[['three','0.180.0'],['esbuild','0.25.10'],['@esbuild/win32-x64','0.25.10']];
await fs.mkdir(path.join(root,'downloads'),{recursive:true});
for(const [name,version] of dependencies){
  const target=path.join(root,'node_modules',name);
  try{const old=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));if(old.version===version){console.log(`${name}@${version} already prepared`);continue;}}catch{}
  const metaResponse=await fetch(`https://registry.npmjs.org/${name}/${version}`,{signal:AbortSignal.timeout(30000)});
  if(!metaResponse.ok)throw new Error(`Metadata failed: ${name} ${metaResponse.status}`);
  const meta=await metaResponse.json();
  const response=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Download failed: ${name} ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  if(integrity!==meta.dist.integrity)throw new Error(`Integrity failed: ${name}`);
  const archive=path.join(root,'downloads',name.replaceAll('/','-').replace('@','')+'.tgz');
  await fs.writeFile(archive,bytes);
  await fs.mkdir(target,{recursive:true});
  execFileSync('tar.exe',['-xzf',archive,'--strip-components','1','-C',target],{stdio:'pipe'});
  console.log(`${name}@${version}: verified and extracted (${bytes.length} bytes)`);
}
