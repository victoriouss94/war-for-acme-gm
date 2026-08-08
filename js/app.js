const LEGACY_STORAGE_KEY='gm_command_center_generic_v3';
const GAME_INDEX_KEY='gm_command_center_games_v4';
const GAME_DATA_PREFIX='gm_command_center_game_v4:';
const CLOUD_PENDING_KEY='gm_command_center_cloud_pending_v5';
const priorityMap={'Block':10,'Control / Swap':20,'Protection':30,'Investigation':40,'Kill / Harmful':50,'Save / Heal':60,'Other':70};
const validStatuses=new Set(['SETUP','ACTIVE','PAUSED','COMPLETED','ARCHIVED']);
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const normalized=(value='')=>String(value).trim().toLowerCase();
const $=elementId=>document.getElementById(elementId);
const esc=(value='')=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const standardAbilities=()=>[
  ['Basic Ask','Investigation','Receives a basic piece of information about the targeted player, usually their broad faction or alignment.','Night','investigation, alignment'],
  ['Advanced Ask','Investigation','Receives more detailed information about the targeted player than a Basic Ask, according to the game’s configured investigation results.','Night','investigation, role'],
  ['Alignment Ask','Investigation','Learns the targeted player’s current faction class or configured alignment result.','Night','investigation, alignment'],
  ['Role Check','Investigation','Learns the targeted player’s role or the role result configured for that player.','Night','investigation, role'],
  ['Watch','Investigation','Learns which players visited the selected target during the phase.','Night','investigation, visitor'],
  ['Track','Investigation','Learns which player or players the selected target visited during the phase.','Night','investigation, visitor'],
  ['Visitor Check','Investigation','Determines whether the selected player visited anyone during the phase and may reveal the destination when configured.','Night','investigation, visitor'],
  ['Gravedigger','Investigation','Receives configured information about a dead player, such as their role, faction, actions, or visitors.','Night','investigation, dead player'],
  ['Map','Investigation','Receives location, grouping, proximity, or movement information defined by the game’s map rules.','Night','investigation, location'],
  ['Regular Kill','Harmful','Attempts to kill the targeted player using the game’s standard attack strength and can be stopped by compatible protection.','Night','kill, harmful'],
  ['Instant Kill','Harmful','Immediately attempts to kill the targeted player at the configured instant-kill strength.','Any','kill, harmful'],
  ['Super Kill','Harmful','A powerful kill that bypasses ordinary protection unless a rule specifically protects against Super Kills.','Any','kill, bypass'],
  ['Omega Kill','Harmful','The highest standard kill tier, bypassing ordinary and enhanced protection unless an explicit Omega defense applies.','Any','kill, bypass'],
  ['Poison','Harmful','Applies a delayed harmful status that kills or damages the target after the configured delay unless removed.','Night','delayed, status, kill'],
  ['Mark','Harmful','Places a mark on the target for a later effect, trigger, bonus, or execution defined by the ability.','Night','status, delayed'],
  ['Duel / Fight','Harmful','Forces two participants into a contest whose winner, loser, and consequences follow the configured duel rules.','Any','contest, kill'],
  ['Roleblock','Control','Prevents the targeted player’s compatible active actions from executing during the current phase.','Night','block, control'],
  ['Redirect','Control','Changes an action’s intended target to another valid target according to the redirect rules.','Night','control, target'],
  ['Swap','Control','Exchanges two players or targets for compatible actions during the phase.','Night','control, target'],
  ['Drunk','Communication','Restricts the targeted player to the configured drunk communication method, such as GIFs, stickers, or emojis only.','Any','communication, restriction'],
  ['Sober','Communication','Restricts the targeted player to text-only communication under the game’s configured rules.','Any','communication, restriction'],
  ['Silence','Communication','Prevents or limits the targeted player’s communication for the configured period.','Any','communication, restriction'],
  ['Protect','Protection','Prevents one or more compatible harmful actions from affecting the selected target, according to its configured strength and limits.','Night','protection, kill'],
  ['Guard','Protection','Defends a selected player and may intercept, absorb, retaliate against, or otherwise respond to attacks as configured.','Night','protection, interception'],
  ['Save','Protection','Prevents a pending death or removes the target from a lethal outcome when the save conditions are met.','Night','protection, death'],
  ['Heal','Protection','Removes compatible damage, poison, injury, or harmful statuses and may prevent a resulting death.','Night','protection, cleanse'],
  ['Death Immunity','Passive','Prevents the player from dying to the kill types covered by the immunity while it is active.','Passive','immunity, death'],
  ['Bulletproof / Passive Immunity','Passive','Automatically survives compatible attacks without requiring an active selection, subject to its uses and bypass rules.','Passive','immunity, kill'],
  ['Reflection','Protection','Returns a compatible action to its source or another configured target instead of allowing it to affect the original target.','Night','protection, redirect'],
  ['Counterattack','Passive','Triggers a retaliatory harmful action when the player is targeted under the configured conditions.','Passive','reaction, kill'],
  ['Ability Amplify','Support','Increases the strength, number of targets, duration, or effect of a compatible ability for the configured period.','Night','support, boost'],
  ['Additional Uses','Support','Grants one or more extra uses of a compatible limited-use ability.','Any','support, uses'],
  ['Action Success Guarantee','Support','Causes a compatible selected action to succeed against ordinary failure, blocking, or chance conditions unless explicitly bypassed.','Night','support, success'],
  ['Conversion','Control','Changes the targeted player’s faction, team, role relationship, or win condition according to the conversion rules.','Night','faction, recruitment'],
  ['Recruit','Control','Invites or forces a valid target to join the acting faction or group under the configured recruitment conditions.','Night','faction, recruitment']
].map(([name,category,definition,phase,mechanics])=>({id:id(),name,defaultName:name,category,definition,phase,mechanics:mechanics.split(',').map(item=>item.trim()),builtIn:true,revisions:[]}));

