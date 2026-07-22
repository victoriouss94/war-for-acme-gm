
const APP_VERSION = "2.2";
const PHASES = ["Day Discussion","Voting","Night Actions","Resolution","Morning Announcement"];
const STATUSES = ["Protected","Blocked","Poisoned","Bleeding","Marked","Silenced","Redirected","Controlled","Wanted","Delayed","Converted","Immune"];
const TEMP_STATUSES = ["Protected","Blocked","Silenced","Redirected","Controlled","Delayed"];
const MECHANICS = [
  ["Instant Kills",["Instant Kill"]],["Super Kills",["Super Kill"]],["Omega Kills",["Omega Kill"]],
  ["Intel",["Intel","Ask","Watcher","Tracker","Role Reveal","Graveyard"]],
  ["Protection",["Protection","Bodyguard","Guard"]],["Blocks",["Roleblock","Block"]],
  ["Redirects",["Redirect","Target Control"]],["Poison",["Poison"]],["Bleed",["Bleed"]],
  ["Marks",["Mark","Hunt","Wanted"]],["Conversions",["Conversion","Faction Change"]]
];

const PRIORITY_RULES = [
  {terms:["Omega Kill"],priority:100,killTier:"Omega Kill"},
  {terms:["Super Kill"],priority:95,killTier:"Super Kill"},
  {terms:["Instant Kill"],priority:90,killTier:"Instant Kill"},
  {terms:["Protection","Bodyguard","Guard"],priority:20,killTier:"None"},
  {terms:["Redirect","Target Control"],priority:15,killTier:"None"},
  {terms:["Roleblock","Block"],priority:10,killTier:"None"},
  {terms:["Watcher","Tracker","Intel","Ask","Role Reveal","Graveyard"],priority:50,killTier:"None"},
  {terms:["Poison"],priority:60,killTier:"None"},
  {terms:["Bleed"],priority:60,killTier:"None"},
  {terms:["Mark","Hunt","Wanted"],priority:55,killTier:"None"},
  {terms:["Conversion","Faction Change"],priority:65,killTier:"None"}
];

function defaultPriorityFor(type){
  const rule=PRIORITY_RULES.find(r=>r.terms.some(t=>String(type||"").toLowerCase().includes(t.toLowerCase())));
  return rule?.priority ?? 50;
}
function defaultKillTierFor(type){
  const rule=PRIORITY_RULES.find(r=>r.terms.some(t=>String(type||"").toLowerCase().includes(t.toLowerCase())));
  return rule?.killTier ?? "None";
}


const SUPABASE_URL = "https://bipjqwemwqivyassibqm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5fOm-lKPZBxmd6LAMDiGSw_SvVCCsk4";
const SHARED_ROOM_CODE = "ACME54";
const SHARED_GAME_NAME = "War for ACME";

const CLOUD_CLIENT_ID = crypto.randomUUID();
let cloud = null;
let realtimeChannel = null;
let cloudConnected = false;
let applyingRemoteState = false;
let cloudSaveTimer = null;
let latestCloudTimestamp = "";
let currentGmName = localStorage.getItem("war-for-acme-gm-name") || "";

function setSyncStatus(status, details=""){
  const dot=document.getElementById("syncDot");
  const label=document.getElementById("syncStatus");
  const detail=document.getElementById("syncDetails");
  if(!dot||!label||!detail)return;
  dot.className=`sync-dot ${status}`;
  const names={
    online:"Connected",
    syncing:"Syncing…",
    offline:"Offline / local mode",
    error:"Sync error"
  };
  label.textContent=names[status]||status;
  detail.textContent=details;
}

function stateHasGameData(value){
  return Boolean(
    value &&
    (
      (value.players&&value.players.length) ||
      (value.queue&&value.queue.length) ||
      (value.log&&value.log.length) ||
      (value.timeline&&value.timeline.length) ||
      value.day>1 ||
      value.worldDomination?.progress>0 ||
      value.worldDomination?.active
    )
  );
}

function normalizeRemoteState(remote){
  const merged={...defaultState(),...(remote||{})};
  if(!merged.timeline)merged.timeline=[];
  if(!merged.conversions)merged.conversions=[];
  if(!merged.resolutionHistory)merged.resolutionHistory=[];
  merged.players=(merged.players||[]).map(p=>({
    ...p,
    originalFaction:p.originalFaction||p.faction,
    convertedToWarner:Boolean(p.convertedToWarner),
    statuses:p.statuses||{},
    statusDurations:p.statusDurations||{},
    abilities:p.abilities||[]
  }));
  return merged;
}

function scheduleCloudSave(){
  if(!cloudConnected||applyingRemoteState||!currentGmName)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>pushStateToCloud(),350);
}

async function pushStateToCloud(force=false){
  if(!cloud||!currentGmName){
    if(force)alert("Enter your GM name and connect first.");
    return;
  }
  try{
    setSyncStatus("syncing",`Saving changes by ${currentGmName}…`);
    const updatedAt=new Date().toISOString();
    state.syncMeta={
      clientId:CLOUD_CLIENT_ID,
      revision:Date.now(),
      gmName:currentGmName,
      roomCode:SHARED_ROOM_CODE
    };
    localStorage.setItem("war-for-acme-v15",JSON.stringify(state));

    const {data,error}=await cloud
      .from("game_rooms")
      .upsert({
        room_code:SHARED_ROOM_CODE,
        game_name:SHARED_GAME_NAME,
        game_state:state,
        updated_at:updatedAt,
        updated_by:currentGmName
      },{onConflict:"room_code"})
      .select()
      .single();

    if(error)throw error;
    latestCloudTimestamp=data?.updated_at||updatedAt;
    cloudConnected=true;
    setSyncStatus("online",`Room ${SHARED_ROOM_CODE} • Last saved by ${currentGmName}`);
  }catch(error){
    cloudConnected=false;
    setSyncStatus("error",`Cloud save failed. Local copy is safe. ${error.message}`);
    console.error("Supabase save error:",error);
  }
}

function applyCloudRow(row){
  if(!row||!row.game_state)return;
  const remote=row.game_state;
  if(remote.syncMeta?.clientId===CLOUD_CLIENT_ID){
    latestCloudTimestamp=row.updated_at||latestCloudTimestamp;
    setSyncStatus("online",`Room ${SHARED_ROOM_CODE} • Your changes are synced`);
    return;
  }
  if(latestCloudTimestamp&&row.updated_at&&row.updated_at<latestCloudTimestamp)return;

  applyingRemoteState=true;
  state=normalizeRemoteState(remote);
  latestCloudTimestamp=row.updated_at||latestCloudTimestamp;
  localStorage.setItem("war-for-acme-v15",JSON.stringify(state));
  render();
  applyingRemoteState=false;
  setSyncStatus("online",`Updated by ${row.updated_by||"another GM"} • ${new Date(row.updated_at).toLocaleTimeString()}`);
}

