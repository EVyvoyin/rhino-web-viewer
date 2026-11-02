import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const types={'.html':'text/html; charset=utf-8','.glb':'model/gltf-binary','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
   const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const candidate=path.resolve(root,'.'+(requestPath==='/'?'/demo.html':requestPath));
   if(!candidate.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   const data=await fs.readFile(candidate);
   res.writeHead(200,{'Content-Type':types[path.extname(candidate)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(43187,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:43187/demo.html'));