function gameDataKey(gameId){return GAME_DATA_PREFIX+gameId}
function option(value,label=value){const element=document.createElement('option');element.value=value;element.textContent=label;return element}
function formatDate(value){if(!value)return '—';return new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value))}
function formatDateTime(value){if(!value)return 'Never';return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function baseGameData(gameId){
  return {version:4,gameId,lastSavedAt:null,settings:{labels:{VILLAGER:'Villagers',DEN:'Den',NEUTRAL:'Neutrals'},allowMultiDen:true,roleEditingAuthorized:true},factions:[
    {id:id(),gameId,name:'Villagers',class:'VILLAGER',alias:'village',teamNumber:1},
    {id:id(),gameId,name:'Den',class:'DEN',alias:'den',teamNumber:1},
    {id:id(),gameId,name:'Neutrals',class:'NEUTRAL',alias:'neutral',teamNumber:1}
  ],roles:[],players:[],actions:[],rules:[],abilities:standardAbilities().map(ability=>({...ability,gameId})),history:[]};
}
function normalizeRole(role,gameId){
  const createdAt=role.createdAt||now();
  return {...role,gameId,name:String(role.name||'Untitled Role'),factionId:role.factionId||'',alignment:String(role.alignment||''),description:String(role.description||''),activeAbilityId:role.activeAbilityId||'',passiveAbilityId:role.passiveAbilityId||'',tags:Array.isArray(role.tags)?[...new Set(role.tags.filter(tag=>typeof tag==='string'&&tag.trim()))]:[],abilityUses:role.abilityUses===''||role.abilityUses==null?null:Math.max(0,Number(role.abilityUses)||0),cooldowns:String(role.cooldowns||''),immunities:Array.isArray(role.immunities)?role.immunities:[],restrictions:Array.isArray(role.restrictions)?role.restrictions:[],winCondition:String(role.winCondition||''),notes:String(role.notes||''),gmNotes:String(role.gmNotes||''),labels:Array.isArray(role.labels)?role.labels:[],enabled:role.enabled!==false,archivedAt:role.archivedAt||null,version:Math.max(1,Number(role.version)||1),createdAt,updatedAt:role.updatedAt||createdAt,updatedBy:role.updatedBy||null};
}
function normalizeRule(rule,gameId,index=0){
  const createdAt=rule.createdAt||now();
  return {...rule,id:rule.id||id(),gameId,title:String(rule.title||'Untitled Rule'),description:String(rule.description||''),category:String(rule.category||'General'),sortOrder:Number.isFinite(Number(rule.sortOrder))?Number(rule.sortOrder):index,visibility:rule.visibility==='gm'?'gm':'public',enabled:rule.enabled!==false,notes:String(rule.notes||''),version:Math.max(1,Number(rule.version)||1),createdAt,updatedAt:rule.updatedAt||createdAt,updatedBy:rule.updatedBy||null};
}
function migrateGameData(input,gameId){
  const data=input&&typeof input==='object'?input:{};
  const base=baseGameData(gameId);
  const settings={...base.settings,...(data.settings||{}),labels:{...base.settings.labels,...(data.settings?.labels||{})}};
  const withGameId=list=>(Array.isArray(list)?list:[]).map(record=>({...record,gameId}));
  const factions=withGameId(Array.isArray(data.factions)?data.factions:base.factions);
  const roles=withGameId(data.roles).map(role=>normalizeRole(role,gameId));
  const players=withGameId(data.players);
  const actions=withGameId(data.actions);
  let abilities=Array.isArray(data.abilities)&&data.abilities.length?withGameId(data.abilities):base.abilities;
  const templates=standardAbilities();
  abilities=abilities.map(ability=>{
    const revisions=Array.isArray(ability.revisions)?ability.revisions:[];
    const template=ability.builtIn?templates.find(item=>[ability.defaultName,ability.name,...revisions.map(revision=>revision.name)].some(name=>normalized(name)===normalized(item.name))):null;
    return {...ability,gameId,defaultName:ability.builtIn?(ability.defaultName||template?.name||ability.name):undefined,mechanics:Array.isArray(ability.mechanics)?ability.mechanics:[],revisions};
  });
  const rules=withGameId(data.rules).map((rule,index)=>normalizeRule(rule,gameId,index));
  return {version:5,gameId,lastSavedAt:data.lastSavedAt||null,settings,factions,roles,players,actions,rules,abilities,history:withGameId(data.history)};
}
function normalizeMeta(meta){
  const createdAt=meta.createdAt||now();
  return {id:meta.id||id(),name:String(meta.name||'Untitled Game'),theme:String(meta.theme||''),description:String(meta.description||''),status:validStatuses.has(meta.status)?meta.status:'SETUP',startingDay:Number(meta.startingDay)===1?1:0,currentDay:Math.max(0,Number(meta.currentDay)||0),currentPhase:meta.currentPhase==='Night'?'Night':'Day',notes:String(meta.notes||''),createdAt,updatedAt:meta.updatedAt||createdAt,lastSavedAt:meta.lastSavedAt||null,playerCount:Math.max(0,Number(meta.playerCount)||0),shareCode:meta.shareCode||meta.share_code||'',memberRole:meta.memberRole||meta.member_role||'owner'};
}
function saveIndex(){localStorage.setItem(GAME_INDEX_KEY,JSON.stringify(gameIndex))}
function loadGameIndex(){
  try{
    const saved=JSON.parse(localStorage.getItem(GAME_INDEX_KEY));
    if(saved&&Array.isArray(saved.games))return {version:4,activeGameId:saved.activeGameId||null,games:saved.games.map(normalizeMeta)};
  }catch{}
  const empty={version:4,activeGameId:null,games:[]};
  try{
    const legacyRaw=localStorage.getItem(LEGACY_STORAGE_KEY);
    if(!legacyRaw)return empty;
    const legacy=JSON.parse(legacyRaw),gameId=id(),createdAt=now();
    const meta=normalizeMeta({id:gameId,name:legacy.settings?.gameName||'Existing Game',status:'SETUP',createdAt,updatedAt:createdAt,currentDay:0,currentPhase:'Day',playerCount:Array.isArray(legacy.players)?legacy.players.length:0});
    const migrated=migrateGameData(legacy,gameId);
    migrated.history.push({id:id(),gameId,type:'MIGRATION',message:'Existing GM Command Center data migrated into this saved game.',day:0,phase:'Day',timestamp:createdAt});
    migrated.lastSavedAt=createdAt;meta.lastSavedAt=createdAt;
    localStorage.setItem(gameDataKey(gameId),JSON.stringify(migrated));
    const index={version:4,activeGameId:gameId,games:[meta]};
    localStorage.setItem(GAME_INDEX_KEY,JSON.stringify(index));
    return index;
  }catch{return empty}
}
function loadGameData(gameId){
  try{return migrateGameData(JSON.parse(localStorage.getItem(gameDataKey(gameId))),gameId)}
  catch{return baseGameData(gameId)}
}

let gameIndex=loadGameIndex();
const deviceGameSnapshot=gameIndex.games.map(game=>({...game}));
let state=gameIndex.activeGameId&&gameIndex.games.some(game=>game.id===gameIndex.activeGameId)?loadGameData(gameIndex.activeGameId):null;
let editingAbilityId=null;
let editingRoleId=null;
let editingRoleVersion=null;
let editingRuleId=null;
let editingRuleVersion=null;
let editingGameId=null;
let selectedRoleAbilityIds=new Set();
let cloudAvailable=false,cloudSession=null,cloudContext=null,cloudVersion=0,cloudChannelGameId=null;
let cloudAudit=[];
let availableRoleTemplates=[];
let cloudSaveTimer=null,cloudSaveInFlight=false,cloudDirty=false,pendingAudit={action:'Game updated',entityType:'game',entityId:null};

function currentGame(){return gameIndex.games.find(game=>game.id===gameIndex.activeGameId)||null}
function belongsToCurrent(record){return Boolean(record&&currentGame()&&record.gameId===currentGame().id)}
function factionById(recordId){return state?.factions.find(record=>record.id===recordId&&belongsToCurrent(record))}
function roleById(recordId){return state?.roles.find(record=>record.id===recordId&&belongsToCurrent(record))}
function playerById(recordId){return state?.players.find(record=>record.id===recordId&&belongsToCurrent(record))}
function rolesUsingAbility(ability){return state.roles.filter(role=>belongsToCurrent(role)&&role.tags.some(tag=>normalized(tag)===normalized(ability.name)))}
function canEditGame(){return Boolean(cloudSession&&currentGame()&&currentGame().memberRole!=='viewer')}
function canEditRoles(){return canEditGame()}
function phaseLabel(game=currentGame()){return game?game.currentPhase+' '+game.currentDay:'No phase'}
function addHistory(message,type='UPDATE'){
  const game=currentGame();if(!state||!game)return;
  state.history.push({id:id(),gameId:game.id,type,message,day:game.currentDay,phase:game.currentPhase,timestamp:now()});
}
function gameDocument(){return {game:{...currentGame()},data:JSON.parse(JSON.stringify(state))}}
function setConnection(kind,label){const element=$('connectionStatus');if(!element)return;element.className='connection-status '+kind;element.textContent='● '+label}
function save(message,type='UPDATE',entityId=null){
  const game=currentGame();if(!state||!game)return;
  if(message)addHistory(message,type);
  const savedAt=now();state.lastSavedAt=savedAt;
  game.updatedAt=savedAt;game.lastSavedAt=savedAt;game.playerCount=state.players.filter(belongsToCurrent).length;
  localStorage.setItem(gameDataKey(game.id),JSON.stringify(state));
  saveIndex();renderAll();scheduleCloudSave(message||'Game updated',String(type||'game').toLowerCase(),entityId);
}
function scheduleCloudSave(action,entityType='game',entityId=null){
  if(!cloudSession||!state||!canEditGame())return;
  pendingAudit={action:String(action||'Game updated').slice(0,120),entityType:['role','rule','player','faction','ability','action','game'].includes(entityType)?entityType:'game',entityId};
  cloudDirty=true;setConnection('syncing','Saving');clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(flushCloudSave,750);
}
async function flushCloudSave(){
  if(cloudSaveInFlight||!cloudDirty||!currentGame())return;
  cloudSaveInFlight=true;cloudDirty=false;const gameId=currentGame().id,document=gameDocument(),expected=cloudVersion,audit={...pendingAudit};
  try{
    const saved=await GMCloud.saveGame(gameId,expected,document,audit);cloudVersion=saved.version;state.lastSavedAt=saved.updated_at;currentGame().lastSavedAt=saved.updated_at;saveIndex();localStorage.setItem(gameDataKey(gameId),JSON.stringify(state));setConnection('live','Live');$('lastSavedLabel').textContent='Last Saved: '+formatDateTime(saved.updated_at);
  }catch(error){
    setConnection('offline',navigator.onLine?'Sync error':'Offline');
    if(error.code==='40001'||String(error.message).includes('VERSION_CONFLICT')){await refreshOpenGame(true);alert('This game was updated by another GM while you were editing. The newest saved version has been loaded; review it before saving again.')}else{cloudDirty=true;console.error(error);alert('Changes are not synchronized: '+error.message)}
  }finally{cloudSaveInFlight=false;if(cloudDirty){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(flushCloudSave,1000)}}
}
function removeById(list,itemId,message){
  const game=currentGame();if(!game)return;
  state[list]=state[list].filter(record=>record.id!==itemId||record.gameId!==game.id);
  save(message,'DELETE');
}
function showView(viewId){
  if(viewId!=='gamesView'&&!state)viewId='gamesView';
  document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.view===viewId));
  document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===viewId));
  if(viewId==='gamesView')renderGames();
}
function resetEditorContext(){
  editingAbilityId=null;editingRoleId=null;selectedRoleAbilityIds.clear();
  if($('roleSearch'))$('roleSearch').value='';
  if($('playerSearch'))$('playerSearch').value='';
  if($('abilitySearch'))$('abilitySearch').value='';
}
async function openGame(gameId,viewId='dashboardView'){
  const game=gameIndex.games.find(item=>item.id===gameId);if(!game)return;
  cloudAudit=[];gameIndex.activeGameId=gameId;state=loadGameData(gameId);resetEditorContext();saveIndex();renderAll();showView(viewId);
  await refreshOpenGame();await subscribeToOpenGame();
}
function unloadCurrentGame(){
  GMCloud.unsubscribe();cloudChannelGameId=null;cloudAudit=[];gameIndex.activeGameId=null;state=null;resetEditorContext();saveIndex();renderAll();showView('gamesView');
}