async function connectSharedRoom(){
  currentGmName=(document.getElementById("gmNameInput")?.value||"").trim();
  if(!currentGmName)return alert("Enter your GM name first.");
  localStorage.setItem("war-for-acme-gm-name",currentGmName);

  try{
    if(!window.supabase?.createClient)throw new Error("Supabase client did not load.");
    setSyncStatus("syncing","Connecting to shared room…");
    cloud=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

    const {data,error}=await cloud
      .from("game_rooms")
      .select("*")
      .eq("room_code",SHARED_ROOM_CODE)
      .single();

    if(error)throw error;

    if(stateHasGameData(data?.game_state)){
      const localHasData=stateHasGameData(state);
      if(localHasData){
        const useCloud=confirm(
          `Shared room ${SHARED_ROOM_CODE} already contains game data last updated by ${data.updated_by}.\n\n`+
          `Press OK to load the shared cloud game.\nPress Cancel to upload this browser's local game instead.`
        );
        if(useCloud)applyCloudRow(data);
        else await pushStateToCloud(true);
      }else{
        applyCloudRow(data);
      }
    }else{
      cloudConnected=true;
      await pushStateToCloud(true);
    }

    if(realtimeChannel)await cloud.removeChannel(realtimeChannel);
    realtimeChannel=cloud
      .channel(`game-room-${SHARED_ROOM_CODE}`)
      .on(
        "postgres_changes",
        {
          event:"*",
          schema:"public",
          table:"game_rooms",
          filter:`room_code=eq.${SHARED_ROOM_CODE}`
        },
        payload=>applyCloudRow(payload.new)
      )
      .subscribe(status=>{
        if(status==="SUBSCRIBED"){
          cloudConnected=true;
          setSyncStatus("online",`Room ${SHARED_ROOM_CODE} • Connected as ${currentGmName}`);
        }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){
          cloudConnected=false;
          setSyncStatus("offline","Realtime disconnected. Local changes are still saved.");
        }
      });
  }catch(error){
    cloudConnected=false;
    setSyncStatus("error",`Connection failed: ${error.message}`);
    console.error("Supabase connection error:",error);
  }
}

window.addEventListener("online",()=>{
  setSyncStatus("syncing","Internet restored. Reconnecting…");
  if(currentGmName)connectSharedRoom();
});
window.addEventListener("offline",()=>{
  cloudConnected=false;
  setSyncStatus("offline","No internet. Changes are being kept locally.");
});

let database = {characters:[],abilities:[],mechanics:[]};
let state = loadState();

function defaultState(){
  return {
    version:APP_VERSION,day:1,phaseIndex:0,players:[],queue:[],log:[],archive:[],
    worldDomination:{progress:0,goal:3,active:false},worldEvents:[],resolutionHistory:[],testingMode:false,timeline:[],conversions:[]
  };
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem("war-for-acme-v15"));
    if(!saved)return defaultState();
    const merged={...defaultState(),...saved};
    if(!merged.timeline)merged.timeline=[];
    if(typeof merged.testingMode!=="boolean")merged.testingMode=false;
    if(!merged.conversions)merged.conversions=[];
    merged.players.forEach(p=>{if(!p.originalFaction)p.originalFaction=p.faction; if(typeof p.convertedToWarner!=="boolean")p.convertedToWarner=false;});
    return merged;
  }catch{return defaultState();}
}
function save(){
  localStorage.setItem("war-for-acme-v15",JSON.stringify(state));
  render();
  scheduleCloudSave();
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function addLog(text){
  const entry={day:state.day,phase:PHASES[state.phaseIndex],time:new Date().toLocaleTimeString(),timestamp:new Date().toISOString(),text};
  state.log.unshift(entry);
  state.timeline.unshift({...entry,type:"LOG"});
}
function parseUses(value){
  const match=String(value||"").match(/(\d+)/);
  if(match)return Number(match[1]);
  if(/each night|unlimited/i.test(String(value)))return 999;
  return 1;
}
function mechanicMatches(type,terms){
  return terms.some(term=>String(type||"").toLowerCase().includes(term.toLowerCase()));
}
function characterAbilities(name){
  return database.abilities.filter(a=>a.character===name);
}
function characterById(id){return database.characters.find(c=>c.id===id);}
function playerById(id){return state.players.find(p=>p.id===id);}

async function initialize(){
  try{
    const response=await fetch("data/master_database.json",{cache:"no-store"});
    if(!response.ok)throw new Error("Database could not be loaded.");
    database=await response.json();
  }catch(error){
    alert("The character database did not load. Refresh the GitHub Pages website. Details: "+error.message);
  }
  bindEvents();
  renderCharacterOptions();
  render();

  gmNameInput.value=currentGmName;
  if(currentGmName)connectSharedRoom();
  else setSyncStatus("offline","Enter your GM name to connect to room ACME54.");
}

function bindEvents(){
  document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab,.view").forEach(el=>el.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.view).classList.add("active");
  }));

  addFactionFilter.addEventListener("change",renderCharacterOptions);
  characterSelect.addEventListener("change",renderCharacterPreview);
  addPlayerBtn.addEventListener("click",addPlayer);

  [playerFactionFilter,playerLifeFilter,playerStatusFilter].forEach(el=>el.addEventListener("change",renderPlayers));
  playerSearch.addEventListener("input",renderPlayers);

  actionActor.addEventListener("change",()=>{renderAbilityOptions();updateActionAssistant();});
  actionAbility.addEventListener("change",updateActionAssistant);
  queueActionBtn.addEventListener("click",queueAction);
  sortQueueBtn.addEventListener("click",()=>{state.queue.sort((a,b)=>a.priority-b.priority);save();});
  resolveAllBtn.addEventListener("click",resolveAll);
  clearQueueBtn.addEventListener("click",()=>{if(confirm("Clear every queued action?")){state.queue=[];save();}});
  archiveNightBtn.addEventListener("click",archiveNight);

  generateReportsBtn.addEventListener("click",generateReports);
  addWorldEventBtn.addEventListener("click",addWorldEvent);

  databaseSearch.addEventListener("input",renderDatabase);
  databaseFactionFilter.addEventListener("change",renderDatabase);

  addManualLogBtn.addEventListener("click",()=>{
    const text=manualLogText.value.trim();
    if(text){addLog(text);manualLogText.value="";save();}
  });

  advancePhaseBtn.addEventListener("click",advancePhase);
  advanceDayBtn.addEventListener("click",advanceDay);
  worldMinusBtn.addEventListener("click",()=>changeWorldProgress(-1));
  worldPlusBtn.addEventListener("click",()=>changeWorldProgress(1));
  worldToggleBtn.addEventListener("click",toggleWorldDomination);

  undoResolutionBtn.addEventListener("click",undoLastResolution);
  backupBtn.addEventListener("click",downloadBackup);
  loadBtn.addEventListener("click",()=>loadFile.click());
  loadFile.addEventListener("change",event=>loadBackup(event.target.files[0]));
  resetBtn.addEventListener("click",resetGame);
  saveSetupBtn.addEventListener("click",saveRosterSetup);
  loadSetupBtn.addEventListener("click",loadRosterSetup);
  jumpQueueBtn.addEventListener("click",()=>activateView("queueView"));
  jumpReportsBtn.addEventListener("click",()=>activateView("reportsView"));
  toggleTestingBtn.addEventListener("click",toggleTestingMode);
  clearTestBtn.addEventListener("click",clearTestingData);
  timelineDayFilter.addEventListener("change",renderTimeline);
  exportTimelineBtn.addEventListener("click",exportTimeline);
  convertPlayerBtn.addEventListener("click",convertPlayerToWarner);
  connectSyncBtn.addEventListener("click",connectSharedRoom);
  forceSyncBtn.addEventListener("click",()=>pushStateToCloud(true));
  gmNameInput.addEventListener("keydown",event=>{if(event.key==="Enter")connectSharedRoom();});
}

