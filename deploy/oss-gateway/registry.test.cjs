const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createServer,validateConfig}=require('./server.cjs');
test('sharded media signs only exact immutable entries and survives eviction',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'album-registry-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const version='a'.repeat(24);await fs.mkdir(path.join(dir,version));
 const config={endpoint:'https://oss-cn-beijing.aliyuncs.com',bucket:'demo-photo-planet',accessKeyId:'fixture',accessKeySecret:'fixture-secret',resources:{},chatPrefix:'chatData/releases/test/',chatPaths:[],mediaRegistry:version};
 assert.throws(()=>validateConfig({...config,mediaRegistry:'../escape'}));
 const routes=[];
 for(let i=0;i<12;i++){
  const prefix=i.toString(16).padStart(2,'0'),name=prefix+'a'.repeat(62)+'.webp';routes.push(name);
  await fs.writeFile(path.join(dir,version,prefix+'.json'),JSON.stringify({[name]:{key:'chatData/media/image/'+prefix+'/'+'b'.repeat(64)+'.webp'}}));
 }
 const server=await createServer({config,mediaIndexRoot:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 for(const name of [...routes,routes[0]]){
  const r=await fetch(base+'/media/chat-assets/'+name+'?resolve=1');assert.equal(r.status,200);const value=await r.json();assert.equal(new URL(value.url).hostname,'demo-photo-planet.oss-cn-beijing.aliyuncs.com');
 }
 assert.equal((await fetch(base+'/media/chat-assets/00'+'c'.repeat(62)+'.webp?resolve=1')).status,404);
 assert.equal((await fetch(base+'/media/chat-assets/'+routes[0]+'?key=photo/other',{redirect:'manual'})).status,302);
 await fs.writeFile(path.join(dir,version,'ff.json'),JSON.stringify({['ff'+'d'.repeat(62)+'.webp']:{key:'secrets/other'}}));
 assert.equal((await fetch(base+'/media/chat-assets/ff'+'d'.repeat(62)+'.webp?resolve=1')).status,502);
});
test('long recordings retain range access beyond the default five minute lifetime',async t=>{
 const stamp=1800000000000;
 const config={endpoint:'https://oss-cn-beijing.aliyuncs.com',bucket:'demo-photo-planet',accessKeyId:'fixture',accessKeySecret:'fixture-secret',resources:{
  'chat-assets/video.mp4':{key:'chatData/media/video/00/fixture.mp4'},
  'chat-assets/audio.m4a':{key:'chatData/media/audio/00/fixture.m4a'},
  'chat-assets/image.webp':{key:'chatData/media/image/00/fixture.webp'}
 },chatPrefix:'chatData/releases/test/',chatPaths:[]};
 const server=await createServer({config,now:()=>stamp});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 for(const [name,lifetime] of [['video.mp4',3600],['audio.m4a',3600],['image.webp',300]]){
  const value=await(await fetch(base+'/media/chat-assets/'+name+'?resolve=1&ttl=999999')).json();
  assert.equal(value.expiresAt,stamp/1000+lifetime);assert.equal(Number(new URL(value.url).searchParams.get('Expires')),value.expiresAt);
 }
});