function openGameForm(game=null){
  editingGameId=game?.id||null;
  $('gameFormTitle').textContent=game?'Edit Game':'Create New Game';
  $('saveGameFormBtn').textContent=game?'Save Game Details':'Create Game';
  $('gameNameField').value=game?.name||'';
  $('gameThemeField').value=game?.theme||'';
  $('gameDescriptionField').value=game?.description||'';
  $('gameStatusField').value=game?.status||'SETUP';
  $('gameStartingDayField').value=String(game?.startingDay??0);
  $('gameNotesField').value=game?.notes||'';
  $('gameFormError').hidden=true;$('gameFormPanel').hidden=false;$('gameNameField').focus();
}
function closeGameForm(){editingGameId=null;$('gameFormPanel').hidden=true;$('gameFormError').hidden=true}
async function submitGameForm(){
  if(!cloudSession){$('gameFormError').textContent='Sign in before creating or editing a shared game.';$('gameFormError').hidden=false;return}
  const name=$('gameNameField').value.trim();
  if(!name){$('gameFormError').textContent='Game Name is required.';$('gameFormError').hidden=false;return}
  const fields={name,theme:$('gameThemeField').value.trim(),description:$('gameDescriptionField').value.trim(),status:$('gameStatusField').value,startingDay:Number($('gameStartingDayField').value),notes:$('gameNotesField').value.trim()};
  if(editingGameId){
    const game=gameIndex.games.find(item=>item.id===editingGameId);if(!game)return closeGameForm();
    Object.assign(game,fields,{updatedAt:now()});saveIndex();
    if(currentGame()?.id===game.id){addHistory('Game details updated.','SETTINGS');save()}
    closeGameForm();renderAll();return;
  }
  const gameId=id(),createdAt=now();
  const game=normalizeMeta({id:gameId,...fields,currentDay:fields.startingDay,currentPhase:'Day',createdAt,updatedAt:createdAt});
  const data=baseGameData(gameId);data.settings.gameName=game.name;
  data.history.push({id:id(),gameId,type:'CREATE',message:'Game created.',day:game.currentDay,phase:game.currentPhase,timestamp:createdAt});
  data.lastSavedAt=createdAt;game.lastSavedAt=createdAt;
  try{
    const created=await GMCloud.createGame({game,data});game.memberRole='owner';game.shareCode=created[0]?.share_code||'';cloudVersion=created[0]?.version||1;
    localStorage.setItem(gameDataKey(gameId),JSON.stringify(data));gameIndex.games.push(game);gameIndex.activeGameId=gameId;state=data;saveIndex();closeGameForm();renderAll();showView('dashboardView');await refreshOpenGame();await subscribeToOpenGame();
  }catch(error){$('gameFormError').textContent=error.message;$('gameFormError').hidden=false}
}
async function cloneSetup(sourceGameId){
  const sourceMeta=gameIndex.games.find(game=>game.id===sourceGameId);if(!sourceMeta)return;
  const source=loadGameData(sourceGameId),gameId=id(),createdAt=now(),factionIds=new Map();
  const factions=source.factions.map(faction=>{const newId=id();factionIds.set(faction.id,newId);return {...faction,id:newId,gameId}});
  const abilityIds=new Map(),abilities=source.abilities.map(ability=>{const newId=id();abilityIds.set(ability.id,newId);return {...ability,id:newId,gameId,revisions:[]}});
  const roles=source.roles.map(role=>({...role,id:id(),gameId,factionId:factionIds.get(role.factionId)||role.factionId,activeAbilityId:abilityIds.get(role.activeAbilityId)||'',passiveAbilityId:abilityIds.get(role.passiveAbilityId)||'',tags:[...role.tags],version:1}));
  const name=sourceMeta.name+' Copy';
  const game=normalizeMeta({id:gameId,name,theme:sourceMeta.theme,description:sourceMeta.description,status:'SETUP',startingDay:sourceMeta.startingDay,currentDay:sourceMeta.startingDay,currentPhase:'Day',createdAt,updatedAt:createdAt});
  const rules=source.rules.map((rule,index)=>normalizeRule({...rule,id:id(),gameId,sortOrder:index,version:1},gameId,index));
  const data={...baseGameData(gameId),settings:{...source.settings,gameName:name,labels:{...source.settings.labels}},factions,roles,abilities,rules,players:[],actions:[],history:[{id:id(),gameId,type:'DUPLICATE',message:'Fresh setup duplicated from '+sourceMeta.name+'.',day:game.currentDay,phase:'Day',timestamp:createdAt}],lastSavedAt:createdAt};
  try{const created=await GMCloud.createGame({game,data});game.memberRole='owner';game.shareCode=created[0]?.share_code||'';game.lastSavedAt=createdAt;localStorage.setItem(gameDataKey(gameId),JSON.stringify(data));gameIndex.games.push(game);saveIndex();renderGames()}catch(error){alert('Could not duplicate game: '+error.message)}
}
function recordStoredGameEvent(game,message,type){
  const data=loadGameData(game.id),timestamp=now();
  data.history.push({id:id(),gameId:game.id,type,message,day:game.currentDay,phase:game.currentPhase,timestamp});
  data.lastSavedAt=timestamp;game.lastSavedAt=timestamp;game.updatedAt=timestamp;
  localStorage.setItem(gameDataKey(game.id),JSON.stringify(data));
}
async function setStoredGameStatus(gameId,status,message){try{const loaded=await GMCloud.loadGame(gameId),document=loaded.document.document;document.game.status=status;document.game.updatedAt=now();document.data.history.push({id:id(),gameId,type:'STATUS',message,day:document.game.currentDay,phase:document.game.currentPhase,timestamp:now()});await GMCloud.saveGame(gameId,loaded.document.version,document,{action:message,entityType:'game',entityId:gameId});await refreshCloudGames();if(currentGame()?.id===gameId&&status==='ARCHIVED')unloadCurrentGame()}catch(error){alert(error.message)}}
function archiveGame(gameId){return setStoredGameStatus(gameId,'ARCHIVED','Game archived.')}
function restoreGame(gameId){return setStoredGameStatus(gameId,'PAUSED','Game restored from archive.')}
async function deleteGame(gameId){
  const game=gameIndex.games.find(item=>item.id===gameId);if(!game||!confirm('Permanently delete \"'+game.name+'\" and all of its game-specific data? This cannot be undone.'))return;
  try{await GMCloud.deleteGame(gameId)}catch(error){return alert(error.message)}
  localStorage.removeItem(gameDataKey(gameId));gameIndex.games=gameIndex.games.filter(item=>item.id!==gameId);
  if(gameIndex.activeGameId===gameId){gameIndex.activeGameId=null;state=null}
  saveIndex();renderAll();showView('gamesView');
}
function resetCurrentGame(){
  const game=currentGame();if(!game||!confirm('Reset gameplay progress for \"'+game.name+'\"? Setup, roles, factions, and abilities will be kept.'))return;
  const reset=baseGameData(game.id);reset.settings={...state.settings,labels:{...state.settings.labels}};reset.factions=state.factions;reset.roles=state.roles;reset.abilities=state.abilities;reset.rules=state.rules;
  game.currentDay=game.startingDay;game.currentPhase='Day';game.status='SETUP';state=reset;addHistory('Gameplay progress reset; setup was preserved.','RESET');save();
}

function gameCard(game,group){
  const current=game.id===gameIndex.activeGameId?' current':'';
  let actions='';
  if(group==='active')actions='<button data-game-action=\"open\">Open Game</button><button class=\"secondary\" data-game-action=\"edit\">Edit Game</button><button class=\"secondary\" data-game-action=\"archive\">Archive / Close</button>';
  if(group==='saved')actions='<button data-game-action=\"open\">Load Game</button><button class=\"secondary\" data-game-action=\"edit\">Edit Game</button><button class=\"secondary\" data-game-action=\"duplicate\">Duplicate</button><button class=\"secondary\" data-game-action=\"archive\">Archive</button><button class=\"danger\" data-game-action=\"delete\">Delete</button>';
  if(group==='archived')actions='<button data-game-action=\"view\">View Game</button><button class=\"secondary\" data-game-action=\"restore\">Restore</button><button class=\"secondary\" data-game-action=\"duplicate\">Duplicate</button><button class=\"danger\" data-game-action=\"delete\">Delete</button>';
  return '<article class=\"game-card'+current+'\" data-game-id=\"'+esc(game.id)+'\"><div class=\"section-heading\"><div><h3>'+esc(game.name)+'</h3><div class=\"game-theme\">'+esc(game.theme||'No theme')+'</div></div><span class=\"status-badge '+game.status+'\">'+game.status+'</span></div><div class=\"game-card-meta\"><span>'+game.playerCount+' players</span><span>'+esc(phaseLabel(game))+'</span><span>Created '+esc(formatDate(game.createdAt))+'</span><span>Updated '+esc(formatDateTime(game.updatedAt))+'</span><span class=\"game-id\">ID: '+esc(game.id)+'</span></div><div class=\"game-card-actions\">'+actions+'</div></article>';
}
function renderGames(){
  const query=normalized($('gamesSearch').value),sort=$('gamesSort').value,total=gameIndex.games.length;
  $('gamesEmptyState').hidden=total!==0;$('gamesManagerContent').hidden=total===0;
  const sorter=(a,b)=>sort==='NAME'?a.name.localeCompare(b.name):sort==='CREATED'?new Date(b.createdAt)-new Date(a.createdAt):sort==='STATUS'?a.status.localeCompare(b.status):new Date(b.updatedAt)-new Date(a.updatedAt);
  const filtered=gameIndex.games.filter(game=>normalized(game.name+' '+game.theme).includes(query)).sort(sorter);
  const groups={active:filtered.filter(game=>game.status==='ACTIVE'),saved:filtered.filter(game=>['SETUP','PAUSED','COMPLETED'].includes(game.status)),archived:filtered.filter(game=>game.status==='ARCHIVED')};
  [['active','activeGamesList'],['saved','savedGamesList'],['archived','archivedGamesList']].forEach(([group,targetId])=>{
    $(targetId).innerHTML=groups[group].map(game=>gameCard(game,group)).join('')||'<div class=\"empty-state\">No matching '+group+' games.</div>';
  });
  document.querySelectorAll('[data-game-action]').forEach(button=>button.onclick=event=>{
    event.stopPropagation();const card=button.closest('[data-game-id]'),gameId=card.dataset.gameId,action=button.dataset.gameAction;
    if(action==='open'||action==='view')openGame(gameId);
    if(action==='edit')openGameForm(gameIndex.games.find(game=>game.id===gameId));
    if(action==='duplicate')cloneSetup(gameId);
    if(action==='archive')archiveGame(gameId);
    if(action==='restore')restoreGame(gameId);
    if(action==='delete')deleteGame(gameId);
  });
}
function renderChrome(){
  const game=currentGame(),hasGame=Boolean(game&&state);
  $('currentGameLabel').textContent=hasGame?'CURRENT GAME: '+game.name:'No game open';
  $('lastSavedLabel').textContent=hasGame?'Last Saved: '+formatDateTime(game.lastSavedAt):'Not saved';
  $('saveGameBtn').disabled=!hasGame||!canEditGame();$('exportBtn').disabled=!hasGame;
  $('currentUserLabel').textContent=cloudSession?(cloudSession.user.user_metadata?.display_name||cloudSession.user.email||'Signed in'):'';$('signOutBtn').hidden=!cloudSession;
  $('authPanel').hidden=Boolean(cloudSession);$('authPanel').style.display=cloudSession?'none':'';$('joinGamePanel').hidden=!cloudSession;$('joinGamePanel').style.display=cloudSession?'':'none';
  const hasDeviceOnlySaves=Boolean(cloudSession&&deviceGameSnapshot.some(saved=>!gameIndex.games.some(game=>game.id===saved.id)));$('uploadDeviceGamesBtn').hidden=!hasDeviceOnlySaves;
  document.querySelectorAll('.game-tab').forEach(tab=>tab.disabled=!hasGame);
  const switcher=$('gameSwitcher'),selected=game?.id||'';switcher.innerHTML='';switcher.append(option('','No game open'));
  [...gameIndex.games].sort((a,b)=>a.name.localeCompare(b.name)).forEach(item=>switcher.append(option(item.id,item.name+(item.status==='ARCHIVED'?' (Archived)':''))));
  switcher.value=selected;document.title=hasGame?game.name+' — GM Command Center':'Games — GM Command Center';
  const readOnly=hasGame&&!canEditGame();['addFactionBtn','addPlayerBtn','addActionBtn','addAbilityBtn','saveSettingsBtn','resetCurrentGameBtn','archiveCurrentGameBtn','deleteCurrentGameBtn','browseRoleTemplatesBtn','addRoleTemplateBtn'].forEach(key=>{if($(key))$(key).disabled=readOnly});
}