function activateView(viewId){
  document.querySelectorAll(".tab,.view").forEach(el=>el.classList.remove("active"));
  const tab=[...document.querySelectorAll(".tab")].find(t=>t.dataset.view===viewId);
  if(tab)tab.classList.add("active");
  document.getElementById(viewId)?.classList.add("active");
}

function renderCharacterOptions(){
  const faction=addFactionFilter.value;
  const list=database.characters.filter(c=>faction==="ALL"||c.faction===faction);
  characterSelect.innerHTML=list.map(c=>`<option value="${c.id}">${escapeHtml(c.character)} — ${escapeHtml(c.role)}</option>`).join("");
  renderCharacterPreview();
}
function renderCharacterPreview(){
  const c=characterById(characterSelect.value);
  characterPreview.innerHTML=c?`
    <strong>${escapeHtml(c.character)}</strong><div class="role-line">${escapeHtml(c.faction)} • ${escapeHtml(c.role)}</div>
    <p>${escapeHtml(c.purpose)}</p>
    ${c.passive_name||c.passive_description?`<div><strong>Passive:</strong> ${escapeHtml(c.passive_name)} — ${escapeHtml(c.passive_description)}</div>`:""}
    ${c.signature_name?`<div><strong>Signature:</strong> ${escapeHtml(c.signature_name)} — ${escapeHtml(c.signature_description)}</div>`:""}
  `:'<div class="empty">No character available.</div>';
}
function addPlayer(){
  const c=characterById(characterSelect.value);
  if(!c)return;
  const name=playerName.value.trim()||"Unnamed Player";
  const abilities=characterAbilities(c.character).map(a=>({
    name:a.ability_name,type:a.mechanic_type,description:a.description,
    max:parseUses(a.uses),used:0,resets:a.resets_each_day==="Yes"
  }));
  state.players.push({
    id:crypto.randomUUID(),name,characterId:c.id,character:c.character,role:c.role,faction:c.faction,originalFaction:c.faction,convertedToWarner:false,conversionNote:"",
    purpose:c.purpose,passiveName:c.passive_name||"",passive:c.passive_description||"",
    signatureName:c.signature_name||"",signature:c.signature_description||"",
    winCondition:c.win_condition||"Win with faction.",alive:true,statuses:{},statusDurations:{},
    abilities,wildcardProgress:0,wildcardGoal:3
  });
  addLog(`${name} was assigned ${c.character}.`);
  playerName.value="";
  save();
}

function filteredPlayers(){
  const search=playerSearch.value.toLowerCase();
  return state.players.filter(p=>
    (playerFactionFilter.value==="ALL"||p.faction===playerFactionFilter.value)&&
    (playerLifeFilter.value==="ALL"||(playerLifeFilter.value==="ALIVE"&&p.alive)||(playerLifeFilter.value==="DEAD"&&!p.alive))&&
    (playerStatusFilter.value==="ALL"||p.statuses[playerStatusFilter.value])&&
    (!search||p.name.toLowerCase().includes(search)||p.character.toLowerCase().includes(search))
  );
}
function renderPlayers(){
  const list=filteredPlayers();
  playersGrid.innerHTML=list.length?list.map(p=>`
    <article class="player-card ${p.alive?"":"dead"}" data-player="${p.id}">
      <div class="card-head">
        <div><div class="player-name">${escapeHtml(p.name)}</div><div class="role-line">${escapeHtml(p.character)} • ${escapeHtml(p.role)} • ${escapeHtml(p.faction)}</div></div>
        <span class="badge">${p.alive?"ALIVE":"DEAD"}</span>
      </div>
      <div class="info-box">
        <strong>Purpose:</strong> ${escapeHtml(p.purpose)}
        ${p.passive?`<br><strong>Passive:</strong> ${escapeHtml(p.passiveName)} — ${escapeHtml(p.passive)}`:""}
        ${p.signature?`<br><strong>Signature:</strong> ${escapeHtml(p.signatureName)} — ${escapeHtml(p.signature)}`:""}
        ${p.faction==="Independent Wildcard"?`<br><strong>Win condition:</strong> ${escapeHtml(p.winCondition)}`:""}
      </div>
      ${p.faction==="Independent Wildcard"?`
        <div class="progress-line">
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,(p.wildcardProgress/p.wildcardGoal)*100)}%"></div></div>
          <strong>${p.wildcardProgress}/${p.wildcardGoal}</strong>
        </div>
        <div class="actions"><button data-progress="-1" class="secondary">− Win Progress</button><button data-progress="1">+ Win Progress</button></div>
      `:""}
      <div class="status-grid">${STATUSES.map(s=>`<label class="status-toggle"><input type="checkbox" data-status="${s}" ${p.statuses[s]?"checked":""}> ${s}${p.statusDurations?.[s]!=null?` (${p.statusDurations[s]})`:""}</label>`).join("")}</div>
      <div>${p.abilities.length?p.abilities.map((a,i)=>`
        <div class="ability-row">
          <strong>${escapeHtml(a.name)}</strong> <span class="badge">${escapeHtml(a.type)}</span>
          <small>${escapeHtml(a.description)} • ${a.max===999?`Used today: ${a.used}`:`${a.used}/${a.max} used`}</small>
          <div class="actions"><button data-use="${i}">Use</button><button data-undo-use="${i}" class="secondary">Undo</button></div>
        </div>`).join(""):'<div class="muted">No normalized ability records yet.</div>'}</div>
      <div class="actions"><button data-life class="${p.alive?"danger":"success"}">${p.alive?"Mark Dead":"Revive"}</button><button data-remove class="secondary">Remove</button></div>
    </article>
  `).join(""):'<div class="empty">No matching players.</div>';

  playersGrid.querySelectorAll("[data-player]").forEach(card=>{
    const p=playerById(card.dataset.player);
    card.querySelectorAll("[data-status]").forEach(box=>box.addEventListener("change",()=>{p.statuses[box.dataset.status]=box.checked;save();}));
    card.querySelectorAll("[data-use]").forEach(btn=>btn.addEventListener("click",()=>useAbility(p,Number(btn.dataset.use),1)));
    card.querySelectorAll("[data-undo-use]").forEach(btn=>btn.addEventListener("click",()=>useAbility(p,Number(btn.dataset.undoUse),-1)));
    card.querySelectorAll("[data-progress]").forEach(btn=>btn.addEventListener("click",()=>{p.wildcardProgress=Math.max(0,Math.min(p.wildcardGoal,p.wildcardProgress+Number(btn.dataset.progress)));save();}));
    card.querySelector("[data-life]").addEventListener("click",()=>{p.alive=!p.alive;addLog(`${p.name} is now ${p.alive?"alive":"dead"}.`);save();});
    card.querySelector("[data-remove]").addEventListener("click",()=>{if(confirm(`Remove ${p.name}?`)){state.players=state.players.filter(x=>x.id!==p.id);save();}});
  });
}
function useAbility(player,index,change){
  const a=player.abilities[index];
  if(change>0&&a.used>=a.max)return alert("No uses remain.");
  a.used=Math.max(0,a.used+change);
  addLog(`${change>0?"Used":"Restored"} ${player.name}'s ability: ${a.name}.`);
  save();
}

