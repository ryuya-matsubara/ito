import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {DynamoDBDocumentClient,GetCommand,PutCommand,DeleteCommand,UpdateCommand} from "@aws-sdk/lib-dynamodb";
import {ApiGatewayManagementApiClient,PostToConnectionCommand} from "@aws-sdk/client-apigatewaymanagementapi";
import {randomInt,randomUUID} from "node:crypto";
const db=DynamoDBDocumentClient.from(new DynamoDBClient({})),TableName=process.env.TABLE_NAME;
const clean=(v,max)=>String(v??"").trim().slice(0,max),roomKey=code=>({TableName,Key:{pk:"ROOM#"+code}}),connKey=id=>({TableName,Key:{pk:"CONN#"+id}});
const getRoom=async code=>(await db.send(new GetCommand(roomKey(code)))).Item,getConn=async id=>(await db.send(new GetCommand(connKey(id)))).Item,saveRoom=room=>db.send(new PutCommand({TableName,Item:room}));
async function send(client,id,data){if(!id)return;try{await client.send(new PostToConnectionCommand({ConnectionId:id,Data:Buffer.from(JSON.stringify(data))}))}catch(e){if(e.$metadata?.httpStatusCode!==410)console.error(e)}}
const visiblePlayers=room=>room.players.filter(p=>p.connected);
function publicState(room,viewerId){const me=room.players.find(p=>p.id===viewerId);return{roomCode:room.code,phase:room.phase==="PLAYING"&&me?.answer?"LOCKED":room.phase,topic:room.topic||"",isHost:room.hostPlayerId===me?.playerId,players:visiblePlayers(room).map(p=>({name:p.name,isHost:p.playerId===room.hostPlayerId,ready:!!p.answer}))}}
const broadcast=(room,client)=>Promise.all(visiblePlayers(room).map(p=>send(client,p.id,{type:"state",state:publicState(room,p.id)})));
async function disconnect(id,client){const conn=await getConn(id);if(!conn)return;const room=await getRoom(conn.roomCode);if(room){const player=room.players.find(p=>p.playerId===conn.playerId);if(player?.id===id){player.id=null;player.connected=false;await saveRoom(room);await broadcast(room,client)}}await db.send(new DeleteCommand(connKey(id)))}
function numbers(count){const a=Array.from({length:100},(_,i)=>i+1);for(let i=99;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,count)}
function requireHost(room,player){if(room.hostPlayerId!==player.playerId)throw new Error("ゲームマスターだけが操作できます")}
async function bind(id,room,player){player.id=id;player.connected=true;await saveRoom(room);await db.send(new PutCommand({TableName,Item:{pk:"CONN#"+id,roomCode:room.code,playerId:player.playerId,expiresAt:room.expiresAt}}))}
export async function handler(event){
  const id=event.requestContext.connectionId,route=event.requestContext.routeKey,client=new ApiGatewayManagementApiClient({endpoint:"https://"+event.requestContext.domainName+"/"+event.requestContext.stage});
  if(route==="$connect")return{statusCode:200};if(route==="$disconnect"){await disconnect(id,client);return{statusCode:200}}
  let body={};try{body=JSON.parse(event.body||"{}")}catch{return{statusCode:400}}
  try{
    if(route==="createRoom"){
      const name=clean(body.name,12),playerId=clean(body.playerId,64)||randomUUID();if(!name)throw new Error("名前を入力してください");
      let code;for(let i=0;i<20;i++){const candidate=String(randomInt(10000)).padStart(4,"0");if(!await getRoom(candidate)){code=candidate;break}}if(!code)throw new Error("ルームを作成できませんでした");
      const expiresAt=Math.floor(Date.now()/1000)+21600,player={id,playerId,name,number:null,answer:"",connected:true},room={pk:"ROOM#"+code,code,hostPlayerId:playerId,phase:"LOBBY",topic:"",players:[player],expiresAt};
      await saveRoom(room);await db.send(new PutCommand({TableName,Item:{pk:"CONN#"+id,roomCode:code,playerId,expiresAt}}));await send(client,id,{type:"created",isHost:true,name,playerId,roomCode:code});await broadcast(room,client);
    }else if(route==="joinRoom"){
      const code=clean(body.roomCode,4),name=clean(body.name,12),playerId=clean(body.playerId,64)||randomUUID(),room=await getRoom(code);
      if(!room)throw new Error("ルームが見つかりません");if(room.phase!=="LOBBY")throw new Error("このルームはゲーム中です");if(visiblePlayers(room).length>=20)throw new Error("上限は20人です");if(!name)throw new Error("名前を入力してください");if(room.players.some(p=>p.name===name))throw new Error("同じ名前が使われています");
      room.players.push({id,playerId,name,number:null,answer:"",connected:true});await saveRoom(room);await db.send(new PutCommand({TableName,Item:{pk:"CONN#"+id,roomCode:code,playerId,expiresAt:room.expiresAt}}));await send(client,id,{type:"joined",isHost:false,name,playerId,roomCode:code});await broadcast(room,client);
    }else if(route==="resumeRoom"){
      const code=clean(body.roomCode,4),playerId=clean(body.playerId,64),room=await getRoom(code),player=room?.players.find(p=>p.playerId===playerId);
      if(!room||!player)throw new Error("復帰できるルームが見つかりません");if(player.id&&player.id!==id)await db.send(new DeleteCommand(connKey(player.id)));
      await bind(id,room,player);await send(client,id,{type:"resumed",isHost:room.hostPlayerId===playerId,name:player.name,playerId,roomCode:code,number:player.number,answer:player.answer});await broadcast(room,client);
    }else{
      const conn=await getConn(id);if(!conn)throw new Error("ルームに入り直してください");const room=await getRoom(conn.roomCode);if(!room)throw new Error("ルームの有効期限が切れました");const player=room.players.find(p=>p.playerId===conn.playerId&&p.id===id);if(!player)throw new Error("プレイヤーが見つかりません");
      if(route==="ping")await send(client,id,{type:"pong"});
      else if(route==="startGame"){requireHost(room,player);room.players=visiblePlayers(room);if(room.players.length<2)throw new Error("2人以上で遊んでください");const topic=clean(body.topic,40);if(!topic)throw new Error("お題を入力してください");const nums=numbers(room.players.length);room.players.forEach((p,i)=>{p.number=nums[i];p.answer=""});room.topic=topic;room.phase="PLAYING";await saveRoom(room);await broadcast(room,client)}
      else if(route==="revealNumber"){if(room.phase!=="PLAYING"||player.answer)throw new Error("今は数字を見られません");await send(client,id,{type:"number",number:player.number})}
      else if(route==="submitAnswer"){if(room.phase!=="PLAYING")throw new Error("回答受付中ではありません");const answer=clean(body.answer,30);if(!answer)throw new Error("回答を入力してください");const index=room.players.findIndex(p=>p.playerId===player.playerId);let updated;try{updated=(await db.send(new UpdateCommand({TableName,Key:{pk:room.pk},UpdateExpression:"SET players["+index+"].answer = :answer",ConditionExpression:"players["+index+"].id = :id AND #phase = :playing",ExpressionAttributeNames:{"#phase":"phase"},ExpressionAttributeValues:{":answer":answer,":id":id,":playing":"PLAYING"},ReturnValues:"ALL_NEW"}))).Attributes}catch(e){if(e.name==="ConditionalCheckFailedException")throw new Error("状態が更新されました。もう一度お試しください");throw e}await broadcast(updated,client)}
      else if(route==="openCards"){requireHost(room,player);if(!visiblePlayers(room).every(p=>p.answer))throw new Error("まだ回答していない人がいます");room.phase="OPENED";await saveRoom(room);await Promise.all(visiblePlayers(room).map(p=>send(client,p.id,{type:"opened"})));await broadcast(room,client)}
      else if(route==="nextRound"){requireHost(room,player);room.phase="TOPIC";room.topic="";room.players.forEach(p=>{p.number=null;p.answer=""});await saveRoom(room);await broadcast(room,client)}
      else throw new Error("不明な操作です");
    }
  }catch(e){console.error(e);await send(client,id,{type:"error",message:e.message||"エラーが発生しました"})}
  return{statusCode:200};
}