function renderSelects(){
  const factionSelects=[$('roleFaction'),$('roleFactionFilter'),$('statsFactionFilter')];
  factionSelects.forEach((select,index)=>{const current=select.value;select.innerHTML='';if(index>0)select.append(option('ALL','All factions'));state.factions.forEach(faction=>select.append(option(faction.id,faction.name+' ('+faction.class+')')));if([...select.options].some(item=>item.value===current))select.value=current});
  const roleSelect=$('playerRole'),currentRole=roleSelect.value;roleSelect.innerHTML='';state.roles.forEach(role=>roleSelect.append(option(role.id,role.name+' — '+(factionById(role.factionId)?.name||'No faction'))));if([...roleSelect.options].some(item=>item.value===currentRole))roleSelect.value=currentRole;
  const actor=$('actionActor'),target=$('actionTarget'),currentActor=actor.value,currentTarget=target.value;actor.innerHTML='';target.innerHTML='';
  state.players.filter(player=>player.alive).forEach(player=>{const label=player.name+' ('+(roleById(player.roleId)?.name||'No role')+')';actor.append(option(player.id,label));target.append(option(player.id,label))});
  if([...actor.options].some(item=>item.value===currentActor))actor.value=currentActor;if([...target.options].some(item=>item.value===currentTarget))target.value=currentTarget;
  ['roleActiveAbility','rolePassiveAbility'].forEach(selectId=>{const select=$(selectId),current=select.value;select.innerHTML='';select.append(option('','None'));state.abilities.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(ability=>select.append(option(ability.id,ability.name)));if([...select.options].some(item=>item.value===current))select.value=current});
}
function renderRoleAbilityPicker(){
  const validIds=new Set(state.abilities.map(ability=>ability.id));selectedRoleAbilityIds=new Set([...selectedRoleAbilityIds].filter(abilityId=>validIds.has(abilityId)));
  const search=normalized($('roleAbilitySearch').value);
  const abilities=state.abilities.filter(ability=>normalized(ability.name+' '+ability.category+' '+ability.definition+' '+ability.mechanics.join(' ')).includes(search)).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  const grouped=abilities.reduce((groups,ability)=>{(groups[ability.category]??=[]).push(ability);return groups},{});
  $('roleAbilityPicker').innerHTML=Object.entries(grouped).map(([category,items])=>'<div class=\"role-ability-group\"><strong>'+esc(category)+'</strong>'+items.map(ability=>'<label class=\"role-ability-option\"><input type=\"checkbox\" value=\"'+esc(ability.id)+'\" '+(selectedRoleAbilityIds.has(ability.id)?'checked':'')+' '+(canEditRoles()?'':'disabled')+'><span>'+esc(ability.name)+'</span></label>').join('')+'</div>').join('')||'<p class=\"muted role-ability-empty\">No Encyclopedia abilities match.</p>';
  $('roleAbilityPicker').querySelectorAll('input').forEach(box=>box.onchange=()=>{box.checked?selectedRoleAbilityIds.add(box.value):selectedRoleAbilityIds.delete(box.value);renderSelectedRoleAbilities()});renderSelectedRoleAbilities();
}
function renderSelectedRoleAbilities(){
  const selected=state.abilities.filter(ability=>selectedRoleAbilityIds.has(ability.id)).sort((a,b)=>a.name.localeCompare(b.name));
  $('selectedRoleAbilities').innerHTML=selected.length?'<span class=\"selection-label\">Selected:</span>'+selected.map(ability=>'<button type=\"button\" class=\"selected-ability-chip\" data-id=\"'+esc(ability.id)+'\" '+(canEditRoles()?'':'disabled')+'>'+esc(ability.name)+' ×</button>').join(''):'<span class=\"muted\">No abilities selected.</span>';
  document.querySelectorAll('.selected-ability-chip').forEach(button=>button.onclick=()=>{selectedRoleAbilityIds.delete(button.dataset.id);renderRoleAbilityPicker()});
}
function showRoleError(message){$('roleFormError').textContent=message;$('roleFormError').hidden=false}
function roleFormValues(){
  if(!canEditRoles()){showRoleError('Role changes require authorized GM editing.');return null}
  const name=$('roleName').value.trim(),factionId=$('roleFaction').value,abilities=state.abilities.filter(ability=>selectedRoleAbilityIds.has(ability.id));
  if(!name){showRoleError('Enter a role name.');return null}if(!factionById(factionId)){showRoleError('Select a valid faction.');return null}
  if(!abilities.length){showRoleError('Select at least one ability from the Ability Encyclopedia.');return null}
  if(state.roles.some(role=>normalized(role.name)===normalized(name)&&role.id!==editingRoleId)){showRoleError('A role with this name already exists.');return null}
  const uses=$('roleAbilityUses').value;
  $('roleFormError').hidden=true;return {name,factionId,alignment:$('roleAlignment').value.trim(),description:$('roleDescription').value.trim(),activeAbilityId:$('roleActiveAbility').value,passiveAbilityId:$('rolePassiveAbility').value,tags:abilities.map(ability=>ability.name),abilityUses:uses===''?null:Math.max(0,Number(uses)||0),cooldowns:$('roleCooldowns').value.trim(),immunities:$('roleImmunities').value.split(',').map(v=>v.trim()).filter(Boolean),restrictions:$('roleRestrictions').value.split(',').map(v=>v.trim()).filter(Boolean),winCondition:$('roleWinCondition').value.trim(),notes:$('roleNotes').value.trim(),gmNotes:$('roleGmNotes').value.trim(),labels:$('roleLabels').value.split(',').map(v=>v.trim()).filter(Boolean),enabled:$('roleEnabled').checked};
}
function renderRoleEditorAccess(){
  const authorized=canEditRoles(),panel=$('roleFormTitle').closest('.panel');panel.classList.toggle('role-editor-locked',!authorized);$('roleAccessNotice').hidden=authorized;
  ['roleName','roleFaction','roleAlignment','roleDescription','roleActiveAbility','rolePassiveAbility','roleAbilitySearch','roleAbilityUses','roleCooldowns','roleImmunities','roleRestrictions','roleWinCondition','roleNotes','roleGmNotes','roleLabels','roleEnabled','addRoleBtn'].forEach(elementId=>$(elementId).disabled=!authorized);
  if(!authorized){$('roleFormTitle').textContent='Role Editor (Read Only)';$('cancelRoleEditBtn').hidden=true}
}
function clearRoleForm(){
  editingRoleId=null;editingRoleVersion=null;selectedRoleAbilityIds.clear();$('roleFormTitle').textContent='Add Role';$('roleEditNotice').hidden=true;$('addRoleBtn').textContent='Add Role';$('cancelRoleEditBtn').hidden=true;$('roleFormError').hidden=true;
  ['roleName','roleAlignment','roleDescription','roleAbilityUses','roleCooldowns','roleImmunities','roleRestrictions','roleWinCondition','roleNotes','roleGmNotes','roleLabels','roleAbilitySearch'].forEach(key=>$(key).value='');$('roleActiveAbility').value='';$('rolePassiveAbility').value='';$('roleEnabled').checked=true;$('roleSaveMeta').textContent='';renderRoleAbilityPicker();renderRoleEditorAccess();
}
function beginRoleEdit(roleId){
  if(!canEditRoles())return;const role=roleById(roleId);if(!role)return;editingRoleId=role.id;editingRoleVersion=role.version;$('roleFormTitle').textContent='Edit '+role.name;$('roleEditNotice').hidden=false;$('addRoleBtn').textContent='Save Changes';$('cancelRoleEditBtn').hidden=false;
  $('roleName').value=role.name;$('roleFaction').value=role.factionId;$('roleAlignment').value=role.alignment;$('roleDescription').value=role.description;$('roleActiveAbility').value=role.activeAbilityId;$('rolePassiveAbility').value=role.passiveAbilityId;$('roleAbilityUses').value=role.abilityUses??'';$('roleCooldowns').value=role.cooldowns;$('roleImmunities').value=role.immunities.join(', ');$('roleRestrictions').value=role.restrictions.join(', ');$('roleWinCondition').value=role.winCondition;$('roleNotes').value=role.notes;$('roleGmNotes').value=role.gmNotes;$('roleLabels').value=role.labels.join(', ');$('roleEnabled').checked=role.enabled;$('roleAbilitySearch').value='';$('roleSaveMeta').textContent='Version '+role.version+' • Last saved '+formatDateTime(role.updatedAt);
  selectedRoleAbilityIds=new Set(state.abilities.filter(ability=>role.tags.some(tag=>normalized(tag)===normalized(ability.name))).map(ability=>ability.id));renderRoleAbilityPicker();$('roleName').focus();
}
function duplicateRole(roleId){
  if(!canEditRoles())return;const source=roleById(roleId);if(!source)return;let name=source.name+' Copy',number=2;while(state.roles.some(role=>normalized(role.name)===normalized(name)))name=source.name+' Copy '+number++;
  const timestamp=now(),copy=normalizeRole({...source,id:id(),gameId:currentGame().id,name,tags:[...source.tags],version:1,createdAt:timestamp,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null},currentGame().id);state.roles.push(copy);save('Role duplicated: '+name+'.','ROLE',copy.id);
}
async function browseRoleTemplates(){try{availableRoleTemplates=(await GMCloud.roleTemplates()).filter(template=>template.sourceGameId!==currentGame().id);const select=$('roleTemplateSelect');select.innerHTML='';availableRoleTemplates.sort((a,b)=>a.sourceGameName.localeCompare(b.sourceGameName)||a.role.name.localeCompare(b.role.name)).forEach(template=>select.append(option(template.key,template.sourceGameName+' — '+template.role.name)));select.hidden=!availableRoleTemplates.length;$('addRoleTemplateBtn').hidden=!availableRoleTemplates.length;if(!availableRoleTemplates.length)alert('No roles are available in your other shared games.')}catch(error){alert(error.message)}}
function addSelectedRoleTemplate(){const template=availableRoleTemplates.find(item=>item.key===$('roleTemplateSelect').value);if(!template)return;const source=normalizeRole(template.role,currentGame().id),sourceFaction=template.factions.find(faction=>faction.id===source.factionId),destinationFaction=state.factions.find(faction=>normalized(faction.name)===normalized(sourceFaction?.name))||state.factions.find(faction=>faction.class===sourceFaction?.class)||state.factions[0],sourceActive=template.abilities.find(ability=>ability.id===source.activeAbilityId)?.name,sourcePassive=template.abilities.find(ability=>ability.id===source.passiveAbilityId)?.name;clearRoleForm();$('roleFormTitle').textContent='Add '+source.name+' from '+template.sourceGameName;$('roleName').value=source.name;$('roleFaction').value=destinationFaction?.id||'';$('roleAlignment').value=source.alignment;$('roleDescription').value=source.description;$('roleActiveAbility').value=state.abilities.find(ability=>normalized(ability.name)===normalized(sourceActive))?.id||'';$('rolePassiveAbility').value=state.abilities.find(ability=>normalized(ability.name)===normalized(sourcePassive))?.id||'';$('roleAbilityUses').value=source.abilityUses??'';$('roleCooldowns').value=source.cooldowns;$('roleImmunities').value=source.immunities.join(', ');$('roleRestrictions').value=source.restrictions.join(', ');$('roleWinCondition').value=source.winCondition;$('roleNotes').value=source.notes;$('roleGmNotes').value=source.gmNotes;$('roleLabels').value=source.labels.join(', ');$('roleEnabled').checked=source.enabled;selectedRoleAbilityIds=new Set(state.abilities.filter(ability=>source.tags.some(tag=>normalized(tag)===normalized(ability.name))).map(ability=>ability.id));renderRoleAbilityPicker();if(!selectedRoleAbilityIds.size)showRoleError('Select at least one destination-game ability before saving this copied role.');$('roleName').focus()}
function renderDashboard(){
  const game=currentGame();$('gameDashboardHeading').innerHTML='<h2>'+esc(game.name)+'</h2><p class=\"muted\">'+esc(game.status)+' • '+esc(phaseLabel(game))+(game.theme?' • '+esc(game.theme):'')+'</p>';
  $('metrics').innerHTML=[['Factions',state.factions.length],['Roles',state.roles.length],['Players',state.players.length],['Known Abilities',state.abilities.length]].map(([label,value])=>'<div class=\"metric\"><strong>'+value+'</strong><span>'+label+'</span></div>').join('');
  $('factionOverview').innerHTML=state.factions.map(faction=>{const roles=state.roles.filter(role=>role.factionId===faction.id),players=state.players.filter(player=>roles.some(role=>role.id===player.roleId));return '<div class=\"item-card\"><h3>'+esc(faction.name)+'</h3><span class=\"badge '+faction.class+'\">'+faction.class+'</span><p>'+roles.length+' roles • '+players.length+' players • '+players.filter(player=>player.alive).length+' alive</p></div>'}).join('');
}
function renderFactions(){
  $('factionList').innerHTML=state.factions.map(faction=>'<div class=\"item-card\"><h3>'+esc(faction.name)+'</h3><span class=\"badge '+faction.class+'\">'+faction.class+'</span><p>Alias: '+esc(faction.alias||'—')+' • Team '+(faction.teamNumber||1)+'</p><button class=\"danger delete-faction\" data-id=\"'+esc(faction.id)+'\">Delete</button></div>').join('');
  document.querySelectorAll('.delete-faction').forEach(button=>button.onclick=()=>{if(state.roles.some(role=>role.factionId===button.dataset.id))return alert('Move this faction’s roles first.');const faction=factionById(button.dataset.id);removeById('factions',button.dataset.id,'Faction deleted: '+faction.name+'.')});
}
function renderRolesLegacy(){
  const query=normalized($('roleSearch').value),factionFilter=$('roleFactionFilter').value;
  const roles=state.roles.filter(role=>(factionFilter==='ALL'||role.factionId===factionFilter)&&normalized(role.name+' '+(role.notes||'')+' '+role.tags.join(' ')).includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
  $('roleCount').textContent=state.roles.length+' known';
  $('roleList').innerHTML=roles.map(role=>{const faction=factionById(role.factionId),assigned=state.players.filter(player=>player.roleId===role.id).length;return '<article class=\"ability-entry role-entry\" data-id=\"'+esc(role.id)+'\"><div class=\"ability-summary\"><div><div class=\"ability-name\">'+esc(role.name)+'</div><div class=\"ability-definition\">'+esc(role.notes||'No role notes.')+'</div></div><span class=\"category-badge '+(faction?.class||'')+'\">'+esc(faction?.name||'No faction')+'</span><span class=\"expand-mark\">＋</span></div><div class=\"ability-details\"><div class=\"detail-grid\"><div class=\"detail-box\"><strong>Faction class</strong>'+esc(faction?.class||'None')+'</div><div class=\"detail-box\"><strong>Assigned players</strong>'+assigned+'</div><div class=\"detail-box\"><strong>Abilities</strong>'+role.tags.length+'</div></div><strong>Role abilities</strong><div class=\"role-tag-list\">'+role.tags.map(tag=>'<span class=\"badge\">'+esc(tag)+'</span>').join('')+'</div><div class=\"ability-actions\">'+(canEditRoles()?'<button class=\"secondary edit-role\" data-id=\"'+esc(role.id)+'\">Edit</button><button class=\"secondary duplicate-role\" data-id=\"'+esc(role.id)+'\">Duplicate</button>':'<span class=\"muted\">Read only</span>')+'</div></div></article>'}).join('')||'<div class=\"empty-state\">No roles match this search.</div>';
  document.querySelectorAll('.role-entry .ability-summary').forEach(summary=>summary.onclick=()=>{const entry=summary.closest('.role-entry');entry.classList.toggle('open');entry.querySelector('.expand-mark').textContent=entry.classList.contains('open')?'−':'＋'});
  document.querySelectorAll('.edit-role').forEach(button=>button.onclick=event=>{event.stopPropagation();beginRoleEdit(button.dataset.id)});document.querySelectorAll('.duplicate-role').forEach(button=>button.onclick=event=>{event.stopPropagation();duplicateRole(button.dataset.id)});
}
function renderRoles(){
  const query=normalized($('roleSearch').value),factionFilter=$('roleFactionFilter').value,status=$('roleStatusFilter').value,sort=$('roleSort').value;
  const roles=state.roles.filter(role=>(factionFilter==='ALL'||role.factionId===factionFilter)&&(status==='ALL'||status==='ARCHIVED'&&role.archivedAt||status==='ENABLED'&&role.enabled&&!role.archivedAt||status==='DISABLED'&&!role.enabled&&!role.archivedAt)&&normalized(role.name+' '+role.description+' '+role.notes+' '+role.gmNotes+' '+role.tags.join(' ')+' '+role.labels.join(' ')).includes(query)).sort((a,b)=>sort==='UPDATED'?new Date(b.updatedAt)-new Date(a.updatedAt):sort==='FACTION'?(factionById(a.factionId)?.name||'').localeCompare(factionById(b.factionId)?.name||'')||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
  $('roleCount').textContent=state.roles.length+' known';
  $('roleList').innerHTML=roles.map(role=>{const faction=factionById(role.factionId),assigned=state.players.filter(player=>player.roleId===role.id).length,statusLabel=role.archivedAt?'Archived':role.enabled?'Enabled':'Disabled';return '<article class="ability-entry role-entry '+(role.archivedAt?'archived':'')+'" data-id="'+esc(role.id)+'"><div class="ability-summary"><div><div class="ability-name">'+esc(role.name)+' <span class="badge">'+statusLabel+'</span></div><div class="ability-definition">'+esc(role.description||role.notes||'No role description.')+'</div></div><span class="category-badge '+(faction?.class||'')+'">'+esc(faction?.name||'No faction')+'</span><span class="expand-mark">＋</span></div><div class="ability-details"><div class="detail-grid"><div class="detail-box"><strong>Alignment</strong>'+esc(role.alignment||'Not set')+'</div><div class="detail-box"><strong>Assigned players</strong>'+assigned+'</div><div class="detail-box"><strong>Version</strong>'+role.version+'</div></div><strong>Abilities</strong><div class="role-tag-list">'+role.tags.map(tag=>'<span class="badge">'+esc(tag)+'</span>').join('')+'</div><p><strong>Win condition:</strong> '+esc(role.winCondition||'Not set')+'</p><p class="muted">Updated '+esc(formatDateTime(role.updatedAt))+'</p><div class="ability-actions">'+(canEditRoles()?'<button class="secondary edit-role" data-id="'+esc(role.id)+'">Edit</button><button class="secondary duplicate-role" data-id="'+esc(role.id)+'">Duplicate</button><button class="secondary archive-role" data-id="'+esc(role.id)+'">'+(role.archivedAt?'Restore':'Archive')+'</button><button class="danger delete-role" data-id="'+esc(role.id)+'">Delete</button>':'<span class="muted">Read only</span>')+'</div></div></article>'}).join('')||'<div class="empty-state">No roles match this search.</div>';
  document.querySelectorAll('.role-entry .ability-summary').forEach(summary=>summary.onclick=()=>{const entry=summary.closest('.role-entry');entry.classList.toggle('open');entry.querySelector('.expand-mark').textContent=entry.classList.contains('open')?'−':'＋'});
  document.querySelectorAll('.edit-role').forEach(button=>button.onclick=event=>{event.stopPropagation();beginRoleEdit(button.dataset.id);GMCloud.track({view:'role',editing:roleById(button.dataset.id)?.name})});document.querySelectorAll('.duplicate-role').forEach(button=>button.onclick=event=>{event.stopPropagation();duplicateRole(button.dataset.id)});document.querySelectorAll('.archive-role').forEach(button=>button.onclick=event=>{event.stopPropagation();const role=roleById(button.dataset.id);role.archivedAt=role.archivedAt?null:now();role.enabled=!role.archivedAt;role.version++;role.updatedAt=now();save((role.archivedAt?'Role archived: ':'Role restored: ')+role.name+'.','ROLE',role.id)});document.querySelectorAll('.delete-role').forEach(button=>button.onclick=event=>{event.stopPropagation();deleteRoleSafely(button.dataset.id)});
}
function deleteRoleSafely(roleId){const role=roleById(roleId);if(!role)return;const referenced=state.players.some(player=>player.roleId===roleId)||state.actions.some(action=>action.roleId===roleId)||state.history.some(event=>event.entityId===roleId);if(referenced){role.archivedAt=role.archivedAt||now();role.enabled=false;role.version++;role.updatedAt=now();save('Referenced role archived instead of deleted: '+role.name+'.','ROLE',role.id);return alert('This role has gameplay references, so it was archived instead of deleted.')}if(confirm('Permanently delete '+role.name+'?')){state.roles=state.roles.filter(item=>item.id!==roleId);save('Role deleted: '+role.name+'.','ROLE',role.id)}}

function renderPlayers(){
  const query=normalized($('playerSearch').value),life=$('playerLifeFilter').value;
  const players=state.players.filter(player=>(life==='ALL'||life==='ALIVE'&&player.alive||life==='DEAD'&&!player.alive)&&normalized(player.name+' '+(roleById(player.roleId)?.name||'')).includes(query));
  $('playerList').innerHTML=players.map(player=>{const role=roleById(player.roleId),faction=factionById(role?.factionId);return '<div class=\"item-card\"><h3>'+esc(player.name)+'</h3><p>'+esc(role?.name||'No role')+'</p><span class=\"badge '+(faction?.class||'')+'\">'+esc(faction?.name||'No faction')+'</span><p><strong>'+(player.alive?'Alive':'Dead')+'</strong></p><button class=\"secondary toggle-life\" data-id=\"'+esc(player.id)+'\">'+(player.alive?'Mark Dead':'Revive')+'</button> <button class=\"danger delete-player\" data-id=\"'+esc(player.id)+'\">Delete</button></div>'}).join('')||'<p class=\"muted\">No matching players.</p>';
  document.querySelectorAll('.toggle-life').forEach(button=>button.onclick=()=>{const player=playerById(button.dataset.id);player.alive=!player.alive;save(player.name+(player.alive?' revived.':' marked dead.'),'PLAYER')});
  document.querySelectorAll('.delete-player').forEach(button=>button.onclick=()=>{const player=playerById(button.dataset.id);removeById('players',button.dataset.id,'Player removed: '+player.name+'.')});
}
function renderQueue(){
  const sorted=[...state.actions].sort((a,b)=>(priorityMap[a.category]||99)-(priorityMap[b.category]||99));
  $('queueList').innerHTML=sorted.map((action,index)=>'<div class=\"queue-row\"><strong>'+(index+1)+'</strong><div><strong>'+esc(action.name)+'</strong><div class=\"muted\">'+esc(playerById(action.actorId)?.name||'Unknown')+' → '+esc(playerById(action.targetId)?.name||'Unknown')+' • '+esc(action.category)+'</div></div><button class=\"danger delete-action\" data-id=\"'+esc(action.id)+'\">Remove</button></div>').join('')||'<p class=\"muted\">No queued actions.</p>';
  document.querySelectorAll('.delete-action').forEach(button=>button.onclick=()=>removeById('actions',button.dataset.id,'Queued action removed.'));
}
function renderStats(){
  const factionFilter=$('statsFactionFilter').value,aliveOnly=$('aliveOnlyStats').checked;let roles=state.roles.filter(role=>factionFilter==='ALL'||role.factionId===factionFilter);
  if(aliveOnly){const activeRoleIds=new Set(state.players.filter(player=>player.alive).map(player=>player.roleId));roles=roles.filter(role=>activeRoleIds.has(role.id))}
  const counts={};roles.forEach(role=>role.tags.forEach(tag=>counts[tag]=(counts[tag]||0)+1));const max=Math.max(1,...Object.values(counts));
  $('abilityStats').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>'<div class=\"stat-row\"><strong>'+esc(tag)+'</strong><span>'+count+'</span><div class=\"bar\"><span style=\"width:'+count/max*100+'%\"></span></div></div>').join('')||'<p class=\"muted\">Add abilities to roles to populate statistics.</p>';
}
function abilityTemplate(ability){return standardAbilities().find(item=>normalized(item.name)===normalized(ability.defaultName||ability.name))}
function snapshotAbility(ability){return {name:ability.name,category:ability.category,definition:ability.definition,phase:ability.phase,mechanics:[...ability.mechanics],savedAt:now()}}
function clearAbilityForm(){editingAbilityId=null;$('abilityFormTitle').textContent='Add Ability';$('abilityEditNotice').hidden=true;$('addAbilityBtn').textContent='Add Ability';$('cancelAbilityEditBtn').hidden=true;$('abilityName').value='';$('abilityDefinition').value='';$('abilityMechanics').value='';$('abilityCategory').value='Investigation';$('abilityPhase').value='Night'}
function beginAbilityEdit(abilityId){const ability=state.abilities.find(item=>item.id===abilityId);if(!ability)return;editingAbilityId=ability.id;$('abilityFormTitle').textContent='Edit '+ability.name;$('abilityEditNotice').hidden=false;$('addAbilityBtn').textContent='Save Changes';$('cancelAbilityEditBtn').hidden=false;$('abilityName').value=ability.name;$('abilityCategory').value=ability.category;$('abilityDefinition').value=ability.definition;$('abilityPhase').value=ability.phase||'Any';$('abilityMechanics').value=ability.mechanics.join(', ')}
function duplicateAbility(abilityId){const source=state.abilities.find(item=>item.id===abilityId);if(!source)return;let name=source.name+' Copy',number=2;while(state.abilities.some(ability=>normalized(ability.name)===normalized(name)))name=source.name+' Copy '+number++;const {defaultName,...copy}=source;state.abilities.push({...copy,id:id(),gameId:currentGame().id,name,builtIn:false,revisions:[]});save('Ability duplicated: '+name+'.','ABILITY')}
function resetBuiltInAbility(abilityId){const ability=state.abilities.find(item=>item.id===abilityId),template=ability&&abilityTemplate(ability);if(!template||!confirm('Restore '+ability.name+' to its original definition?'))return;ability.revisions.push(snapshotAbility(ability));Object.assign(ability,{category:template.category,definition:template.definition,phase:template.phase,mechanics:[...template.mechanics]});save('Built-in ability reset: '+ability.name+'.','ABILITY')}
function renderEncyclopedia(){
  const search=normalized($('abilitySearch').value),category=$('abilityCategoryFilter').value,categories=[...new Set(state.abilities.map(ability=>ability.category))].sort(),filter=$('abilityCategoryFilter'),current=filter.value;filter.innerHTML='';filter.append(option('ALL','All categories'));categories.forEach(item=>filter.append(option(item,item)));if([...filter.options].some(item=>item.value===current))filter.value=current;
  const abilities=state.abilities.filter(ability=>(category==='ALL'||ability.category===category)&&normalized(ability.name+' '+ability.definition+' '+ability.mechanics.join(' ')).includes(search)).sort((a,b)=>a.name.localeCompare(b.name));$('abilityCount').textContent=state.abilities.length+' known';
  $('abilityList').innerHTML=abilities.map(ability=>{const used=rolesUsingAbility(ability);return '<article class=\"ability-entry\" data-id=\"'+esc(ability.id)+'\"><div class=\"ability-summary\"><div><div class=\"ability-name\">'+esc(ability.name)+'</div><div class=\"ability-definition\">'+esc(ability.definition)+'</div></div><span class=\"category-badge\">'+esc(ability.category)+'</span><span class=\"expand-mark\">＋</span></div><div class=\"ability-details\"><div class=\"detail-grid\"><div class=\"detail-box\"><strong>Usual phase</strong>'+esc(ability.phase||'Any')+'</div><div class=\"detail-box\"><strong>Related mechanics</strong>'+ability.mechanics.map(item=>'<span class=\"badge\">'+esc(item)+'</span>').join('')+'</div><div class=\"detail-box\"><strong>Used by roles</strong>'+used.length+'</div></div><div class=\"ability-actions\"><button class=\"secondary edit-ability\" data-id=\"'+esc(ability.id)+'\">Edit</button><button class=\"secondary duplicate-ability\" data-id=\"'+esc(ability.id)+'\">Duplicate</button>'+(ability.builtIn?'<button class=\"secondary reset-ability\" data-id=\"'+esc(ability.id)+'\">Reset Default</button>':'<button class=\"danger delete-ability\" data-id=\"'+esc(ability.id)+'\">Delete</button>')+'</div></div></article>'}).join('')||'<div class=\"empty-state\">No abilities match this search.</div>';
  document.querySelectorAll('#abilityList .ability-summary').forEach(summary=>summary.onclick=()=>{const entry=summary.closest('.ability-entry');entry.classList.toggle('open');entry.querySelector('.expand-mark').textContent=entry.classList.contains('open')?'−':'＋'});
  document.querySelectorAll('.edit-ability').forEach(button=>button.onclick=event=>{event.stopPropagation();beginAbilityEdit(button.dataset.id)});document.querySelectorAll('.duplicate-ability').forEach(button=>button.onclick=event=>{event.stopPropagation();duplicateAbility(button.dataset.id)});document.querySelectorAll('.reset-ability').forEach(button=>button.onclick=event=>{event.stopPropagation();resetBuiltInAbility(button.dataset.id)});
  document.querySelectorAll('.delete-ability').forEach(button=>button.onclick=event=>{event.stopPropagation();const ability=state.abilities.find(item=>item.id===button.dataset.id),used=rolesUsingAbility(ability);if(used.length)return alert('This ability is assigned to roles and cannot be deleted.');removeById('abilities',button.dataset.id,'Ability deleted: '+ability.name+'.')});
}
function clearRuleForm(){editingRuleId=null;editingRuleVersion=null;$('ruleFormTitle').textContent='Add Rule';$('saveRuleBtn').textContent='Add Rule';$('cancelRuleEditBtn').hidden=true;$('ruleFormError').hidden=true;['ruleTitle','ruleDescription','ruleNotes'].forEach(key=>$(key).value='');$('ruleCategory').value='General';$('ruleVisibility').value='public';$('ruleEnabled').checked=true}
function beginRuleEdit(ruleId){if(!canEditGame())return;const rule=state.rules.find(item=>item.id===ruleId);if(!rule)return;editingRuleId=rule.id;editingRuleVersion=rule.version;$('ruleFormTitle').textContent='Edit '+rule.title;$('saveRuleBtn').textContent='Save Changes';$('cancelRuleEditBtn').hidden=false;$('ruleTitle').value=rule.title;$('ruleDescription').value=rule.description;$('ruleCategory').value=rule.category;$('ruleVisibility').value=rule.visibility;$('ruleNotes').value=rule.notes;$('ruleEnabled').checked=rule.enabled;GMCloud.track({view:'rule',editing:rule.title})}
function moveRule(ruleId,direction){const ordered=state.rules.slice().sort((a,b)=>a.sortOrder-b.sortOrder),index=ordered.findIndex(rule=>rule.id===ruleId),swap=index+direction;if(index<0||swap<0||swap>=ordered.length)return;[ordered[index],ordered[swap]]=[ordered[swap],ordered[index]];ordered.forEach((rule,i)=>{rule.sortOrder=i;rule.updatedAt=now();rule.version++});state.rules=ordered;save('Rules reordered.','RULE',ruleId)}
function duplicateRule(ruleId){const source=state.rules.find(rule=>rule.id===ruleId);if(!source)return;const timestamp=now(),copy=normalizeRule({...source,id:id(),title:source.title+' Copy',sortOrder:state.rules.length,version:1,createdAt:timestamp,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null},currentGame().id,state.rules.length);state.rules.push(copy);save('Rule duplicated: '+copy.title+'.','RULE',copy.id)}
function renderRules(){
  const query=normalized($('ruleSearch').value),status=$('ruleStatusFilter').value,rules=state.rules.filter(rule=>(status==='ALL'||status==='ENABLED'&&rule.enabled||status==='DISABLED'&&!rule.enabled)&&normalized(rule.title+' '+rule.description+' '+rule.category+' '+rule.notes).includes(query)).sort((a,b)=>a.sortOrder-b.sortOrder);
  $('ruleCount').textContent=state.rules.length+' rules';$('ruleList').innerHTML=rules.map((rule,index)=>'<article class="ability-entry open"><div class="ability-summary"><div><div class="ability-name">'+(index+1)+'. '+esc(rule.title)+'</div><div class="ability-definition">'+esc(rule.description||'No description.')+'</div></div><span class="category-badge">'+esc(rule.category)+'</span></div><div class="ability-details"><p><span class="badge">'+esc(rule.visibility==='gm'?'GM-only':'Public')+'</span> <span class="badge">'+(rule.enabled?'Enabled':'Disabled')+'</span> <span class="muted">Version '+rule.version+' • '+esc(formatDateTime(rule.updatedAt))+'</span></p><div class="ability-actions">'+(canEditGame()?'<button class="secondary edit-rule" data-id="'+rule.id+'">Edit</button><button class="secondary duplicate-rule" data-id="'+rule.id+'">Duplicate</button><button class="secondary up-rule" data-id="'+rule.id+'">Move Up</button><button class="secondary down-rule" data-id="'+rule.id+'">Move Down</button><button class="danger delete-rule" data-id="'+rule.id+'">Delete</button>':'<span class="muted">Read only</span>')+'</div></div></article>').join('')||'<div class="empty-state">No rules match this filter.</div>';
  document.querySelectorAll('.edit-rule').forEach(button=>button.onclick=()=>beginRuleEdit(button.dataset.id));document.querySelectorAll('.duplicate-rule').forEach(button=>button.onclick=()=>duplicateRule(button.dataset.id));document.querySelectorAll('.up-rule').forEach(button=>button.onclick=()=>moveRule(button.dataset.id,-1));document.querySelectorAll('.down-rule').forEach(button=>button.onclick=()=>moveRule(button.dataset.id,1));document.querySelectorAll('.delete-rule').forEach(button=>button.onclick=()=>{const rule=state.rules.find(item=>item.id===button.dataset.id);if(rule&&confirm('Delete rule "'+rule.title+'"?')){state.rules=state.rules.filter(item=>item.id!==rule.id);state.rules.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((item,index)=>item.sortOrder=index);save('Rule deleted: '+rule.title+'.','RULE',rule.id)}});
}

function renderHistory(){
  if(cloudAudit.length){$('historyList').innerHTML=cloudAudit.map(event=>'<article class=\"history-entry\"><div class=\"history-phase\">'+esc(event.entity_type)+'</div><div><strong>'+esc(event.action)+'</strong><div class=\"muted\">'+esc(event.profiles?.display_name||'System')+(event.entity_id?' • '+esc(event.entity_id):'')+'</div></div><time class=\"history-time\">'+esc(formatDateTime(event.created_at))+'</time></article>').join('');return}
  $('historyList').innerHTML=[...state.history].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).map(event=>'<article class=\"history-entry\"><div class=\"history-phase\">'+esc(event.phase+' '+event.day)+'</div><div>'+esc(event.message)+'</div><time class=\"history-time\">'+esc(formatDateTime(event.timestamp))+'</time></article>').join('')||'<div class=\"empty-state\">No history events yet.</div>';
}
function renderSettings(){
  const game=currentGame();$('gameName').value=game.name;$('gameTheme').value=game.theme;$('gameDescription').value=game.description;$('gameStatus').value=game.status;$('currentDay').value=game.currentDay;$('currentPhase').value=game.currentPhase;$('gameNotes').value=game.notes;
  $('villagerLabel').value=state.settings.labels.VILLAGER;$('denLabel').value=state.settings.labels.DEN;$('neutralLabel').value=state.settings.labels.NEUTRAL;$('allowMultiDen').checked=state.settings.allowMultiDen;$('roleEditingAuthorized').checked=canEditRoles();
  $('gameShareCode').textContent=cloudContext?.game?.share_code||currentGame().shareCode||'—';const owner=currentGame().memberRole==='owner';$('memberList').innerHTML=(cloudContext?.members||[]).map(member=>'<span class="presence-chip">'+esc(member.profiles?.display_name||'GM')+' • '+esc(member.member_role)+(owner&&member.member_role!=='owner'?' <button class="member-role-btn secondary" data-user="'+member.user_id+'" data-role="'+(member.member_role==='gm'?'viewer':'gm')+'">Make '+(member.member_role==='gm'?'Viewer':'GM')+'</button>':'')+'</span>').join('')||'<span class="muted">Members load when connected.</span>';document.querySelectorAll('.member-role-btn').forEach(button=>button.onclick=async()=>{try{await GMCloud.setMemberRole(currentGame().id,button.dataset.user,button.dataset.role);await refreshOpenGame()}catch(error){alert(error.message)}});
}
function renderAll(){
  renderChrome();renderGames();if(!state)return;
  renderSelects();renderRoleAbilityPicker();renderRoleEditorAccess();renderDashboard();renderFactions();renderRoles();renderPlayers();renderQueue();renderStats();renderRules();renderEncyclopedia();renderHistory();renderSettings();
}