function renderActionSelectors(){
  const alive=state.players.filter(p=>p.alive);
  const options=alive.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.character)}</option>`).join("");
  actionActor.innerHTML=options;
  actionTargets.innerHTML=options;
  protectionSource.innerHTML='<option value="">None / unknown</option>'+options;
  redirectedTarget.innerHTML='<option value="">None</option>'+options;
  renderAbilityOptions();
}
function renderAbilityOptions(){
  const actor=playerById(actionActor.value);
  actionAbility.innerHTML=actor&&actor.abilities.length?actor.abilities.map((a,i)=>`<option value="${i}">${escapeHtml(a.name)} — ${escapeHtml(a.type)}</option>`).join(""):'<option value="">No abilities</option>';
  updateActionAssistant();
}

function updateActionAssistant(){
  const actor=playerById(actionActor.value);
  const ability=actor?.abilities[Number(actionAbility.value)];
  if(!ability){
    actionAssistantPreview.innerHTML='<div class="muted">Select an actor and ability.</div>';
    return;
  }
  const priority=defaultPriorityFor(ability.type);
  const killTier=defaultKillTierFor(ability.type);
  actionPriority.value=priority;
  actionKillTier.value=killTier;
  actionAssistantPreview.innerHTML=`
    <strong>Action Assistant</strong><br>
    Suggested priority: <strong>${priority}</strong><br>
    Suggested kill tier: <strong>${escapeHtml(killTier)}</strong><br>
    Mechanic: <strong>${escapeHtml(ability.type)}</strong><br>
    ${escapeHtml(ability.description)}
  `;
}
function queueAction(){
  const actor=playerById(actionActor.value);
  if(!actor)return alert("Add players first.");
  const abilityIndex=Number(actionAbility.value);
  const ability=actor.abilities[abilityIndex];
  if(!ability)return alert("This character has no normalized ability record.");

  const targetIds=[...actionTargets.selectedOptions].map(o=>o.value);
  const targetNames=targetIds.map(id=>playerById(id)?.name).filter(Boolean);
  const source=playerById(protectionSource.value);
  const redirected=playerById(redirectedTarget.value);

  state.queue.push({
    id:crypto.randomUUID(),
    actorId:actor.id,
    actorName:actor.name,
    character:actor.character,
    abilityIndex,
    abilityName:ability.name,
    type:ability.type,
    targetIds,
    targetNames,
    priority:Number(actionPriority.value)||50,
    killTier:actionKillTier.value,
    result:actionResult.value,
    reason:actionReason.value,
    affectedPlayer:affectedPlayer.value,
    sourceId:source?.id||"",
    sourceName:source?.name||"",
    redirectedTargetId:redirected?.id||"",
    redirectedTargetName:redirected?.name||"",
    statusApplied:statusApplied.value,
    statusDuration:Math.max(0,Number(statusDuration.value)||0),
    note:actionNote.value.trim(),
    resolved:false
  });

  addLog(`Queued: ${actor.name} used ${ability.name} on ${targetNames.join(", ")||"no target"} at priority ${Number(actionPriority.value)||50}.`);
  actionNote.value="";
  save();
}
function renderQueue(){
  const pending=state.queue.filter(q=>!q.resolved).length;
  queueSummary.textContent=`${state.queue.length} actions • ${pending} pending • ${state.queue.length-pending} resolved`;

  const ordered=[...state.queue].sort((a,b)=>a.priority-b.priority);
  queueList.innerHTML=ordered.length?ordered.map(q=>`
    <article class="queue-card ${q.resolved?"resolved":""}" data-action="${q.id}">
      <div class="card-head">
        <strong>${escapeHtml(q.actorName)} — ${escapeHtml(q.abilityName)}</strong>
        <span class="badge">Priority ${q.priority}</span>
      </div>
      <div class="queue-meta">Original targets: ${escapeHtml(q.targetNames.join(", ")||"None")} • ${escapeHtml(q.type)} • ${escapeHtml(q.killTier)}</div>

      <div class="resolution-details">
        <div><strong>Result:</strong> ${escapeHtml(q.result||"Pending")}</div>
        <div><strong>Reason:</strong> ${escapeHtml(q.reason||"None")}</div>
        <div><strong>Affected:</strong> ${escapeHtml(q.affectedPlayer||"TARGET")}</div>
        <div><strong>Source:</strong> ${escapeHtml(q.sourceName||"None")}</div>
        <div><strong>Redirected target:</strong> ${escapeHtml(q.redirectedTargetName||"None")}</div>
        <div><strong>Status applied:</strong> ${escapeHtml(q.statusApplied||"None")} ${q.statusDuration?`(${q.statusDuration} day${q.statusDuration===1?"":"s"})`:""}</div>
      </div>

      ${q.note?`<div class="queue-meta">GM note: ${escapeHtml(q.note)}</div>`:""}

      <div class="actions">
        <button data-resolve class="${q.resolved?"secondary":"success"}">${q.resolved?"Resolved":"Resolve"}</button>
        <button data-delete class="danger">Remove</button>
      </div>
    </article>
  `).join(""):'<div class="empty">No actions queued.</div>';

  queueList.querySelectorAll("[data-action]").forEach(card=>{
    const action=state.queue.find(q=>q.id===card.dataset.action);
    card.querySelector("[data-resolve]").addEventListener("click",()=>resolveAction(action.id));
    card.querySelector("[data-delete]").addEventListener("click",()=>{
      state.queue=state.queue.filter(q=>q.id!==action.id);
      save();
    });
  });
}
function resolveAction(id){
  const q=state.queue.find(x=>x.id===id);
  if(!q||q.resolved)return;
  if((q.result||"Pending")==="Pending")return alert("Choose an action result before resolving.");

  state.resolutionHistory.push(JSON.stringify({
    players:state.players,
    queue:state.queue,
    log:state.log
  }));

  const actor=playerById(q.actorId);
  const ability=actor?.abilities[q.abilityIndex];
  if(ability&&ability.used<ability.max)ability.used++;

  const originalTargets=q.targetIds.map(playerById).filter(Boolean);
  const redirected=playerById(q.redirectedTargetId);

  let affectedTargets=originalTargets;
  if(q.reason==="Redirected"&&redirected)affectedTargets=[redirected];

  if(q.result==="Target Died")affectedTargets.forEach(p=>p.alive=false);

  let reasonTarget=null;
  if(q.affectedPlayer==="ACTOR")reasonTarget=actor;
  else if(q.affectedPlayer==="REDIRECTED_TARGET")reasonTarget=redirected;
  else reasonTarget=originalTargets[0]||null;

  if(reasonTarget){
    if(q.reason==="Blocked")reasonTarget.statuses.Blocked=true;
    if(q.reason==="Protected")reasonTarget.statuses.Protected=true;
    if(q.reason==="Delayed")reasonTarget.statuses.Delayed=true;
    if(q.reason==="Redirected")reasonTarget.statuses.Redirected=true;
    if(q.reason==="Immune")reasonTarget.statuses.Immune=true;
  }

  if(q.statusApplied!=="None"){
    affectedTargets.forEach(target=>{
      target.statuses[q.statusApplied]=true;
      target.statusDurations=target.statusDurations||{};
      target.statusDurations[q.statusApplied]=q.statusDuration;
    });
  }

  q.resolved=true;
  addLog(`Resolved: ${q.actorName} used ${q.abilityName} on ${q.targetNames.join(", ")||"no target"} — result ${q.result}; reason ${q.reason}.`);
  save();
}
function resolveAll(){
  const pending=[...state.queue].filter(q=>!q.resolved).sort((a,b)=>a.priority-b.priority);
  for(const q of pending){
    if((q.result||"Pending")==="Pending")continue;
    resolveAction(q.id);
  }
}
function undoLastResolution(){
  const snapshot=state.resolutionHistory.pop();
  if(!snapshot)return alert("There is no resolved action to undo.");
  const restored=JSON.parse(snapshot);
  state.players=restored.players;
  state.queue=restored.queue;
  state.log=restored.log;
  save();
}

function archiveNight(){
  const resolved=state.queue.filter(q=>q.resolved);
  if(!resolved.length)return alert("Resolve at least one action first.");
  state.archive.unshift({day:state.day,time:new Date().toLocaleString(),actions:JSON.parse(JSON.stringify(resolved))});
  addLog(`Night ${state.day} archived with ${resolved.length} resolved actions.`);
  save();
}

function generateReports(){
  const resolved=state.queue.filter(q=>q.resolved);
  const publicLines=[`══════════════════════`,`🌅 DAY ${state.day}`,""];
  const gmLines=[`GM NIGHT SUMMARY — DAY ${state.day}`,""];
  const playerLines=[];

  resolved.forEach(q=>{
    if(q.result==="Target Died")q.targetNames.forEach(name=>publicLines.push(`☠ ${name} has died.`));
    if(q.result==="Escaped Death")q.targetNames.forEach(name=>publicLines.push(`⚠ ${name} escaped death.`));
    gmLines.push(`• ${q.actorName} used ${q.abilityName} on ${q.targetNames.join(", ")||"no target"} — result ${q.result}; reason ${q.reason}${q.note?` (${q.note})`:""}.`);

    q.targetNames.forEach(name=>{
      if(q.reason==="Blocked")playerLines.push(`TO: ${name}\nYour ability was blocked.`);
      if(q.reason==="Protected")playerLines.push(`TO: ${name}\nYou were protected from an action.`);
      if(q.reason==="Immune")playerLines.push(`TO: ${name}\nAn ability failed because you were immune.`);
      if(q.reason==="Delayed")playerLines.push(`TO: ${name}\nYour action or effect was delayed.`);
      if(q.statusApplied==="Poisoned")playerLines.push(`TO: ${name}\nYou have been poisoned.`);
      if(q.statusApplied==="Bleeding")playerLines.push(`TO: ${name}\nYou are bleeding.`);
      if(q.statusApplied==="Marked")playerLines.push(`TO: ${name}\nYou have been marked.`);
    });
  });

  state.worldEvents.filter(e=>!e.archived).forEach(e=>publicLines.push(`🌍 ${e.text||e.title}`));
  if(publicLines.length===3)publicLines.push("Nothing publicly reportable happened.");
  if(resolved.length===0)gmLines.push("No resolved actions.");
  if(playerLines.length===0)playerLines.push("No private player messages were generated.");

  publicLines.push("","══════════════════════");
  publicReport.value=publicLines.join("\n");
  gmReport.value=gmLines.join("\n");
  playerMessages.value=playerLines.join("\n\n────────────\n\n");
}
function addWorldEvent(){
  const title=worldEventTitle.value.trim();
  const text=worldEventText.value.trim();
  if(!title&&!text)return alert("Enter a public world event.");
  state.worldEvents.push({id:crypto.randomUUID(),title:title||"World Event",text:text||title,day:state.day,archived:false});
  worldEventTitle.value="";worldEventText.value="";
  addLog(`Public world event added: ${text||title}.`);
  save();
}
function renderWorldEvents(){
  const events=state.worldEvents.filter(e=>!e.archived);
  worldEventsList.innerHTML=events.length?events.map(e=>`
    <div class="list-item" data-world-event="${e.id}">
      <strong>${escapeHtml(e.title)}</strong><div class="role-line">${escapeHtml(e.text)}</div>
      <div class="actions"><button data-remove-world class="danger">Remove</button></div>
    </div>`).join(""):'<div class="empty">No pending public world events.</div>';
  worldEventsList.querySelectorAll("[data-world-event]").forEach(item=>{
    item.querySelector("[data-remove-world]").addEventListener("click",()=>{
      state.worldEvents=state.worldEvents.filter(e=>e.id!==item.dataset.worldEvent);save();
    });
  });
}

function renderDatabase(){
  const search=databaseSearch.value.toLowerCase();
  const faction=databaseFactionFilter.value;
  const list=database.characters.filter(c=>{
    if(faction!=="ALL"&&c.faction!==faction)return false;
    const abilities=characterAbilities(c.character);
    const haystack=[c.character,c.faction,c.role,c.purpose,c.passive_name,c.passive_description,c.signature_name,c.signature_description,c.win_condition,...abilities.flatMap(a=>[a.ability_name,a.mechanic_type,a.description])].join(" ").toLowerCase();
    return !search||haystack.includes(search);
  });
  databaseResults.innerHTML=list.length?list.map(c=>{
    const abilities=characterAbilities(c.character);
    return `<article class="database-card">
      <div class="card-head"><div><strong>${escapeHtml(c.character)}</strong><div class="role-line">${escapeHtml(c.faction)} • ${escapeHtml(c.role)}</div></div><span class="badge">${escapeHtml(c.review||"")}</span></div>
      <p>${escapeHtml(c.purpose)}</p>
      ${c.passive_name||c.passive_description?`<div class="info-box"><strong>Passive:</strong> ${escapeHtml(c.passive_name)} — ${escapeHtml(c.passive_description)}</div>`:""}
      ${c.signature_name?`<div class="info-box"><strong>Signature:</strong> ${escapeHtml(c.signature_name)} — ${escapeHtml(c.signature_description)}</div>`:""}
      ${abilities.map(a=>`<div class="ability-row"><strong>${escapeHtml(a.ability_name)}</strong> <span class="badge">${escapeHtml(a.mechanic_type)}</span><small>${escapeHtml(a.description)} • ${escapeHtml(a.uses)}</small></div>`).join("")}
    </article>`;
  }).join(""):'<div class="empty">No matching characters.</div>';
}
function countMechanic(players,terms,aliveOnly){
  return players.filter(p=>!aliveOnly||p.alive).reduce((sum,p)=>sum+p.abilities.filter(a=>mechanicMatches(a.type,terms)).length,0);
}
function renderStatistics(){
  mechanicMetrics.innerHTML=MECHANICS.map(([label,terms])=>`<div class="metric"><strong>${countMechanic(state.players,terms,true)}</strong><span>${label} alive</span></div>`).join("");
  const factions=["ACME Defense Force","Warner Syndicate","Independent Wildcard"];
  mechanicsByFaction.innerHTML=factions.map(f=>{
    const players=state.players.filter(p=>p.alive&&p.faction===f);
    return `<div class="list-item"><strong>${escapeHtml(f)}</strong><div class="role-line">${players.length} alive • Offense ${countMechanic(players,["Kill"],false)} • Intel ${countMechanic(players,["Intel","Ask","Watcher","Tracker"],false)} • Protection ${countMechanic(players,["Protection","Bodyguard","Guard"],false)} • Control ${countMechanic(players,["Block","Redirect","Control","Conversion"],false)}</div></div>`;
  }).join("");

  const living=state.players.filter(p=>p.alive);
  const warnings=[];
  const protection=countMechanic(state.players,["Protection","Bodyguard","Guard"],true);
  const intel=countMechanic(state.players,["Intel","Ask","Watcher","Tracker","Role Reveal","Graveyard"],true);
  const highKills=countMechanic(state.players,["Instant Kill","Super Kill","Omega Kill"],true);
  if(living.length&&protection===0)warnings.push(["high","No living protection abilities remain."]);
  if(living.length&&intel===0)warnings.push(["high","No living information abilities remain."]);
  if(highKills>Math.max(3,Math.floor(living.length/4)))warnings.push(["high","The living roster contains a high concentration of powerful kills."]);
  if(!warnings.length)warnings.push(["good","No major roster warning detected."]);
  setupWarnings.innerHTML=warnings.map(([level,text])=>`<div class="warning ${level}">${escapeHtml(text)}</div>`).join("");
}

function interactionWarningsFor(action){
  if(!action)return [];
  const warnings=[];
  const actor=playerById(action.actorId);
  const targets=action.targetIds.map(playerById).filter(Boolean);

  if(!actor?.alive)warnings.push(["high","The acting player is dead. Confirm whether the action should still resolve."]);
  if(actor?.statuses.Blocked)warnings.push(["high","The acting player currently has the Blocked status."]);
  if(actor?.statuses.Silenced)warnings.push(["medium","The acting player is Silenced. Confirm whether silence affects this ability."]);

  targets.forEach(target=>{
    if(!target.alive)warnings.push(["high",`${target.name} is already dead.`]);
    if(target.statuses.Protected)warnings.push(["medium",`${target.name} is currently Protected.`]);
    if(target.statuses.Immune)warnings.push(["medium",`${target.name} currently has an Immunity status.`]);
    if(target.statuses.Redirected)warnings.push(["medium",`${target.name} has an active Redirected status.`]);
    if(target.passive)warnings.push(["good",`${target.name}'s passive: ${target.passive}`]);
  });

  if(action.killTier!=="None"){
    warnings.push(["medium",`Kill tier selected: ${action.killTier}. Compare it against the target's protection tier manually.`]);
  }
  if(state.worldDomination.active&&actor?.faction==="Warner Syndicate"){
    warnings.push(["good","World Domination is active for the Warner Syndicate. Check upgraded wording."]);
  }
  if(!warnings.length)warnings.push(["good","No obvious status conflict detected. The GM must still confirm card-specific exceptions."]);
  return warnings;
}

