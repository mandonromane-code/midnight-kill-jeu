const express=require('express'),http=require('http'),{Server}=require('socket.io'),crypto=require('crypto');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.static('public'));
const rooms=new Map(),ROUND=15*60*1000;
const makeCode=()=>{let c;do c=crypto.randomBytes(2).toString('hex').toUpperCase();while(rooms.has(c));return c};
function roles(n,k,j){let a=[...Array(k).fill('killer'),...Array(j).fill('judge'),...Array(n-k-j).fill('innocent')];for(let i=a.length-1;i;i--){let x=Math.floor(Math.random()*(i+1));[a[i],a[x]]=[a[x],a[i]]}return a}
function assign(r){let ps=[...r.players.values()],best=null;for(let q=0;q<100;q++){let a=roles(ps.length,r.settings.k,r.settings.j),p=ps.reduce((s,x,i)=>s+(r.last?.[x.id]===a[i]),0);if(!best||p<best.p)best={a,p};if(!p)break}r.last={};ps.forEach((x,i)=>{x.role=best.a[i];x.alive=true;r.last[x.id]=x.role})}
function pub(r){return{code:r.code,state:r.state,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,host:p.host})),settings:r.settings,round:r.round,startedAt:r.startedAt,endsAt:r.endsAt,winner:r.winner}}
function send(r){io.to(r.code).emit('room:update',pub(r))}function finish(r,w){if(r.state!=='playing')return;r.state='result';r.winner=w;r.startedAt=r.endsAt=null;send(r)}
function check(r){
 const players=[...r.players.values()];
 const killersAlive=players.some(p=>p.role==='killer'&&p.alive);
 const innocentsAlive=players.some(p=>p.role==='innocent'&&p.alive);
 if(!killersAlive) return finish(r,'survivors');
 if(!innocentsAlive) return finish(r,'killers');
}
io.on('connection',s=>{
 s.on('room:create',d=>{let name=String(d.name||'').trim().slice(0,24),n=+d.n,k=+d.k,j=+d.j,knife=d.knife;if(!name||n<3||n>20||k<1||j<0||k+j>=n||!['library','fridge','toilet'].includes(knife))return s.emit('error:msg','Paramètres invalides.');let c=makeCode(),r={code:c,state:'lobby',hostId:s.id,round:1,startedAt:null,endsAt:null,winner:null,last:null,settings:{n,k,j,knife},players:new Map};r.players.set(s.id,{id:s.id,name,host:true,role:null,alive:true});rooms.set(c,r);s.join(c);s.data.room=c;s.emit('room:created',{code:c});send(r)});
 s.on('room:join',d=>{let c=String(d.code||'').trim().toUpperCase(),name=String(d.name||'').trim().slice(0,24),r=rooms.get(c);if(!r)return s.emit('error:msg','Partie introuvable.');if(r.state!=='lobby')return s.emit('error:msg','Cette partie a déjà commencé.');if(!name)return s.emit('error:msg','Entre un pseudo.');if(r.players.size>=r.settings.n)return s.emit('error:msg','La partie est complète.');if([...r.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return s.emit('error:msg','Ce pseudo est déjà utilisé.');r.players.set(s.id,{id:s.id,name,host:false,role:null,alive:true});s.join(c);s.data.room=c;send(r)});
 s.on('game:start',()=>{let r=rooms.get(s.data.room);if(!r||s.id!==r.hostId)return;if(r.players.size!==r.settings.n)return s.emit('error:msg',`Il faut ${r.settings.n} joueurs pour lancer.`);assign(r);r.state='role';r.winner=null;r.startedAt=null;r.endsAt=null;for(let p of r.players.values())io.to(p.id).emit('role:show',{role:p.role,knife:r.settings.knife});send(r)});
 s.on('round:continue',()=>{let r=rooms.get(s.data.room);if(!r||s.id!==r.hostId||r.state!=='role')return;r.state='playing';r.startedAt=Date.now();r.endsAt=r.startedAt+ROUND;io.to(r.code).emit('round:started');send(r)});
 s.on('player:killed',()=>{let r=rooms.get(s.data.room),p=r&&r.players.get(s.id);if(!r||r.state!=='playing'||!p||!p.alive)return;p.alive=false;io.to(p.id).emit('player:dead');send(r);check(r)});
 s.on('next:game',()=>{let r=rooms.get(s.data.room);if(!r||s.id!==r.hostId||r.state!=='result')return;assign(r);r.state='role';r.round++;r.winner=null;r.startedAt=null;r.endsAt=null;for(let p of r.players.values())io.to(p.id).emit('role:show',{role:p.role,knife:r.settings.knife});send(r)});
 s.on('disconnect',()=>{let r=rooms.get(s.data.room);if(!r)return;if(r.state==='lobby'){r.players.delete(s.id);if(r.hostId===s.id){let n=r.players.values().next().value;if(n){r.hostId=n.id;n.host=true}}if(!r.players.size)rooms.delete(r.code);else send(r)}})
});
setInterval(()=>{for(let r of rooms.values())if(r.state==='playing'&&Date.now()>=r.endsAt)finish(r,[...r.players.values()].some(p=>p.role!=='killer'&&p.alive)?'survivors':'killers')},500);
server.listen(process.env.PORT||10000);
