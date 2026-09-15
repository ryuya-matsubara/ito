const $=id=>document.getElementById(id);
const views=["hostSetup","waiting","play","locked"];
const suggestions=["食べ物の人気度","怖いもの","欲しいもの","行ってみたい国","強そうな動物","うれしいプレゼント","住みたい場所","テンションが上がること"];
let ws,retryTimer,heartbeatTimer,retryCount=0,isResuming=false;
let state={roomCode:null,playerId:null,isHost:false,name:"",number:null,answer:"",players:[],phase:"LOBBY",topic:""};
function toast(m){const e=$("toast");e.textContent=m;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2600)}
function show(id){views.forEach(v=>$(v).classList.toggle("hidden",v!==id))}
function busy(b,on){b.disabled=on;b.dataset.label??=b.textContent;b.textContent=on?"通信中…":b.dataset.label}
function send(action,data={}){if(!ws||ws.readyState!==WebSocket.OPEN){toast("再接続中です");return false}ws.send(JSON.stringify({action,...data}));return true}
function getName(){const n=$("name").value.trim();if(!n)toast("名前を入力してください");return n}
function newPlayerId(){return crypto.randomUUID?.()||String(Date.now())+"-"+Math.random()}
function saveSession(){sessionStorage.setItem("ito-session",JSON.stringify({roomCode:state.roomCode,playerId:state.playerId,name:state.name}))}
function startHeartbeat(){clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)send("ping")},240000)}
function connect(onOpen){
  const url=window.ITO_CONFIG?.websocketUrl;
  if(!url){toast("AWSバックエンドが未設定です");["create","join"].forEach(x=>busy($(x),false));return}
  if(ws&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(ws.readyState))return;
  ws=new WebSocket(url);
  ws.onopen=()=>{retryCount=0;startHeartbeat();if(onOpen)onOpen();else resumeSession()};
  ws.onmessage=e=>handle(JSON.parse(e.data));ws.onerror=()=>{};
  ws.onclose=()=>{clearInterval(heartbeatTimer);if(!state.roomCode)return;$("status").textContent="再接続中…";retryTimer=setTimeout(()=>connect(),Math.min(1000*2**retryCount++,10000))};
}
function resumeSession(){if(!state.roomCode||!state.playerId)return;isResuming=true;send("resumeRoom",{roomCode:state.roomCode,playerId:state.playerId})}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function renderPlayers(){$("players").innerHTML=state.players.map(p=>'<span class="player '+(p.isHost?"host ":"")+(p.ready?"ready":"")+'">'+esc(p.name)+'</span>').join("")}
function update(x){
  Object.assign(state,x);$("code").textContent=state.roomCode;
  $("status").textContent=state.phase==="LOBBY"?state.players.length+"人が参加中":state.players.filter(p=>p.ready).length+" / "+state.players.length+"人が回答済み";renderPlayers();
  if(["LOBBY","TOPIC"].includes(state.phase)){show(state.isHost?"hostSetup":"waiting");$("start").textContent=state.phase==="TOPIC"?"このお題で始める":"ゲーム開始"}
  if(state.phase==="PLAYING"){show("play");$("topicDisplay").textContent=state.topic;$("closedCard").classList.remove("hidden");$("reveal").classList.remove("hidden");$("revealedArea").classList.add("hidden");$("answer").value="";state.answer=""}
  if(["LOCKED","OPENED"].includes(state.phase)){show("locked");$("lockedName").textContent=state.name;$("lockedAnswer").textContent=state.answer;$("readyCount").textContent=state.players.filter(p=>p.ready).length+" / "+state.players.length+"人が決定";const all=state.players.length>1&&state.players.every(p=>p.ready);$("open").classList.toggle("hidden",!state.isHost||!all||state.phase==="OPENED");$("lineupHint").classList.toggle("hidden",state.phase==="OPENED");$("openedNumber").classList.toggle("hidden",state.phase!=="OPENED");if(state.phase==="OPENED")$("openedNumber").textContent=state.number;$("next").classList.toggle("hidden",!state.isHost||state.phase!=="OPENED")}
}
function enterRoom(m){$("home").classList.add("hidden");$("room").classList.remove("hidden");Object.assign(state,{isHost:m.isHost,name:m.name,playerId:m.playerId||state.playerId,roomCode:m.roomCode||state.roomCode,number:m.number??state.number,answer:m.answer??state.answer});saveSession()}
function handle(m){
  ["create","join","start","submit"].forEach(x=>busy($(x),false));
  if(m.type==="error"){if(isResuming){isResuming=false;sessionStorage.removeItem("ito-session");state.roomCode=null;$("room").classList.add("hidden");$("home").classList.remove("hidden");toast("ルームに復帰できませんでした")}else toast(m.message);return}
  if(["created","joined","resumed"].includes(m.type)){enterRoom(m);isResuming=false;if(m.type==="resumed")toast("再接続しました")}
  if(m.type==="number"){state.number=m.number;$("closedCard").classList.add("hidden");$("reveal").classList.add("hidden");$("revealedArea").classList.remove("hidden");$("numberCard").textContent=m.number}
  if(m.type==="opened")update({phase:"OPENED"});if(m.type==="state")update(m.state);
}
$("create").onclick=()=>{const name=getName();if(!name)return;const playerId=newPlayerId();busy($("create"),true);connect(()=>send("createRoom",{name,playerId}))};
$("join").onclick=()=>{const name=getName(),roomCode=$("roomCode").value.trim();if(!name)return;if(!/^\d{4}$/.test(roomCode))return toast("4桁の数字を入力してください");const playerId=newPlayerId();busy($("join"),true);connect(()=>send("joinRoom",{name,roomCode,playerId}))};
$("copy").onclick=async()=>{await navigator.clipboard.writeText(state.roomCode);toast("コピーしました")};
$("start").onclick=()=>{const topic=$("topic").value.trim();if(!topic)return toast("お題を入力してください");busy($("start"),true);send("startGame",{topic})};
$("reveal").onclick=()=>send("revealNumber");
$("submit").onclick=()=>{const answer=$("answer").value.trim();if(!answer)return toast("回答を入力してください");state.answer=answer;busy($("submit"),true);send("submitAnswer",{answer})};
$("open").onclick=()=>send("openCards");$("next").onclick=()=>send("nextRound");
$("roomCode").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,4);
suggestions.forEach(x=>{const b=document.createElement("button");b.className="chip";b.textContent=x;b.onclick=()=>$("topic").value=x;$("topicSuggestions").appendChild(b)});
const saved=JSON.parse(sessionStorage.getItem("ito-session")||"null");
if(saved?.roomCode&&saved?.playerId){Object.assign(state,saved);$("home").classList.add("hidden");$("room").classList.remove("hidden");$("code").textContent=state.roomCode;$("status").textContent="再接続中…";connect()}
