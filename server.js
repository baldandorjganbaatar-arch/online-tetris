"use strict";
const http=require("http");
const crypto=require("crypto");
const {WebSocketServer,WebSocket}=require("ws");
const PORT=Number(process.env.PORT||3000);
const MAX=10;
const clients=new Map();
let host=null,hostId=null,lastState=null,phase="lobby";
const server=http.createServer((req,res)=>{
 const path=new URL(req.url,"http://localhost").pathname;
 if(path==="/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,service:"online-tetris",players:clients.size,phase,host:!!host}))}
 res.writeHead(200,{"content-type":"text/plain"});res.end("Online Tetris WebSocket server is running.\n");
});
const wss=new WebSocketServer({server,path:"/ws"});
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function relayToHost(obj){send(host,obj)}
function electHost(){
 const next=[...clients.entries()].find(([ws,c])=>ws!==host&&c.joined&&!c.waiting);
 if(!next){host=null;hostId=null;phase="lobby";return}
 host=next[0];hostId=next[1].id;next[1].role="host";
 send(host,{type:"welcome",clientId:hostId,role:"host",state:lastState});
 for(const [ws,c] of clients){if(ws!==host&&c.joined&&!c.waiting)send(host,{type:"peer:join",peerId:c.id,name:c.name,token:c.token})}
}
function drop(ws){
 const c=clients.get(ws);if(!c)return;
 clients.delete(ws);
 if(c.joined&&ws!==host&&host)send(host,{type:"peer:left",peerId:c.id});
 if(ws===host){host=null;hostId=null;electHost()}
}
wss.on("connection",ws=>{
 const c={id:crypto.randomUUID(),name:"Player",token:"",joined:false,role:""};
 clients.set(ws,c);
 send(ws,{type:"connected",clientId:c.id,maxPlayers:MAX});
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw.toString())}catch{return send(ws,{type:"error",message:"Invalid JSON"})}
  if(m.type==="join"&&!c.joined){
   c.name=String(m.name||"Player").trim().slice(0,24)||"Player";c.token=String(m.token||"").slice(0,100);c.joined=true;
   if(!host){
    c.role="host";host=ws;hostId=c.id;phase="lobby";
    send(ws,{type:"welcome",clientId:c.id,role:"host",state:lastState});
   }else{
    const count=[...clients.values()].filter(x=>x.joined).length;
    if(count>MAX){clients.delete(ws);c.joined=false;return send(ws,{type:"error",message:"Нийтлэг тоглолт 10 хүнээр дүүрсэн."})}
    c.role="client";
    send(ws,{type:"welcome",clientId:c.id,role:"client"});
    send(host,{type:"peer:join",peerId:c.id,name:c.name,token:c.token});
   }
   return;
  }
  if(!c.joined)return send(ws,{type:"error",message:"Эхлээд JOIN хийнэ үү."});
  if(m.type==="toHost"&&ws!==host){send(host,{type:"peer:data",peerId:c.id,data:m.data});return}
  if(m.type==="toPeer"&&ws===host){const target=[...clients.entries()].find(([,x])=>x.id===m.peerId);if(target)send(target[0],{type:"peer:data",peerId:hostId,data:m.data});return}
  if(m.type==="hostState"&&ws===host){
   lastState=m.state||null;
   phase=lastState?.started?"playing":lastState?.over?"finished":"lobby";
   // Relay the authoritative host snapshot to every connected player.
   for(const [clientWs,client] of clients){
    if(clientWs!==host && client.joined && !client.waiting){
     send(clientWs,{type:"peer:data",peerId:hostId,data:{type:"state",data:lastState}});
    }
   }
   return;
  }
  if(m.type==="chat"){
   const item={name:c.name||"Тоглогч",text:String(m.text||"").trim().slice(0,180),at:Date.now()};
   if(!item.text)return;
   for(const [clientWs,client] of clients){
    if(client.joined)send(clientWs,{type:"chat",item});
   }
   return;
  }
  if(m.type==="ping")send(ws,{type:"pong",at:Date.now()});
 });
 ws.on("close",()=>drop(ws));ws.on("error",()=>drop(ws));
});
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue}ws.isAlive=false;ws.ping()}},25000);
wss.on("connection",ws=>{ws.isAlive=true;ws.on("pong",()=>ws.isAlive=true)});
server.listen(PORT,"0.0.0.0",()=>console.log("Online Tetris WebSocket server listening on "+PORT));
process.on("SIGTERM",()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.close(1001,"Server shutting down");server.close(()=>process.exit(0))});