function renderLiveMode(){
  const alive=state.players.filter(p=>p.alive).length;
  const pending=state.queue.filter(q=>!q.resolved).sort((a,b)=>a.priority-b.priority);
  const resolved=state.queue.filter(q=>q.resolved).length;
  const next=pending[0];

  liveMetrics.innerHTML=[
    ["Day",state.day],["Phase",PHASES[state.phaseIndex]],["Alive",alive],
    ["Pending",pending.length],["Resolved Tonight",resolved]
  ].map(([label,value])=>`<div class="metric"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join("");

  nextActionPanel.innerHTML=next?`
    <div class="live-action-card">
      <h3>${escapeHtml(next.actorName)} → ${escapeHtml(next.abilityName)}</h3>
      <div class="role-line">Targets: ${escapeHtml(next.targetNames.join(", ")||"None")}</div>
      <div class="resolution-details">
        <div><strong>Priority:</strong> ${next.priority}</div>
        <div><strong>Mechanic:</strong> ${escapeHtml(next.type)}</div>
        <div><strong>Kill tier:</strong> ${escapeHtml(next.killTier)}</div>
        <div><strong>Current result:</strong> ${escapeHtml(next.result)}</div>
      </div>
      <div class="actions">
        <button id="liveOpenActionBtn">Open in Queue</button>
      </div>
    </div>`:'<div class="empty">No unresolved action is waiting.</div>';

  document.getElementById("liveOpenActionBtn")?.addEventListener("click",()=>activateView("queueView"));

  interactionAssistant.innerHTML=interactionWarningsFor(next).map(([level,text])=>`<div class="interaction-warning ${level}">${escapeHtml(text)}</div>`).join("");

  recentTimeline.innerHTML=(state.timeline||[]).slice(0,10).map(entry=>`
    <div class="timeline-entry">
      <div class="timeline-time">Day ${entry.day}<br>${escapeHtml(entry.phase)}<br>${escapeHtml(entry.time)}</div>
      <div>${escapeHtml(entry.text)}</div>
    </div>`).join("")||'<div class="empty">No timeline entries yet.</div>';

  testingStatus.textContent=state.testingMode?"Testing Mode is ON. Test data is marked and may be cleared safely.":"Testing Mode is off.";
  liveModeBadge.textContent=state.testingMode?"TEST MODE":"LIVE MODE";
  document.body.classList.toggle("testing-active",state.testingMode);
  toggleTestingBtn.textContent=state.testingMode?"Disable Testing Mode":"Enable Testing Mode";
}

function toggleTestingMode(){
  state.testingMode=!state.testingMode;
  addLog(`Testing Mode ${state.testingMode?"enabled":"disabled"}.`);
  save();
}
function clearTestingData(){
  if(!state.testingMode)return alert("Enable Testing Mode first.");
  if(!confirm("Clear all current players, actions, reports and test progress?"))return;
  state.players=[];
  state.queue=[];
  state.archive=[];
  state.worldEvents=[];
  state.worldDomination={progress:0,goal:3,active:false};
  addLog("Testing data cleared.");
  save();
}
function renderTimeline(){
  const days=[...new Set((state.timeline||[]).map(e=>e.day))].sort((a,b)=>a-b);
  const current=timelineDayFilter.value;
  timelineDayFilter.innerHTML='<option value="ALL">All days</option>'+days.map(day=>`<option value="${day}" ${String(day)===String(current)?"selected":""}>Day ${day}</option>`).join("");
  const filtered=(state.timeline||[]).filter(e=>current==="ALL"||String(e.day)===String(current));
  fullTimeline.innerHTML=filtered.length?filtered.map(entry=>`
    <div class="timeline-entry">
      <div class="timeline-time">Day ${entry.day}<br>${escapeHtml(entry.phase)}<br>${escapeHtml(entry.time)}</div>
      <div>${escapeHtml(entry.text)}</div>
    </div>`).join(""):'<div class="empty">No timeline entries match this filter.</div>';
}
function exportTimeline(){
  const lines=(state.timeline||[]).slice().reverse().map(e=>`Day ${e.day} | ${e.phase} | ${e.time} | ${e.text}`);
  const blob=new Blob([lines.join("\n")],{type:"text/plain"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  link.download=`war-for-acme-timeline-day-${state.day}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}


function renderConversionOptions(){
  const candidates=state.players.filter(p=>p.alive&&p.faction!=="Warner Syndicate");
  conversionPlayer.innerHTML=candidates.length
    ? candidates.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.character)} (${escapeHtml(p.faction)})</option>`).join("")
    : '<option value="">No eligible living player</option>';
}

function convertPlayerToWarner(){
  const player=playerById(conversionPlayer.value);
  if(!player)return alert("There is no eligible player to convert.");
  if(player.faction==="Warner Syndicate")return alert("This player is already in the Warner Syndicate.");

  player.originalFaction=player.originalFaction||player.faction;
  player.faction="Warner Syndicate";
  player.convertedToWarner=true;
  player.conversionNote=conversionNote.value.trim();
  player.statuses.Converted=true;

  state.conversions.push({
    id:crypto.randomUUID(),
    playerId:player.id,
    playerName:player.name,
    character:player.character,
    originalFaction:player.originalFaction,
    day:state.day,
    note:player.conversionNote,
    active:true
  });

  addLog(`${player.name} (${player.character}) was converted from ${player.originalFaction} to the Warner Syndicate.`);
  conversionNote.value="";
  save();
}

function revertWarnerConversion(playerId){
  const player=playerById(playerId);
  if(!player||!player.convertedToWarner)return;
  const oldFaction=player.originalFaction||"ACME Defense Force";
  player.faction=oldFaction;
  player.convertedToWarner=false;
  player.conversionNote="";
  player.statuses.Converted=false;

  const conversion=[...state.conversions].reverse().find(c=>c.playerId===playerId&&c.active);
  if(conversion)conversion.active=false;

  addLog(`${player.name}'s Warner conversion was reversed. They returned to ${oldFaction}.`);
  save();
}

