
const APP_VERSION = "1.6";
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

let database = {characters:[],abilities:[],mechanics:[]};
let state = loadState();

function defaultState(){
  return {
    version:APP_VERSION,day:1,phaseIndex:0,players:[],queue:[],log:[],archive:[],
    worldDomination:{progress:0,goal:3,active:false},worldEvents:[],resolutionHistory:[]
  };
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem("war-for-acme-v15"));
    return saved ? {...defaultState(),...saved} : defaultState();
  }catch{return defaultState();}
}
function save(){
  localStorage.setItem("war-for-acme-v15",JSON.stringify(state));
  render();
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function addLog(text){
  state.log.unshift({day:state.day,phase:PHASES[state.phaseIndex],time:new Date().toLocaleTimeString(),text});
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

  actionActor.addEventListener("change",renderAbilityOptions);
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
    id:crypto.randomUUID(),name,characterId:c.id,character:c.character,role:c.role,faction:c.faction,
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

  addLog(`Queued: ${actor.name} used ${ability.name} on ${targetNames.join(", ")||"no target"}.`);
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
      id:crypto.randomUUID(),name:item.name,characterId:c.id,character:c.character,role:c.role,faction:c.faction,
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
  renderDashboard();
  renderPlayers();
  renderActionSelectors();
  renderQueue();
  renderWorldEvents();
  renderDatabase();
  renderStatistics();
  renderLogAndArchive();
}

initialize();
