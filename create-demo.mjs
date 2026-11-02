import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
class FileReaderPolyfill{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onload?.();this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onload?.();this.onloadend?.();});}
}
globalThis.FileReader=FileReaderPolyfill;
const root=path.dirname(fileURLToPath(import.meta.url));
const scene=new THREE.Scene();
const object=new THREE.Group();object.name='曲面边几';scene.add(object);
const warm=new THREE.MeshStandardMaterial({name:'陶土橙',color:0xc26943,roughness:0.38,metalness:0.08});
const cream=new THREE.MeshStandardMaterial({name:'奶油白',color:0xe7d8bd,roughness:0.3,metalness:0.05});
const profile=[[0,1.22],[1.12,1.22],[1.19,1.24],[1.22,1.28],[1.22,1.33],[1.19,1.37],[1.12,1.39],[0,1.39]].map(p=>new THREE.Vector2(...p));
const top=new THREE.Mesh(new THREE.LatheGeometry(profile,96),cream);top.name='圆润桌面';object.add(top);
for(let i=0;i<3;i++){
 const angle=i*Math.PI*2/3;
 const points=[[0.92,0.09],[0.72,0.35],[0.38,0.75],[0.48,1.0],[0.82,1.23]].map(([r,y])=>new THREE.Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r));
 const curve=new THREE.CatmullRomCurve3(points);
 const leg=new THREE.Mesh(new THREE.TubeGeometry(curve,48,0.115,20,false),warm);leg.name='曲面桌腿 '+(i+1);object.add(leg);
 for(const p of [points[0],points[points.length-1]]){const cap=new THREE.Mesh(new THREE.SphereGeometry(0.115,20,12),warm);cap.position.copy(p);object.add(cap);}
}
const exporter=new GLTFExporter();
const binary=await exporter.parseAsync(scene,{binary:true,onlyVisible:true});
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist','demo.glb'),Buffer.from(binary));
const template=await fs.readFile(path.join(root,'dist','ViewerTemplate.html'),'utf8');
const config={title:'曲面边几 · 演示模型',modelBase64:Buffer.from(binary).toString('base64'),fileName:'曲面边几.glb'};
const json=JSON.stringify(config).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
await fs.writeFile(path.join(root,'dist','demo.html'),template.replace('__RV_CONFIG_JSON__',()=>json));
console.log(JSON.stringify({modelBytes:binary.byteLength,html:path.join(root,'dist','demo.html')}));