function renderWarnerRoom(){
  renderConversionOptions();

  const members=state.players.filter(p=>p.faction==="Warner Syndicate");
  const native=members.filter(p=>!p.convertedToWarner);
  const converted=members.filter(p=>p.convertedToWarner);
  const alive=members.filter(p=>p.alive);

  warnerMetrics.innerHTML=[
    ["Total Members",members.length],
    ["Alive",alive.length],
    ["Native Warner",native.length],
    ["Converted",converted.length]
  ].map(([label,value])=>`<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const wd=state.worldDomination;
  warnerWorldBar.style.width=`${Math.min(100,(wd.progress/wd.goal)*100)}%`;
  warnerWorldText.textContent=`${wd.progress} / ${wd.goal}`;
  warnerWorldStatus.textContent=wd.active?"World Domination is ACTIVE.":"World Domination is inactive.";

  warnerRoster.innerHTML=members.length?members.map(p=>`
    <article class="player-card ${p.alive?"":"dead"}" data-warner-member="${p.id}">
      <div class="card-head">
        <div>
          <div class="player-name">${escapeHtml(p.name)}</div>
          <div class="role-line">${escapeHtml(p.character)} • ${escapeHtml(p.role)}</div>
        </div>
        <div>
          ${p.convertedToWarner?'<span class="converted-badge">CONVERTED</span>':'<span class="badge">NATIVE WARNER</span>'}
          <span class="badge">${p.alive?"ALIVE":"DEAD"}</span>
        </div>
      </div>

      ${p.convertedToWarner?`
        <div class="info-box">
          <strong>Original faction:</strong> ${escapeHtml(p.originalFaction)}<br>
          <strong>Conversion note:</strong> ${escapeHtml(p.conversionNote||"No note")}
        </div>`:""}

      <div class="info-box">
        <strong>Purpose:</strong> ${escapeHtml(p.purpose)}
        ${p.passive?`<br><strong>Passive:</strong> ${escapeHtml(p.passiveName)} — ${escapeHtml(p.passive)}`:""}
      </div>

      ${p.abilities.map(a=>`
        <div class="ability-row">
          <strong>${escapeHtml(a.name)}</strong> <span class="badge">${escapeHtml(a.type)}</span>
          <small>${escapeHtml(a.description)} • ${a.max===999?`Used today: ${a.used}`:`${a.used}/${a.max} used`}</small>
        </div>`).join("")}

      ${p.convertedToWarner?'<div class="actions"><button data-revert-conversion class="danger">Remove from Warner Syndicate</button></div>':""}
    </article>
  `).join(""):'<div class="empty">No Warner Syndicate members have been assigned.</div>';

  warnerRoster.querySelectorAll("[data-warner-member]").forEach(card=>{
    const playerId=card.dataset.warnerMember;
    card.querySelector("[data-revert-conversion]")?.addEventListener("click",()=>revertWarnerConversion(playerId));
  });

  convertedAbilityPool.innerHTML=converted.length?converted.map(p=>`
    <div class="ability-pool-group">
      <strong>${escapeHtml(p.name)} — ${escapeHtml(p.character)}</strong>
      <div class="role-line">Originally ${escapeHtml(p.originalFaction)}</div>
      ${p.abilities.length?p.abilities.map(a=>`
        <div class="ability-row">
          <strong>${escapeHtml(a.name)}</strong> <span class="badge">${escapeHtml(a.type)}</span>
          <small>${escapeHtml(a.description)}</small>
        </div>`).join(""):'<div class="muted">No normalized abilities available.</div>'}
    </div>
  `).join(""):'<div class="empty">No converted role abilities are currently available.</div>';
}

function renderDashboard(){
  const alive=state.players.filter(p=>p.alive).length;
  const dead=state.players.length-alive;
  const pending=state.queue.filter(q=>!q.resolved).length;
  dashboardMetrics.innerHTML=[
    ["Day",state.day],["Phase",PHASES[state.phaseIndex]],["Alive",alive],["Dead",dead],["Pending Actions",pending]
  ].map(([label,value])=>`<div class="metric"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join("");

  factionSnapshot.innerHTML=["ACME Defense Force","Warner Syndicate","Independent Wildcard"].map(f=>`
    <div class="list-item"><strong>${escapeHtml(f)}</strong><div class="role-line">${state.players.filter(p=>p.faction===f&&p.alive).length} alive / ${state.players.filter(p=>p.faction===f).length} assigned</div></div>
  `).join("");

  const alerts=STATUSES.map(s=>[s,state.players.filter(p=>p.alive&&p.statuses[s]).length]).filter(x=>x[1]);
  activeAlerts.innerHTML=alerts.length?alerts.map(([status,count])=>`<div class="list-item"><strong>${count}</strong> ${escapeHtml(status)}</div>`).join(""):'<div class="empty">No active status alerts.</div>';

  const wd=state.worldDomination;
  worldProgressBar.style.width=`${Math.min(100,(wd.progress/wd.goal)*100)}%`;
  worldProgressText.textContent=`${wd.progress} / ${wd.goal}`;
  worldStatus.textContent=wd.active?"World Domination is ACTIVE.":"World Domination is inactive.";
  worldToggleBtn.textContent=wd.active?"Deactivate":"Activate";
}
function changeWorldProgress(delta){
  const wd=state.worldDomination;
  wd.progress=Math.max(0,Math.min(wd.goal,wd.progress+delta));
  addLog(`World Domination progress changed to ${wd.progress}/${wd.goal}.`);
  save();
}
function toggleWorldDomination(){
  const wd=state.worldDomination;
  if(!wd.active&&wd.progress<wd.goal&&!confirm("Progress is incomplete. Activate anyway?"))return;
  wd.active=!wd.active;
  if(wd.active)state.worldEvents.push({id:crypto.randomUUID(),title:"World Domination",text:"World Domination has been activated.",day:state.day,archived:false});
  addLog(`World Domination is now ${wd.active?"active":"inactive"}.`);
  save();
}

function advancePhase(){
  state.phaseIndex=(state.phaseIndex+1)%PHASES.length;
  if(state.phaseIndex===0)state.day++;
  addLog(`Phase advanced to ${PHASES[state.phaseIndex]}.`);
  save();
}
function advanceDay(){
  state.day++;
  state.phaseIndex=0;
  state.players.forEach(p=>{
    TEMP_STATUSES.forEach(s=>p.statuses[s]=false);
    p.abilities.forEach(a=>{if(a.resets)a.used=0;});
    p.statusDurations=p.statusDurations||{};
    Object.keys(p.statusDurations).forEach(status=>{
      if(p.statusDurations[status]>0)p.statusDurations[status]--;
      if(p.statusDurations[status]===0){
        p.statuses[status]=false;
        delete p.statusDurations[status];
      }
    });
  });
  state.queue=[];
  state.worldEvents.forEach(e=>e.archived=true);
  addLog(`Advanced to Day ${state.day}. Temporary statuses, nightly ability usage, queue and public events were reset.`);
  save();
}
function downloadBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  link.download=`war-for-acme-day-${state.day}-backup.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function loadBackup(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{state={...defaultState(),...JSON.parse(reader.result)};save();}
    catch{alert("That backup file is invalid.");}
  };
  reader.readAsText(file);
}
function resetGame(){
  if(confirm("Reset the entire game? This removes players, actions, logs and progress.")){state=defaultState();save();}
}
function saveRosterSetup(){
  const setup=state.players.map(p=>({name:p.name,characterId:p.characterId}));
  localStorage.setItem("war-for-acme-roster-setup",JSON.stringify(setup));
  alert("Roster setup saved in this browser.");
}
function loadRosterSetup(){
  const raw=localStorage.getItem("war-for-acme-roster-setup");
  if(!raw)return alert("No roster setup has been saved.");
  if(state.players.length&&!confirm("Replace the current roster with the saved setup?"))return;
  const setup=JSON.parse(raw);
  state.players=[];
  setup.forEach(item=>{
    const c=characterById(item.characterId);
    if(!c)return;
    state.players.push({
      id:crypto.randomUUID(),name:item.name,characterId:c.id,character:c.character,role:c.role,faction:c.faction,originalFaction:c.faction,convertedToWarner:false,conversionNote:"",
      purpose:c.purpose,passiveName:c.passive_name||"",passive:c.passive_description||"",
      signatureName:c.signature_name||"",signature:c.signature_description||"",
      winCondition:c.win_condition||"Win with faction.",alive:true,statuses:{},statusDurations:{},
      abilities:characterAbilities(c.character).map(a=>({name:a.ability_name,type:a.mechanic_type,description:a.description,max:parseUses(a.uses),used:0,resets:a.resets_each_day==="Yes"})),
      wildcardProgress:0,wildcardGoal:3
    });
  });
  addLog("Saved roster setup loaded.");
  save();
}

function renderLogAndArchive(){
  gameLog.innerHTML=state.log.length?state.log.map(entry=>`<div class="list-item"><strong>Day ${entry.day} • ${escapeHtml(entry.phase)}</strong><div class="role-line">${entry.time}</div><div>${escapeHtml(entry.text)}</div></div>`).join(""):'<div class="empty">No log entries.</div>';
  nightArchive.innerHTML=state.archive.length?state.archive.map(n=>`<div class="list-item"><strong>Day ${n.day}</strong><div class="role-line">${escapeHtml(n.time)} • ${n.actions.length} actions</div></div>`).join(""):'<div class="empty">No archived nights.</div>';
}

function render(){
  renderLiveMode();
  renderDashboard();
  renderPlayers();
  renderActionSelectors();
  renderQueue();
  renderWorldEvents();
  renderDatabase();
  renderStatistics();
  renderLogAndArchive();
  renderTimeline();
  renderWarnerRoom();
}

initialize();