function metaFromCloud(row,existing={}){return normalizeMeta({...existing,id:row.id,name:row.name,theme:row.theme,description:row.description,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,shareCode:row.share_code,memberRole:row.member_role||existing.memberRole||'viewer'})}
async function refreshCloudGames(){
  const rows=await GMCloud.listGames(),previous=new Map(gameIndex.games.map(game=>[game.id,game]));gameIndex.games=rows.map(row=>metaFromCloud(row,previous.get(row.id)));if(!gameIndex.games.some(game=>game.id===gameIndex.activeGameId)){gameIndex.activeGameId=null;state=null}saveIndex();renderAll();
}
async function uploadDeviceGames(){
  const pending=deviceGameSnapshot.filter(saved=>!gameIndex.games.some(game=>game.id===saved.id));if(!pending.length)return;if(!confirm('Upload '+pending.length+' saved game(s) from this device to the shared Supabase database? Game setup, players, roles, notes, actions, rules, abilities, and history will be sent to your authenticated project.'))return;
  $('uploadDeviceGamesBtn').disabled=true;let uploaded=0;try{for(const saved of pending){const data=loadGameData(saved.id);await GMCloud.createGame({game:normalizeMeta(saved),data});uploaded++}await refreshCloudGames();alert(uploaded+' device save(s) uploaded successfully.')}catch(error){alert('Upload stopped after '+uploaded+' game(s): '+error.message);await refreshCloudGames()}finally{$('uploadDeviceGamesBtn').disabled=false}
}
function applyCloudDocument(row,updatedByName='Another GM'){
  const server=row.document||row,serverGame=server.game;if(!serverGame||!server.data)return;const existing=gameIndex.games.find(game=>game.id===serverGame.id)||{},meta=normalizeMeta({...existing,...serverGame,shareCode:cloudContext?.game?.share_code||existing.shareCode,memberRole:cloudContext?.members?.find(m=>m.user_id===GMCloud.user()?.id)?.member_role||existing.memberRole});const index=gameIndex.games.findIndex(game=>game.id===meta.id);if(index>=0)gameIndex.games[index]=meta;else gameIndex.games.push(meta);gameIndex.activeGameId=meta.id;state=migrateGameData(server.data,meta.id);cloudVersion=row.version||cloudVersion;state.lastSavedAt=row.updated_at||state.lastSavedAt;meta.lastSavedAt=state.lastSavedAt;localStorage.setItem(gameDataKey(meta.id),JSON.stringify(state));saveIndex();renderAll();$('roleLiveNotice').textContent=row.updated_by&&row.updated_by!==GMCloud.user()?.id?'Updated by '+updatedByName+' at '+new Date(row.updated_at).toLocaleTimeString():'';
}
async function refreshOpenGame(showConflict=false){
  if(!cloudSession||!currentGame())return;try{const [loaded,audit]=await Promise.all([GMCloud.loadGame(currentGame().id),GMCloud.history(currentGame().id)]);cloudContext=loaded;cloudAudit=audit;const mine=loaded.members.find(member=>member.user_id===GMCloud.user().id);currentGame().memberRole=mine?.member_role||'viewer';currentGame().shareCode=loaded.game.share_code;applyCloudDocument(loaded.document);setConnection('live','Live');if(showConflict)$('roleLiveNotice').textContent='The authoritative server version was reloaded after a concurrent edit.'}catch(error){setConnection('offline',navigator.onLine?'Sync error':'Offline');console.error(error)}
}
function renderPresence(presence){const entries=Object.values(presence).flat(),unique=[...new Map(entries.map(entry=>[entry.userId,entry])).values()];$('presenceList').innerHTML=unique.map(entry=>'<span class="presence-chip">'+esc(entry.name)+(entry.editing?' • editing '+esc(entry.editing):'')+'</span>').join('')||'<span class="muted">No connected GMs.</span>'}
async function subscribeToOpenGame(){
  if(!cloudSession||!currentGame()||cloudChannelGameId===currentGame().id)return;cloudChannelGameId=currentGame().id;setConnection('syncing','Connecting');await GMCloud.subscribe(currentGame().id,{onDocument:async row=>{if(row.version<=cloudVersion)return;if(row.updated_by===GMCloud.user()?.id){cloudVersion=Math.max(cloudVersion,row.version);return}if(cloudDirty||cloudSaveInFlight){alert('Another GM saved a newer change while you had unsaved edits. The newest server version will be loaded.');cloudDirty=false;await refreshOpenGame(true);return}const updater=cloudContext?.members?.find(member=>member.user_id===row.updated_by)?.profiles?.display_name||'Another GM';applyCloudDocument(row,updater)},onPresence:renderPresence,onStatus:async status=>{if(status==='SUBSCRIBED'){setConnection('live','Live');await refreshOpenGame()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setConnection('offline','Reconnecting');else if(status==='CLOSED')setConnection('offline','Offline')}})
}
async function handleCloudAuth(session){
  cloudSession=session;cloudChannelGameId=null;if(!session){gameIndex.activeGameId=null;state=null;cloudContext=null;setConnection('offline','Offline');renderAll();return}
  setConnection('syncing','Connecting');try{await refreshCloudGames();setConnection('live','Live')}catch(error){setConnection('offline','Sync error');$('authMessage').textContent='Could not load shared games: '+error.message;console.error(error)}
}
async function initializeCloud(){
  try{const result=await GMCloud.init(handleCloudAuth);cloudAvailable=result.available;if(!cloudAvailable){$('authMessage').textContent='The shared database client could not load. Check your network connection.';setConnection('offline','Offline');return}await handleCloudAuth(result.session)}catch(error){$('authMessage').textContent=error.message;setConnection('offline','Offline')}
}

document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{showView(tab.dataset.view);if(currentGame())GMCloud.track({view:tab.dataset.view,editing:null})}));
$('createGameBtn').onclick=()=>openGameForm();$('emptyCreateGameBtn').onclick=()=>openGameForm();$('cancelGameFormBtn').onclick=closeGameForm;$('saveGameFormBtn').onclick=submitGameForm;
$('uploadDeviceGamesBtn').onclick=uploadDeviceGames;
$('gamesSearch').addEventListener('input',renderGames);$('gamesSort').addEventListener('input',renderGames);
$('gameSwitcher').onchange=()=>{$('gameSwitcher').value?openGame($('gameSwitcher').value):unloadCurrentGame()};
$('saveGameBtn').onclick=()=>save('Manual save completed.','SAVE');
$('addFactionBtn').onclick=()=>{const name=$('factionName').value.trim(),className=$('factionClass').value;if(!name)return alert('Enter a faction name.');if(className==='DEN'&&!state.settings.allowMultiDen&&state.factions.some(faction=>faction.class==='DEN'))return alert('Multiple Den factions are disabled.');state.factions.push({id:id(),gameId:currentGame().id,name,class:className,alias:$('factionAlias').value.trim(),teamNumber:Number($('factionTeam').value)||1});$('factionName').value='';$('factionAlias').value='';save('Faction added: '+name+'.','FACTION')};
$('addRoleBtn').onclick=()=>{const fields=roleFormValues();if(!fields)return;const timestamp=now();if(editingRoleId){const role=roleById(editingRoleId);if(role.version!==editingRoleVersion)return showRoleError('This role was updated by another GM while you were editing. Review the latest version before saving.');Object.assign(role,fields,{version:role.version+1,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null});save('Role updated: '+role.name+'.','ROLE',role.id)}else{const role=normalizeRole({id:id(),gameId:currentGame().id,...fields,createdAt:timestamp,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null},currentGame().id);state.roles.push(role);save('Role added: '+fields.name+'.','ROLE',role.id)}clearRoleForm();GMCloud.track({view:'roles',editing:null})};
$('addPlayerBtn').onclick=()=>{const name=$('playerName').value.trim(),roleId=$('playerRole').value;if(!name||!roleById(roleId))return alert('Enter a player name and valid role.');state.players.push({id:id(),gameId:currentGame().id,name,roleId,alive:true});$('playerName').value='';save('Player added: '+name+'.','PLAYER')};
$('addActionBtn').onclick=()=>{const actor=playerById($('actionActor').value),target=playerById($('actionTarget').value);if(!actor||!target)return alert('Select valid living players.');const name=$('actionName').value.trim()||$('actionCategory').value;state.actions.push({id:id(),gameId:currentGame().id,actorId:actor.id,targetId:target.id,name,category:$('actionCategory').value});$('actionName').value='';save(actor.name+' queued '+name+' on '+target.name+'.','ACTION')};
$('addAbilityBtn').onclick=()=>{const name=$('abilityName').value.trim(),definition=$('abilityDefinition').value.trim();if(!name||!definition)return alert('Ability name and definition are required.');if(state.abilities.some(ability=>normalized(ability.name)===normalized(name)&&ability.id!==editingAbilityId))return alert('An ability with this name already exists.');const fields={name,category:$('abilityCategory').value,definition,phase:$('abilityPhase').value,mechanics:$('abilityMechanics').value.split(',').map(item=>item.trim().toLowerCase()).filter(Boolean)};if(editingAbilityId){const ability=state.abilities.find(item=>item.id===editingAbilityId),oldName=ability.name;ability.revisions.push(snapshotAbility(ability));Object.assign(ability,fields);if(normalized(oldName)!==normalized(name))state.roles.forEach(role=>role.tags=role.tags.map(tag=>normalized(tag)===normalized(oldName)?name:tag));save('Ability updated: '+name+'.','ABILITY')}else{state.abilities.push({id:id(),gameId:currentGame().id,...fields,builtIn:false,revisions:[]});save('Ability added: '+name+'.','ABILITY')}clearAbilityForm()};
$('cancelRoleEditBtn').onclick=()=>{clearRoleForm();GMCloud.track({view:'roles',editing:null})};$('cancelAbilityEditBtn').onclick=clearAbilityForm;
$('saveRuleBtn').onclick=()=>{if(!canEditGame())return alert('This game is read only.');const title=$('ruleTitle').value.trim(),description=$('ruleDescription').value.trim(),category=$('ruleCategory').value.trim();if(!title||!description||!category){$('ruleFormError').textContent='Title, description, and category are required.';$('ruleFormError').hidden=false;return}const timestamp=now(),fields={title,description,category,visibility:$('ruleVisibility').value,notes:$('ruleNotes').value.trim(),enabled:$('ruleEnabled').checked};if(editingRuleId){const rule=state.rules.find(item=>item.id===editingRuleId);if(!rule||rule.version!==editingRuleVersion){$('ruleFormError').textContent='This rule was updated by another GM. Review the latest version before saving.';$('ruleFormError').hidden=false;return}Object.assign(rule,fields,{version:rule.version+1,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null});save('Rule edited: '+rule.title+'.','RULE',rule.id)}else{const rule=normalizeRule({id:id(),gameId:currentGame().id,...fields,sortOrder:state.rules.length,createdAt:timestamp,updatedAt:timestamp,updatedBy:GMCloud.user()?.id||null},currentGame().id,state.rules.length);state.rules.push(rule);save('Rule created: '+rule.title+'.','RULE',rule.id)}clearRuleForm();GMCloud.track({view:'rules',editing:null})};$('cancelRuleEditBtn').onclick=()=>{clearRuleForm();GMCloud.track({view:'rules',editing:null})};
$('saveSettingsBtn').onclick=()=>{const game=currentGame(),name=$('gameName').value.trim();if(!name)return alert('Game name is required.');game.name=name;game.theme=$('gameTheme').value.trim();game.description=$('gameDescription').value.trim();game.status=$('gameStatus').value;game.currentDay=Math.max(0,Number($('currentDay').value)||0);game.currentPhase=$('currentPhase').value;game.notes=$('gameNotes').value.trim();state.settings.labels={VILLAGER:$('villagerLabel').value.trim()||'Villagers',DEN:$('denLabel').value.trim()||'Den',NEUTRAL:$('neutralLabel').value.trim()||'Neutrals'};state.settings.allowMultiDen=$('allowMultiDen').checked;state.settings.roleEditingAuthorized=$('roleEditingAuthorized').checked;save('Game settings updated.','SETTINGS')};
$('allowMultiDen').onchange=()=>{state.settings.allowMultiDen=$('allowMultiDen').checked;save('Multiple Den rule changed.','SETTINGS')};
$('roleEditingAuthorized').onchange=()=>{state.settings.roleEditingAuthorized=$('roleEditingAuthorized').checked;if(!canEditRoles())clearRoleForm();save('Role editing access changed.','SETTINGS')};
$('resetCurrentGameBtn').onclick=resetCurrentGame;$('archiveCurrentGameBtn').onclick=()=>archiveGame(currentGame().id);$('deleteCurrentGameBtn').onclick=()=>deleteGame(currentGame().id);
['roleSearch','roleFactionFilter','roleStatusFilter','roleSort'].forEach(elementId=>$(elementId).addEventListener('input',renderRoles));$('roleAbilitySearch').addEventListener('input',renderRoleAbilityPicker);['ruleSearch','ruleStatusFilter'].forEach(elementId=>$(elementId).addEventListener('input',renderRules));['playerSearch','playerLifeFilter'].forEach(elementId=>$(elementId).addEventListener('input',renderPlayers));['statsFactionFilter','aliveOnlyStats'].forEach(elementId=>$(elementId).addEventListener('input',renderStats));['abilitySearch','abilityCategoryFilter'].forEach(elementId=>$(elementId).addEventListener('input',renderEncyclopedia));
$('sendMagicLinkBtn').onclick=async()=>{const email=$('authEmail').value.trim(),name=$('authDisplayName').value.trim();if(!email)return $('authMessage').textContent='Enter your email address.';$('sendMagicLinkBtn').disabled=true;try{await GMCloud.signIn(email,name);$('authMessage').textContent='Check your email for the secure sign-in link.'}catch(error){$('authMessage').textContent=error.message}finally{$('sendMagicLinkBtn').disabled=false}};
$('passwordSignInBtn').onclick=async()=>{const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||password.length<8)return $('authMessage').textContent='Enter an email and a password of at least 8 characters.';$('passwordSignInBtn').disabled=true;try{await GMCloud.passwordSignIn(email,password);$('authMessage').textContent='Signed in.'}catch(error){$('authMessage').textContent=error.message}finally{$('passwordSignInBtn').disabled=false}};
$('createAccountBtn').onclick=async()=>{const email=$('authEmail').value.trim(),password=$('authPassword').value,name=$('authDisplayName').value.trim();if(!email||password.length<8||!name)return $('authMessage').textContent='Display name, email, and an 8+ character password are required.';$('createAccountBtn').disabled=true;try{const result=await GMCloud.createAccount(email,password,name);$('authMessage').textContent=result.session?'Account created and signed in.':'Account created. Check your email to confirm it.'}catch(error){$('authMessage').textContent=error.message}finally{$('createAccountBtn').disabled=false}};
$('signOutBtn').onclick=()=>GMCloud.signOut();
$('joinGameBtn').onclick=async()=>{const code=$('joinGameCode').value.trim();if(!code)return;try{const gameId=await GMCloud.joinGame(code);await refreshCloudGames();await openGame(gameId)}catch(error){alert(error.message)}};
$('copyShareCodeBtn').onclick=async()=>{const code=cloudContext?.game?.share_code;if(!code)return alert('No invite code is available.');await navigator.clipboard.writeText(code);$('copyShareCodeBtn').textContent='Copied';setTimeout(()=>$('copyShareCodeBtn').textContent='Copy Invite Code',1200)};
$('browseRoleTemplatesBtn').onclick=browseRoleTemplates;$('addRoleTemplateBtn').onclick=addSelectedRoleTemplate;
$('exportBtn').onclick=()=>{const game=currentGame();if(!game)return;const blob=new Blob([JSON.stringify({format:'gm-command-center-game-v4',version:4,game,data:state},null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=normalized(game.name).replace(/[^a-z0-9]+/g,'-')+'-game.json';link.click();URL.revokeObjectURL(link.href)};
$('importFile').onchange=event=>{const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{if(!cloudSession)throw new Error('Sign in before importing a shared game.');const imported=JSON.parse(reader.result),source=imported.data||imported,sourceMeta=imported.game||{},gameId=id(),createdAt=now(),data=migrateGameData(source,gameId),game=normalizeMeta({...sourceMeta,id:gameId,name:sourceMeta.name||source.settings?.gameName||'Imported Game',createdAt,updatedAt:createdAt,playerCount:data.players.length});data.gameId=gameId;data.lastSavedAt=createdAt;data.history.push({id:id(),gameId,type:'IMPORT',message:'Game imported as a separate saved game.',day:game.currentDay,phase:game.currentPhase,timestamp:createdAt});game.lastSavedAt=createdAt;const created=await GMCloud.createGame({game,data});game.memberRole='owner';game.shareCode=created[0]?.share_code||'';cloudVersion=created[0]?.version||1;localStorage.setItem(gameDataKey(gameId),JSON.stringify(data));gameIndex.games.push(game);gameIndex.activeGameId=gameId;state=data;saveIndex();renderAll();showView('dashboardView');await refreshOpenGame();await subscribeToOpenGame()}catch(error){alert(error.message||'Invalid game file.')}event.target.value=''};reader.readAsText(file)};

renderAll();
initializeCloud();
