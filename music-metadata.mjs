import https from 'node:https';
// Keep public metadata requests consistent in Node and Electron's main process.
// This endpoint uses no login cookie, application secret or certificate exception.
export function fetchMusicMetadata(url,{headers={},signal}={}){
 const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='music.163.com'||target.port||target.username||target.password||!target.pathname.startsWith('/api/search/'))throw Error('不支持的音乐资料地址');
 return new Promise((resolve,reject)=>{const request=https.get(target,{headers,signal},response=>{let bytes=0;const parts=[];response.on('data',part=>{bytes+=part.length;if(bytes>2*1024*1024){response.destroy(Error('歌曲资料超过大小限制'));return;}parts.push(part);});response.on('error',reject);response.on('end',()=>{const body=Buffer.concat(parts).toString('utf8');resolve({ok:response.statusCode===200,status:response.statusCode,json:async()=>JSON.parse(body)});});});request.setTimeout(15000,()=>request.destroy(Error('音乐搜索超时')));request.on('error',reject);});
}
