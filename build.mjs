import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.dirname(fileURLToPath(import.meta.url));
const dist=path.join(root,'dist');
await fs.mkdir(dist,{recursive:true});
// Resolve the small, vendored module graph explicitly, without probing user directories.
const localModules={name:'vendored-modules',setup(builder){
  builder.onResolve({filter:/.*/},args=>{
    let target;
    if(args.path==='three')target=path.join(root,'node_modules','three','build','three.module.js');
    else if(args.path.startsWith('three/addons/'))target=path.join(root,'node_modules','three','examples','jsm',args.path.substring(13));
    else if(args.kind==='entry-point')target=path.resolve(root,args.path);
    else if(args.path.startsWith('.'))target=path.resolve(path.dirname(args.importer),args.path);
    else throw new Error('Unexpected module dependency: '+args.path);
    if(!target.startsWith(root+path.sep))throw new Error('Module outside project: '+target);
    return {path:target,namespace:'vendored'};
  });
  builder.onLoad({filter:/.*/,namespace:'vendored'},async args=>({contents:await fs.readFile(args.path,'utf8'),loader:'js'}));
}};
const result=await build({absWorkingDir:root,entryPoints:['./viewer/viewer.js'],bundle:true,minify:true,format:'iife',target:['chrome100','safari15'],write:false,legalComments:'inline',tsconfigRaw:{},plugins:[localModules]});
const script=result.outputFiles[0].text.replaceAll('</script','<\\/script');
const [template,styles]=await Promise.all([fs.readFile(path.join(root,'viewer','index.template.html'),'utf8'),fs.readFile(path.join(root,'viewer','style.css'),'utf8')]);
const license=await fs.readFile(path.join(root,'node_modules','three','LICENSE'),'utf8');
const html=template.replace('__RV_BUNDLE_JS__',()=>script).replace('__RV_STYLES_CSS__',()=>styles)
  .replace('</head>',()=>`<!-- Bundled three.js license\n${license.replaceAll('--','—')}\n-->\n</head>`);
if(html.split('__RV_CONFIG_JSON__').length!==2)throw new Error('Template must have exactly one config placeholder');
if(html.includes('__RV_BUNDLE_JS__')||html.includes('__RV_STYLES_CSS__'))throw new Error('Unresolved bundle placeholders');
await fs.writeFile(path.join(dist,'ViewerTemplate.html'),html);
await fs.writeFile(path.join(dist,'index.html'),html.replace('__RV_CONFIG_JSON__',()=>JSON.stringify({title:'模型预览',modelBase64:'',fileName:''})));
console.log(JSON.stringify({template:path.join(dist,'ViewerTemplate.html'),bytes:Buffer.byteLength(html)}));
