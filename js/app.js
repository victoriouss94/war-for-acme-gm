
const APP_VERSION = "2.9";
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
  {terms:["Roleblock","Role Block","Block","Silence","Fear"],priority:10,phase:"Blocks",killTier:"None"},
  {terms:["Redirect","Target Control","Swap","Mirror","Confus","Control"],priority:20,phase:"Role Control / Swaps",killTier:"None"},
  {terms:["Protection","Protect","Bodyguard","Guard","Intercept","Reflect","Immunity","Escape"],priority:30,phase:"Protects",killTier:"None"},
  {terms:["Watcher","Watch","Tracker","Track","Intel","Ask","Role Reveal","Faction Reveal","Graveyard","Visitor"],priority:40,phase:"Intel",killTier:"None"},
  {terms:["Omega Kill"],priority:50,phase:"Kills / Harmful",killTier:"Omega Kill"},
  {terms:["Super Kill"],priority:50,phase:"Kills / Harmful",killTier:"Super Kill"},
  {terms:["Instant Kill"],priority:50,phase:"Kills / Harmful",killTier:"Instant Kill"},
  {terms:["Poison","Bleed","Mark","Hunt","Wanted","Conversion","Faction Change","Kill","Harm"],priority:50,phase:"Kills / Harmful",killTier:"None"},
  {terms:["Save","Heal","Cleanse","Cure","Restore"],priority:60,phase:"Saves / Heals",killTier:"None"}
];

function defaultPriorityFor(type){
  const rule=PRIORITY_RULES.find(r=>r.terms.some(t=>String(type||"").toLowerCase().includes(t.toLowerCase())));
  return rule?.priority ?? 50;
}
function defaultKillTierFor(type){
  const rule=PRIORITY_RULES.find(r=>r.terms.some(t=>String(type||"").toLowerCase().includes(t.toLowerCase())));
  return rule?.killTier ?? "None";
}

function resolutionPhaseFor(type){
  const rule=PRIORITY_RULES.find(r=>r.terms.some(t=>String(type||"").toLowerCase().includes(t.toLowerCase())));
  return rule?.phase ?? "Intel";
}
function actionText(q){
  return `${q.abilityName||""} ${q.type||""} ${q.note||""}`.toLowerCase();
}
function isBlockAction(q){return q.priority===10||/role ?block|silence|fear/.test(actionText(q));}
function isControlAction(q){return q.priority===20||/redirect|swap|mirror|control|confus/.test(actionText(q));}
function isProtectionAction(q){return q.priority===30||/protect|guard|bodyguard|intercept|reflect|immun|escape/.test(actionText(q));}
function isIntelAction(q){return q.priority===40||/basic ask|advanced ask|watch|track|intel|reveal|graveyard|visitor/.test(actionText(q));}
function isRecoveryAction(q){return q.priority===60||/save|heal|cleanse|cure|restore/.test(actionText(q));}
function isHarmfulAction(q){
  return q.priority===50 || q.killTier!=="None" || /poison|bleed|mark|harm|kill|convert|attack/.test(actionText(q));
}
function bypassesNormalProtection(q){return q.killTier==="Super Kill"||q.killTier==="Omega Kill";}

function isWarnerDenInstantKill(action){
  return Boolean(
    action &&
    action.actionOwnerType==="FACTION" &&
    action.factionOwner==="Warner Syndicate" &&
    action.resourceKey==="warner_den_instant_kill"
  );
}
function isRegularDenKill(action){
  return isWarnerDenInstantKill(action);
}

function isDensStandardFactionKill(action){
  return isWarnerDenInstantKill(action);
}


const SUPABASE_URL = "https://bipjqwemwqivyassibqm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5fOm-lKPZBxmd6LAMDiGSw_SvVCCsk4";
const SHARED_ROOM_CODE = "ACME54";
const SHARED_GAME_NAME = "War for ACME";
const OFFICIAL_PLAYER_COUNT = 56;
const OFFICIAL_FACTION_COUNTS = {
  "ACME Defense Force":34,
  "Warner Syndicate":11,
  "Independent Wildcard":11
};

const FACTION_ALIASES = {
  den:"Warner Syndicate",
  villager:"ACME Defense Force",
  neutral:"Independent Wildcard",
  wildcards:"Independent Wildcard"
};


function normalizeRuleText(value){
  return String(value||"")
    .toLowerCase()
    .replace(/[’‘]/g,"'")
    .replace(/\s+/g," ")
    .trim();
}

function parsePassiveRulesFromText(passiveText,passiveName=""){
  const text=normalizeRuleText(`${passiveName} ${passiveText}`);
  const rules={
    sourceText:passiveText||"",
    immunities:[],
    triggers:[],
    restrictions:[],
    recognizedPhrases:[],
    unparsed:Boolean(text)
  };

  const addImmunity=(id,label,matcher)=>{
    if(!rules.immunities.some(x=>x.id===id)){
      rules.immunities.push({id,label,matcher});
    }
  };
  const recognize=phrase=>{
    if(!rules.recognizedPhrases.includes(phrase))rules.recognizedPhrases.push(phrase);
    rules.unparsed=false;
  };

  if(/cannot be converted|immune to conversion|conversion immune|unconvertable/.test(text)){
    addImmunity("conversion","Cannot be converted","conversion");
    recognize("conversion immunity");
  }

  if(
    /cannot be .*killed by the den'?s? standard faction kill/.test(text) ||
    /immune to .*den .*kill/.test(text) ||
    /cannot be killed by .*regular den kill/.test(text)
  ){
    addImmunity("warner_den_instant_kill","Cannot be killed by the Den's standard faction kill","warner_den_instant_kill");
    recognize("Den faction-kill immunity");
  }

  if(/cannot be role ?blocked|immune to role ?block/.test(text)){
    addImmunity("roleblock","Immune to roleblocks","roleblock");
    recognize("roleblock immunity");
  }
  if(/cannot be silenced|immune to silence/.test(text)){
    addImmunity("silence","Immune to silence","silence");
    recognize("silence immunity");
  }
  if(/cannot be feared|immune to fear/.test(text)){
    addImmunity("fear","Immune to fear","fear");
    recognize("fear immunity");
  }
  if(/survives? hanging|immune to hanging|cannot be hanged/.test(text)){
    addImmunity("hanging","Survives hanging","hanging");
    recognize("hanging immunity");
  }
  if(/immune to death for the first 2 days\/?nights|immune to death for the first two days\/?nights/.test(text)){
    rules.immunities.push({
      id:"early_death_immunity",
      label:"Immune to death for the first 2 days/nights",
      matcher:"death",
      untilDay:2
    });
    recognize("early death immunity");
  }
  if(/only .*omega.*instant.*kill|only .*instant.*omega.*kill/.test(text)){
    rules.restrictions.push({
      id:"kill_tier_targeting",
      label:"Only Instant and Omega Kills may target this role",
      allowedKillTiers:["Instant Kill","Omega Kill"]
    });
    recognize("kill-tier targeting restriction");
  }
  if(/first .*action.*death.*escape|evade.*1 time|escape.*1 time|first .*death.*survive/.test(text)){
    rules.triggers.push({
      id:"one_time_death_escape",
      event:"BEFORE_DEATH",
      label:"One-time escape from death",
      maxUses:1
    });
    recognize("one-time death escape");
  }

  const counterattackPattern =
    /targeted by (?:a )?(?:regular )?den kill|targeted by .*conversion|counterattacks? .*instant kill/;
  if(counterattackPattern.test(text)){
    rules.triggers.push({
      id:"den_or_conversion_counterattack",
      event:"TARGETED",
      label:"Counterattacks a random Den player with an Instant Kill",
      when:["warner_den_instant_kill","conversion"],
      effect:{
        type:"counterattack",
        killTier:"Instant Kill",
        target:"random_living_warner"
      }
    });
    recognize("Den/conversion counterattack");
  }

  return rules;
}

function passiveRuleMatchesAction(rule,action,currentDay){
  if(rule.id==="conversion")return /conversion|convert|recruit/.test(actionText(action));
  if(rule.id==="warner_den_instant_kill")return isWarnerDenInstantKill(action);
  if(rule.id==="roleblock")return isBlockAction(action)&&/role ?block/.test(actionText(action));
  if(rule.id==="silence")return /silence/.test(actionText(action));
  if(rule.id==="fear")return /fear/.test(actionText(action));
  if(rule.id==="early_death_immunity"){
    return currentDay<=Number(rule.untilDay||0) && (
      action.killTier!=="None" || /\bkill\b|death/.test(actionText(action))
    );
  }
  return false;
}

function parsedPassiveRulesForPlayer(player){
  if(player.passiveRules&&Array.isArray(player.passiveRules.immunities))return player.passiveRules;
  const parsed=parsePassiveRulesFromText(player.passive,player.passiveName);
  player.passiveRules=parsed;
  return parsed;
}

function passiveRulesSummaryHtml(player){
  const rules=parsedPassiveRulesForPlayer(player);
  const labels=[
    ...(rules.immunities||[]).map(r=>r.label),
    ...(rules.triggers||[]).map(r=>r.label),
    ...(rules.restrictions||[]).map(r=>r.label)
  ];
  if(!labels.length){
    return player.passive
      ? '<div class="passive-reader-warning">Passive text is stored, but no automatic rule has been recognized yet. GM review is required.</div>'
      : "";
  }
  return `<div class="passive-rules-list">${
    labels.map(label=>`<span class="passive-rule-chip">${escapeHtml(label)}</span>`).join("")
  }</div>`;
}

const ROLE_RULES = {
  sarge: {
    match(player){
      const directText=`${player.character||""} ${player.role||""}`.toLowerCase();
      if(directText.includes("sarge") || directText.includes("sheriff"))return true;

      const databaseEntry=(database.characters||[]).find(
        c=>String(c.character||"").toLowerCase()===String(player.character||"").toLowerCase()
      );
      const databaseText=[
        databaseEntry?.character,
        databaseEntry?.role,
        databaseEntry?.passive,
        databaseEntry?.description,
        databaseEntry?.rules_text,
        ...(databaseEntry?.abilities||[]).map(a=>`${a.name||""} ${a.description||""}`)
      ].join(" ").toLowerCase();

      return databaseText.includes("sarge") ||
             databaseText.includes("sheriff") ||
             databaseText.includes("cannot be converted or killed by the den") ||
             databaseText.includes("den's standard faction kill");
    },
    immunities:[
      {
        id:"warner_den_kill_immunity",
        label:"Cannot be killed by the Den's standard faction kill",
        matches(action){ return isWarnerDenInstantKill(action); }
      },
      {
        id:"conversion_immunity",
        label:"Cannot be converted",
        matches(action){ return /conversion|convert|recruit/.test(actionText(action)); }
      }
    ],
    triggers:[
      {
        id:"sheriff_counterattack",
        label:"Sheriff Counterattack",
        event:"TARGETED",
        matches(action){
          return isDensStandardFactionKill(action) || /conversion|convert|recruit/.test(actionText(action));
        },
        execute(context){
          const livingWarner=context.state.players.filter(
            p=>p.alive && p.faction==="Warner Syndicate" && p.id!==context.target.id
          );
          if(!livingWarner.length){
            return {log:"Sarge's counterattack triggered, but no living Warner Syndicate player was available."};
          }
          const chosen=livingWarner[Math.floor(Math.random()*livingWarner.length)];
          chosen.alive=false;
          context.killedThisNight.add(chosen.id);
          return {
            log:`Sarge counterattacked ${chosen.name} with an Instant Kill.`,
            counterTargetName:chosen.name
          };
        }
      }
    ]
  }
};

function ruleForPlayer(player){
  return Object.values(ROLE_RULES).find(rule=>rule.match(player))||null;
}
function evaluateTargetRules(action,target,context){
  const explicitRule=ruleForPlayer(target);
  const passiveRules=parsedPassiveRulesForPlayer(target);
  const result={immune:false,immunityLabel:"",triggered:[]};

  for(const immunity of passiveRules.immunities||[]){
    if(passiveRuleMatchesAction(immunity,action,context.state.day)){
      result.immune=true;
      result.immunityLabel=immunity.label;
    }
  }

  for(const restriction of passiveRules.restrictions||[]){
    if(
      restriction.id==="kill_tier_targeting" &&
      isHarmfulAction(action) &&
      !restriction.allowedKillTiers.includes(action.killTier)
    ){
      result.immune=true;
      result.immunityLabel=restriction.label;
    }
  }

  for(const trigger of passiveRules.triggers||[]){
    if(
      trigger.event==="TARGETED" &&
      trigger.id==="den_or_conversion_counterattack" &&
      (isWarnerDenInstantKill(action)||/conversion|convert|recruit/.test(actionText(action)))
    ){
      const livingWarner=context.state.players.filter(
        p=>p.alive&&p.faction==="Warner Syndicate"&&p.id!==target.id
      );
      if(livingWarner.length){
        const chosen=livingWarner[Math.floor(Math.random()*livingWarner.length)];
        chosen.alive=false;
        context.killedThisNight.add(chosen.id);
        result.triggered.push({
          label:trigger.label,
          log:`${target.character} counterattacked ${chosen.name} with an Instant Kill.`,
          counterTargetName:chosen.name
        });
      }else{
        result.triggered.push({
          label:trigger.label,
          log:`${target.character}'s counterattack triggered, but no living Den player was available.`
        });
      }
    }
  }

  // Explicit role rules remain available for mechanics that cannot be safely inferred from prose.
  if(explicitRule){
    for(const immunity of explicitRule.immunities||[]){
      if(immunity.matches(action,target,context)){
        result.immune=true;
        result.immunityLabel=result.immunityLabel||immunity.label;
      }
    }
    for(const trigger of explicitRule.triggers||[]){
      const alreadyTriggered=result.triggered.some(t=>t.label===trigger.label);
      if(!alreadyTriggered&&trigger.event==="TARGETED"&&trigger.matches(action,target,context)){
        result.triggered.push({label:trigger.label,...trigger.execute({...context,action,target})});
      }
    }
  }

  return result;
}

function ensureResolutionTrace(action){
  if(!Array.isArray(action.resolutionTrace))action.resolutionTrace=[];
  return action.resolutionTrace;
}
function addResolutionTrace(action,step,detail){
  ensureResolutionTrace(action).push({step,detail});
}
function resolutionExplanationHtml(action){
  const trace=action.resolutionTrace||[];
  if(!trace.length)return "";
  return `<div class="rule-explanation"><strong>Why:</strong><ul>${
    trace.map(item=>`<li><strong>${escapeHtml(item.step)}:</strong> ${escapeHtml(item.detail)}</li>`).join("")
  }</ul></div>`;
}


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
    abilities:p.abilities||[],
    passiveRules:p.passiveRules||parsePassiveRulesFromText(p.passive||"",p.passiveName||"")
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
  queueDenKillsBtn.addEventListener("click",queueWarnerDenKills);
  clearQueueBtn.addEventListener("click",()=>{if(confirm("Clear every queued action?")){state.queue=[];save();}});
  archiveNightBtn.addEventListener("click",archiveNight);

  generateReportsBtn.addEventListener("click",generateReports);
  addWorldEventBtn.addEventListener("click",addWorldEvent);

  databaseSearch.addEventListener("input",renderDatabase);
  databaseFactionFilter.addEventListener("change",renderDatabase);
  abilityIntelSearch.addEventListener("input",renderAbilityIntelligence);
  abilityIntelLife.addEventListener("change",renderAbilityIntelligence);
  abilityIntelFaction.addEventListener("change",renderAbilityIntelligence);
  const rosterSearchEl=document.getElementById("rosterStatSearch");
  const rosterFactionEl=document.getElementById("rosterStatFaction");
  if(rosterSearchEl)rosterSearchEl.addEventListener("input",renderRosterStatistics);
  if(rosterFactionEl)rosterFactionEl.addEventListener("change",renderRosterStatistics);

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
  closeRoleCardBtn.addEventListener("click",closeRoleCard);
  roleCardModal.querySelector("[data-close-role-card]").addEventListener("click",closeRoleCard);
  document.addEventListener("click",event=>{const trigger=event.target.closest("[data-open-role-card]");if(trigger)openRoleCard(trigger.dataset.openRoleCard);});
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeRoleCard();});
}

function activateView(viewId){
  document.querySelectorAll(".tab,.view").forEach(el=>el.classList.remove("active"));
  const tab=[...document.querySelectorAll(".tab")].find(t=>t.dataset.view===viewId);
  if(tab)tab.classList.add("active");
  document.getElementById(viewId)?.classList.add("active");
}

function openRoleCard(characterId){
  const c=characterById(characterId);
  if(!c?.card_image)return;
  roleCardModalTitle.textContent=`${c.character} — Official Role Card`;
  roleCardModalImage.src=c.card_image;
  roleCardModalImage.alt=`${c.character} official role card`;
  roleCardModal.classList.add("open");
  roleCardModal.setAttribute("aria-hidden","false");
}
function closeRoleCard(){
  roleCardModal.classList.remove("open");
  roleCardModal.setAttribute("aria-hidden","true");
  roleCardModalImage.removeAttribute("src");
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
    ${c.shared_role?.enabled?`<div class="shared-role-note"><strong>Shared Role:</strong> ${escapeHtml(c.shared_role.description)}</div>`:""}
    ${c.card_image?`<img class="role-card-thumb" src="${escapeHtml(c.card_image)}" alt="${escapeHtml(c.character)} official card" data-open-role-card="${escapeHtml(c.id)}"><button type="button" class="secondary role-card-button" data-open-role-card="${escapeHtml(c.id)}">Open Full Role Card</button>`:""}
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
    passiveRules:parsePassiveRulesFromText(c.passive_description||"",c.passive_name||""),
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
        ${p.passive?`<br><strong>Passive:</strong> ${escapeHtml(p.passiveName)} — ${escapeHtml(p.passive)}${passiveRulesSummaryHtml(p)}`:""}
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
  const previousActor=actionActor.value;
  const previousTargets=[...actionTargets.selectedOptions].map(o=>o.value);
  const previousProtection=protectionSource.value;
  const previousRedirect=redirectedTarget.value;
  const previousDen1=denKillTarget1.value;
  const previousDen2=denKillTarget2.value;

  const alive=state.players.filter(p=>p.alive);
  const options=alive.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.character)}</option>`).join("");
  actionActor.innerHTML=options;
  actionTargets.innerHTML=options;
  protectionSource.innerHTML='<option value="">None / unknown</option>'+options;
  redirectedTarget.innerHTML='<option value="">None</option>'+options;

  const legalDenTargets=alive.filter(p=>p.faction!=="Warner Syndicate");
  const denOptions='<option value="">Select a living Villager or Neutral</option>'+
    legalDenTargets.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.character)} — ${escapeHtml(p.faction)}</option>`).join("");
  denKillTarget1.innerHTML=denOptions;
  denKillTarget2.innerHTML=denOptions;

  if(alive.some(p=>p.id===previousActor))actionActor.value=previousActor;
  previousTargets.forEach(id=>{
    const option=[...actionTargets.options].find(o=>o.value===id);
    if(option)option.selected=true;
  });
  if(alive.some(p=>p.id===previousProtection))protectionSource.value=previousProtection;
  if(alive.some(p=>p.id===previousRedirect))redirectedTarget.value=previousRedirect;
  if(legalDenTargets.some(p=>p.id===previousDen1))denKillTarget1.value=previousDen1;
  if(legalDenTargets.some(p=>p.id===previousDen2))denKillTarget2.value=previousDen2;

  const denCount=state.queue.filter(q=>q.denAction&&q.day===state.day).length;
  const locked=denCount>=2;
  denKillTarget1.disabled=locked;
  denKillTarget2.disabled=locked;
  queueDenKillsBtn.disabled=locked||legalDenTargets.length<2;

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

function queueWarnerDenKills(){
  const target1=playerById(denKillTarget1.value);
  const target2=playerById(denKillTarget2.value);
  if(!target1||!target2)return alert("Choose both Warner Den Instant Kill targets.");
  if(!target1.alive||!target2.alive)return alert("Warner Den Instant Kills can only target living players.");
  if(target1.faction==="Warner Syndicate"||target2.faction==="Warner Syndicate"){
    return alert("The Den cannot target a Warner Syndicate player.");
  }
  if(target1.id===target2.id)return alert("The two Den kills must target two different players.");

  const existing=state.queue.filter(q=>q.denAction&&q.day===state.day);
  if(existing.length>=2)return alert("Both Warner Den Instant Kills are already queued for this night.");
  if(existing.length>0)return alert("A partial Den resource already exists in the queue. Remove it before queueing the standard pair.");

  [target1,target2].forEach((target,index)=>{
    state.queue.push({
      id:crypto.randomUUID(),
      actorId:"",
      actorName:"Warner Syndicate Faction",
      character:"Faction Resource",
      abilityIndex:-1,
      abilityName:`Warner Den Instant Kill ${index+1}`,
      type:"Warner Den Instant Kill",
      targetIds:[target.id],
      targetNames:[target.name],
      priority:50,
      phase:"Kills / Harmful",
      killTier:"Instant Kill",
      result:"Pending",
      reason:"None",
      affectedPlayer:"TARGET",
      sourceId:"",
      sourceName:"",
      redirectedTargetId:"",
      redirectedTargetName:"",
      statusApplied:"None",
      statusDuration:0,
      note:"Regular Den Kill: one of the Warner Syndicate faction-owned Warner Den Instant Kills. Not tied to any player ability.",
      resolved:false,
      denAction:true,
      actionOwnerType:"FACTION",
      factionOwner:"Warner Syndicate",
      resourceKey:"warner_den_instant_kill",
      consumesPlayerAbility:false,
      day:state.day
    });
  });
  addLog(`Queued both Warner Den Instant Kills for Night ${state.day}: ${target1.name} and ${target2.name}.`);
  save();
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
    phase:resolutionPhaseFor(ability.type),
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

const QUEUE_PHASES = [
  {key:"Blocks",label:"1. Blocks"},
  {key:"Role Control / Swaps",label:"2. Role Control / Swaps"},
  {key:"Protects",label:"3. Protects"},
  {key:"Intel",label:"4. Intel"},
  {key:"Kills / Harmful",label:"5. Kills / Harmful Actions"},
  {key:"Saves / Heals",label:"6. Saves / Heals"}
];
const collapsedQueuePhases=new Set();

function queueActionCard(q){
  return `
    <article class="queue-card ${q.resolved?"resolved":""}" data-action="${q.id}">
      <div class="card-head">
        <strong>${escapeHtml(q.actorName)} — ${escapeHtml(q.abilityName)}</strong>
        <span class="badge">${escapeHtml(q.phase||resolutionPhaseFor(q.type))} • Priority ${q.priority}</span>
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
      ${resolutionExplanationHtml(q)}

      <div class="actions">
        <button data-resolve class="${q.resolved?"secondary":"success"}">${q.resolved?"Resolved":"Resolve"}</button>
        <button data-delete class="danger">Remove</button>
      </div>
    </article>
  `;
}

function renderQueue(){
  const pending=state.queue.filter(q=>!q.resolved).length;
  queueSummary.textContent=`${state.queue.length} actions • ${pending} pending • ${state.queue.length-pending} resolved • 56-player game`;
  const denCount=state.queue.filter(q=>q.denAction&&q.day===state.day).length;
  if(document.getElementById("denKillStatus")){
    const legalCount=state.players.filter(p=>p.alive&&p.faction!=="Warner Syndicate").length;
    denKillStatus.innerHTML=`Night ${state.day}: <strong>${denCount}/2</strong> Warner Den Instant Kills queued • <strong>${Math.max(0,2-denCount)}</strong> remaining.<div class="den-target-warning">${legalCount} legal living targets currently available.</div>`;
  }

  const ordered=[...state.queue].sort((a,b)=>a.priority-b.priority);
  const knownKeys=new Set(QUEUE_PHASES.map(p=>p.key));
  const phaseGroups=QUEUE_PHASES.map(phase=>({
    ...phase,
    actions:ordered.filter(q=>(q.phase||resolutionPhaseFor(q.type))===phase.key)
  }));
  const unmatched=ordered.filter(q=>!knownKeys.has(q.phase||resolutionPhaseFor(q.type)));
  if(unmatched.length)phaseGroups.push({key:"Other",label:"Other / Manual Review",actions:unmatched});

  queueList.innerHTML=phaseGroups.map(group=>{
    const resolved=group.actions.filter(q=>q.resolved).length;
    const total=group.actions.length;
    const percent=total?Math.round((resolved/total)*100):0;
    const collapsed=collapsedQueuePhases.has(group.key);
    return `<section class="queue-phase ${total?"":"empty-phase"}">
      <button type="button" class="queue-phase-header" data-queue-phase="${escapeHtml(group.key)}">
        <span class="queue-phase-title">
          <strong>${escapeHtml(group.label)}</strong>
          <span class="badge">${total}</span>
          <span class="queue-phase-progress">${resolved}/${total} resolved</span>
        </span>
        <span class="queue-progress-track" aria-label="${resolved} of ${total} resolved">
          <span class="queue-progress-fill" style="width:${percent}%"></span>
        </span>
        <span>${collapsed?"▸":"▾"}</span>
      </button>
      ${collapsed?"":`<div class="queue-phase-body">${total?group.actions.map(queueActionCard).join(""):'<div class="empty">No actions in this phase.</div>'}</div>`}
    </section>`;
  }).join("");

  queueList.querySelectorAll("[data-queue-phase]").forEach(button=>button.addEventListener("click",()=>{
    const key=button.dataset.queuePhase;
    if(collapsedQueuePhases.has(key))collapsedQueuePhases.delete(key);
    else collapsedQueuePhases.add(key);
    renderQueue();
  }));

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
  if(!pending.length)return alert("There are no pending actions.");

  state.resolutionHistory.push(JSON.stringify({
    players:state.players,
    queue:state.queue,
    log:state.log
  }));

  const blockedActors=new Set();
  const protectedTargets=new Map();
  const redirectedTargets=new Map();
  const killedThisNight=new Set();

  for(const q of pending){
    const actor=playerById(q.actorId);
    const originalTargets=q.targetIds.map(playerById).filter(Boolean);
    let targets=originalTargets;

    if(q.redirectedTargetId){
      const redirected=playerById(q.redirectedTargetId);
      if(redirected){
        redirectedTargets.set(q.id,redirected.id);
        targets=[redirected];
        q.redirectedTargetName=redirected.name;
      }
    }

    if(actor&&blockedActors.has(actor.id)){
      q.result="Failed";
      q.reason="Blocked";
      addResolutionTrace(q,"Block","The actor was blocked before this action resolved.");
      q.resolved=true;
      addLog(`Auto-resolved: ${q.actorName}'s ${q.abilityName} failed because the actor was blocked.`);
      continue;
    }

    if(isBlockAction(q)){
      targets.forEach(target=>{
        blockedActors.add(target.id);
        target.statuses.Blocked=true;
        target.statusDurations=target.statusDurations||{};
        target.statusDurations.Blocked=1;
      });
      q.result="Successful";
      q.reason="None";
    } else if(isControlAction(q)){
      q.result="Successful";
      q.reason=q.redirectedTargetId?"Redirected":"None";
    } else if(isProtectionAction(q)){
      targets.forEach(target=>{
        if(!protectedTargets.has(target.id))protectedTargets.set(target.id,[]);
        protectedTargets.get(target.id).push(q);
        target.statuses.Protected=true;
        target.statusDurations=target.statusDurations||{};
        target.statusDurations.Protected=1;
      });
      q.result="Successful";
      q.reason="None";
    } else if(isIntelAction(q)){
      q.result="Successful";
      q.reason="None";
    } else if(isHarmfulAction(q)){
      let anyDied=false;
      let anyProtected=false;
      let anySucceeded=false;

      targets.forEach(target=>{
        const ruleResult=evaluateTargetRules(q,target,{
          state,
          killedThisNight,
          protectedTargets,
          blockedActors
        });

        ruleResult.triggered.forEach(trigger=>{
          if(trigger.log)addLog(trigger.log);
          addResolutionTrace(q,"Passive Trigger",`${trigger.label}${trigger.counterTargetName?`: ${trigger.counterTargetName} was hit by an Instant Kill.`:""}`);
        });

        if(ruleResult.immune){
          q.reason=isWarnerDenInstantKill(q)?"Immune to Den Faction Kill":"Immune to Conversion";
          anyProtected=true;
          addResolutionTrace(q,"Immunity",`${target.name} is immune: ${ruleResult.immunityLabel}. The action does not affect Sarge.`);
          return;
        }

        const normalProtection=protectedTargets.has(target.id);
        if(normalProtection&&!bypassesNormalProtection(q)){
          anyProtected=true;
          addResolutionTrace(q,"Protection",`${target.name} was protected from ${q.killTier||q.type}.`);
          return;
        }
        if(normalProtection&&bypassesNormalProtection(q)){
          addResolutionTrace(q,"Protection Bypassed",`${q.killTier} bypassed normal protection on ${target.name}.`);
        }

        anySucceeded=true;
        if(q.killTier!=="None"||/\bkill\b/.test(actionText(q))){
          target.alive=false;
          killedThisNight.add(target.id);
          anyDied=true;
        }else if(/poison/.test(actionText(q))){
          target.statuses.Poisoned=true;
          target.statusDurations=target.statusDurations||{};
          target.statusDurations.Poisoned=q.statusDuration||1;
        }else if(q.statusApplied&&q.statusApplied!=="None"){
          target.statuses[q.statusApplied]=true;
          target.statusDurations=target.statusDurations||{};
          target.statusDurations[q.statusApplied]=q.statusDuration||1;
        }
      });

      if(anyDied){
        q.result="Target Died";
        q.reason="None";
      }else if(anyProtected&&!anySucceeded){
        q.result="Failed";
        if(q.reason!=="Immune")q.reason="Protected";
        q.sourceName=targets.map(t=>(protectedTargets.get(t.id)||[])[0]?.actorName).filter(Boolean).join(", ");
      }else{
        q.result="Successful";
        q.reason=anyProtected?"Protected":"None";
      }
    } else if(isRecoveryAction(q)){
      let recovered=false;
      targets.forEach(target=>{
        if(/save/.test(actionText(q))&&killedThisNight.has(target.id)){
          target.alive=true;
          killedThisNight.delete(target.id);
          recovered=true;
        }
        if(/heal|cleanse|cure/.test(actionText(q))){
          ["Poisoned","Bleeding","Marked"].forEach(status=>{
            if(target.statuses[status]){
              target.statuses[status]=false;
              if(target.statusDurations)delete target.statusDurations[status];
              recovered=true;
            }
          });
        }
      });
      q.result=recovered?"Successful":"Failed";
      q.reason=recovered?"None":"No applicable effect";
    } else {
      q.result="Successful";
      q.reason="None";
    }

    if(!q.denAction && q.consumesPlayerAbility!==false){
      const ability=actor?.abilities?.[q.abilityIndex];
      if(ability&&ability.max>0&&ability.used<ability.max)ability.used++;
    }
    q.resolved=true;
    addLog(`Auto-resolved: ${q.actorName} used ${q.abilityName} on ${q.targetNames.join(", ")||"no target"} — ${q.result}${q.reason&&q.reason!=="None"?` (${q.reason})`:""}.`);
  }

  addLog(`Night ${state.day} auto-resolution completed in the order: Blocks → Role Control/Swaps → Protects → Intel → Kills/Harmful → Saves/Heals.`);
  save();
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
    return `<article class="database-card ${c.card_image?"has-card":""}">
      <div class="card-head"><div><strong>${escapeHtml(c.character)}</strong><div class="role-line">${escapeHtml(c.faction)} • ${escapeHtml(c.role)}</div></div><span class="badge ${c.official_card?"official-card-badge":""}">${c.official_card?"Official Card":escapeHtml(c.review||"")}</span></div>
      ${c.shared_role?.enabled?`<div class="shared-role-note"><strong>Shared Role:</strong> ${escapeHtml(c.shared_role.description)}</div>`:""}
      ${c.card_image?`<img class="role-card-thumb" loading="lazy" src="${escapeHtml(c.card_image)}" alt="${escapeHtml(c.character)} official card" data-open-role-card="${escapeHtml(c.id)}"><button type="button" class="secondary role-card-button" data-open-role-card="${escapeHtml(c.id)}">Open Full Role Card</button>`:""}
      <p>${escapeHtml(c.purpose)}</p>
      ${c.passive_name||c.passive_description?`<div class="info-box"><strong>Passive:</strong> ${escapeHtml(c.passive_name)} — ${escapeHtml(c.passive_description)}</div>`:""}
      ${c.signature_name?`<div class="info-box"><strong>Signature:</strong> ${escapeHtml(c.signature_name)} — ${escapeHtml(c.signature_description)}</div>`:""}
      ${abilities.map(a=>`<div class="ability-row"><strong>${escapeHtml(a.ability_name)}</strong> <span class="badge">${escapeHtml(a.mechanic_type)}</span><small>${escapeHtml(a.description)} • ${escapeHtml(a.uses)}</small></div>`).join("")}
    </article>`;
  }).join(""):'<div class="empty">No matching characters.</div>';
}


const ABILITY_CATEGORY_DEFINITIONS = [
  {
    name:"Investigation",
    subtypes:[
      ["Advanced Ask",["advanced ask"]],
      ["Basic Ask",["basic ask"]],
      ["Watch",["watch","watcher"]],
      ["Track",["track","tracker"]],
      ["Visitor Intel",["visitor","visited"]],
      ["Role Reveal",["role reveal","exact role"]],
      ["Faction Reveal",["faction reveal","exact faction","alignment ask"]],
      ["Graveyard Intel",["graveyard","dead player","gravedigger"]],
      ["Other Investigation",["intel","investigat","ask","seer"]]
    ]
  },
  {
    name:"Harmful",
    subtypes:[
      ["Omega Kill",["omega kill"]],
      ["Super Kill",["super kill"]],
      ["Instant Kill",["instant kill"]],
      ["Poison",["poison"]],
      ["Roleblock",["roleblock","role block","blocked"]],
      ["Silence",["silence","silenced"]],
      ["Fear",["fear"]],
      ["Ability Removal",["remove ability","lose abilities","ability removal"]],
      ["Redirect Harm",["redirect","retarget"]],
      ["Other Harmful",["kill","harm","attack","mark","hunt","steal"]]
    ]
  },
  {
    name:"Protection",
    subtypes:[
      ["Protect",["protect","protection"]],
      ["Guard",["guard","guardian","bodyguard"]],
      ["Intercept",["intercept"]],
      ["Reflect",["reflect"]],
      ["Counterattack",["counterattack","counter attack"]],
      ["Escape",["escape","evade"]],
      ["Death Immunity",["death immunity","immune to death","cannot be killed"]],
      ["Hanging Survival",["survive hanging","hanging immunity"]],
      ["Other Protection",["shield","sentinel","save from death"]]
    ]
  },
  {
    name:"Support",
    subtypes:[
      ["Heal",["heal"]],
      ["Save",["save"]],
      ["Amplify / Upgrade",["amplif","enhance","upgrade","maximum version"]],
      ["Guarantee Success",["guarantee","ensures","cannot fail","success"]],
      ["Double Ability",["double ability","doubles","use twice"]],
      ["Restore Uses",["restore use","regain use","extra use"]],
      ["Cleanse",["cleanse","remove harmful","cure"]],
      ["Other Support",["support","motivat","courier","buff"]]
    ]
  },
  {
    name:"Chaos",
    subtypes:[
      ["Wheel",["wheel"]],
      ["Coin Flip",["coin flip"]],
      ["Prototype",["prototype","blueprint"]],
      ["Random Target",["random target","random player","random legal target"]],
      ["Random Ability",["random ability","random effect","random role"]],
      ["Backfire",["backfire","failure chance","chance of failure"]],
      ["Swap / Confuse",["swap","confus","scramble"]],
      ["Other Chaos",["chaos","gadget"]]
    ]
  },
  {
    name:"Conversion",
    subtypes:[
      ["Conversion",["conversion","convert"]],
      ["Recruitment",["recruit"]],
      ["Faction Change",["faction change","switch faction","traitor"]],
      ["Enslaved to Death",["enslave","enslaved to death"]],
      ["Bind",["bind","bound"]],
      ["Other Conversion",["join the warner","becomes warner"]]
    ]
  },
  {
    name:"Communication",
    subtypes:[
      ["Silence",["silence","silenced"]],
      ["Text Only",["text only","only use text"]],
      ["Emoji / GIF / Image Only",["emoji","gif","picture only","images only"]],
      ["Private Channel",["private chat","private channel","channel"]],
      ["Other Communication",["communication","reply restriction"]]
    ]
  },
  {
    name:"Other",
    subtypes:[["Other Ability",[]]]
  }
];

function abilityText(ability){
  return [ability.name,ability.type,ability.description].filter(Boolean).join(" ").toLowerCase();
}

function classifyAbility(ability){
  const text=abilityText(ability);
  for(const category of ABILITY_CATEGORY_DEFINITIONS){
    if(category.name==="Other")continue;
    for(const [subtype,terms] of category.subtypes){
      if(terms.some(term=>text.includes(term)))return {category:category.name,subtype};
    }
  }
  return {category:"Other",subtype:"Other Ability"};
}

function abilityLimitInfo(ability){
  const max=Number(ability.max||0);
  const used=Number(ability.used||0);
  if(max<=0)return {limited:false,remaining:null};
  return {limited:true,remaining:Math.max(0,max-used)};
}


function rosterCharacterFaction(characterName){
  const character=database.characters.find(
    c=>String(c.character||"").toLowerCase()===String(characterName||"").toLowerCase()
  );
  return character?.faction||"Unknown";
}

function officialPlayerSlotsForCharacter(character){
  const name=String(character.character||"").toLowerCase();
  if(name.includes("audience"))return 3;
  if(name.includes("goofy gophers"))return 2;
  return 1;
}

function buildRosterStatistics(){
  const rows=[];
  (database.abilities||[]).forEach(ability=>{
    const character=(database.characters||[]).find(
      c=>String(c.character||"").toLowerCase()===String(ability.character||"").toLowerCase()
    );
    const cls=classifyAbility({
      name:ability.ability_name,
      type:ability.mechanic_type,
      description:ability.description
    });
    rows.push({
      category:cls.category,
      subtype:cls.subtype,
      character:ability.character,
      role:character?.role||"",
      faction:character?.faction||"Unknown",
      abilityName:ability.ability_name||ability.mechanic_type||"Ability",
      description:ability.description||"",
      uses:ability.uses||"Not specified"
    });
  });

  // Character-level tags can capture mechanics not represented as a separate ability record.
  (database.characters||[]).forEach(character=>{
    (character.tags||[]).forEach(tag=>{
      const cls=classifyAbility({name:tag,type:tag,description:tag});
      const exists=rows.some(row=>
        row.character===character.character &&
        row.subtype===cls.subtype &&
        row.abilityName.toLowerCase()===String(tag).toLowerCase()
      );
      if(!exists && cls.category!=="Other"){
        rows.push({
          category:cls.category,
          subtype:cls.subtype,
          character:character.character,
          role:character.role||"",
          faction:character.faction||"Unknown",
          abilityName:tag,
          description:"Character tag from the official role database.",
          uses:"See role card"
        });
      }
    });
  });
  return rows;
}

function renderRosterStatistics(){
  const summary=document.getElementById("rosterSetupSummary");
  const categoriesEl=document.getElementById("rosterCategorySummary");
  const results=document.getElementById("rosterStatisticsResults");
  if(!summary||!categoriesEl||!results)return;

  const allCharacters=(database.characters||[]).filter(c=>c.official_card!==false);
  const officialSlots=allCharacters.reduce((sum,c)=>sum+officialPlayerSlotsForCharacter(c),0);
  const factionSlots=faction=>allCharacters
    .filter(c=>c.faction===faction)
    .reduce((sum,c)=>sum+officialPlayerSlotsForCharacter(c),0);

  const rows=buildRosterStatistics();
  if(!(database.characters||[]).length){
    summary.innerHTML='<div class="warning high">The role database has not loaded yet. Refresh the page.</div>';
    categoriesEl.innerHTML="";
    results.innerHTML="";
    return;
  }
  const searchEl=document.getElementById("rosterStatSearch");
  const factionEl=document.getElementById("rosterStatFaction");
  const search=(searchEl?.value||"").trim().toLowerCase();
  const factionFilter=factionEl?.value||"ALL";

  const filtered=rows.filter(row=>{
    if(factionFilter!=="ALL"&&row.faction!==factionFilter)return false;
    if(!search)return true;
    return [
      row.category,row.subtype,row.character,row.role,row.faction,
      row.abilityName,row.description,row.uses
    ].join(" ").toLowerCase().includes(search);
  });

  summary.innerHTML=`
    <div class="metric"><strong>${officialSlots}</strong><span>Player slots represented</span></div>
    <div class="metric"><strong>${allCharacters.length}</strong><span>Official role cards</span></div>
    <div class="metric"><strong>${factionSlots("ACME Defense Force")}</strong><span>Villager slots</span></div>
    <div class="metric"><strong>${factionSlots("Warner Syndicate")}</strong><span>Den slots</span></div>
    <div class="metric"><strong>${factionSlots("Independent Wildcard")}</strong><span>Neutral slots</span></div>
  `;

  const categoryOrder=["Investigation","Harmful","Protection","Support","Chaos","Conversion","Communication","Other"];
  categoriesEl.innerHTML=categoryOrder.map(category=>{
    const categoryRows=filtered.filter(row=>row.category===category);
    const uniqueRoles=new Set(categoryRows.map(row=>row.character)).size;
    return `<div class="metric">
      <strong>${uniqueRoles}</strong>
      <span>${escapeHtml(category)} roles</span>
      <small>${categoryRows.length} ability entries</small>
    </div>`;
  }).join("");

  const blocks=categoryOrder.map(category=>{
    const categoryRows=filtered.filter(row=>row.category===category);
    if(!categoryRows.length)return "";
    const subtypes=[...new Set(categoryRows.map(row=>row.subtype))].sort();
    const uniqueRoles=new Set(categoryRows.map(row=>row.character)).size;

    const subtypeRows=subtypes.map(subtype=>{
      const entries=categoryRows.filter(row=>row.subtype===subtype);
      const roleNames=[...new Set(entries.map(row=>row.character))].sort();
      const countByFaction=faction=>new Set(
        entries.filter(row=>row.faction===faction).map(row=>row.character)
      ).size;
      const abilities=[...new Set(entries.map(row=>row.abilityName))].sort();

      return `<tr>
        <td><strong>${escapeHtml(subtype)}</strong><div class="muted">${abilities.map(escapeHtml).join(", ")}</div></td>
        <td><strong>${roleNames.length}</strong></td>
        <td>${countByFaction("ACME Defense Force")}</td>
        <td>${countByFaction("Warner Syndicate")}</td>
        <td>${countByFaction("Independent Wildcard")}</td>
        <td><div class="roster-role-list">${
          roleNames.map(name=>`<span class="roster-role-chip">${escapeHtml(name)}</span>`).join("")
        }</div></td>
      </tr>`;
    }).join("");

    return `<section class="roster-category-block">
      <div class="roster-category-head">
        <strong>${escapeHtml(category)}</strong>
        <span>${uniqueRoles} roles • ${categoryRows.length} ability entries</span>
      </div>
      <div class="ability-intel-table-wrap">
        <table class="roster-subtype-table">
          <thead><tr>
            <th>Ability subtype</th>
            <th>Total roles</th>
            <th>Villagers</th>
            <th>Den</th>
            <th>Neutrals</th>
            <th>Characters</th>
          </tr></thead>
          <tbody>${subtypeRows}</tbody>
        </table>
      </div>
    </section>`;
  }).filter(Boolean);

  results.innerHTML=blocks.join("")||'<div class="empty">No matching roster abilities.</div>';
}

function buildAbilityHierarchy(){
  const categories=new Map();
  ABILITY_CATEGORY_DEFINITIONS.forEach(def=>categories.set(def.name,new Map()));

  state.players.forEach(player=>{
    (player.abilities||[]).forEach((ability,index)=>{
      const cls=classifyAbility(ability);
      const subtypeMap=categories.get(cls.category);
      if(!subtypeMap.has(cls.subtype)){
        subtypeMap.set(cls.subtype,{
          name:cls.subtype,
          category:cls.category,
          members:[]
        });
      }
      const limit=abilityLimitInfo(ability);
      subtypeMap.get(cls.subtype).members.push({
        playerId:player.id,
        playerName:player.name,
        character:player.character,
        role:player.role,
        faction:player.faction,
        alive:player.alive,
        abilityIndex:index,
        ability,
        limited:limit.limited,
        remaining:limit.remaining
      });
    });
  });

  return ABILITY_CATEGORY_DEFINITIONS.map(def=>({
    name:def.name,
    subtypes:[...(categories.get(def.name)?.values()||[])].sort((a,b)=>a.name.localeCompare(b.name))
  })).filter(category=>category.subtypes.length);
}

function factionShortName(faction){
  if(faction==="ACME Defense Force")return "ACME";
  if(faction==="Warner Syndicate")return "Warner";
  if(faction==="Independent Wildcard")return "Neutral";
  return faction||"Unknown";
}

function filteredMembers(members){
  const search=(abilityIntelSearch.value||"").trim().toLowerCase();
  const life=abilityIntelLife.value;
  const faction=abilityIntelFaction.value;
  return members.filter(member=>{
    if(faction!=="ALL"&&member.faction!==faction)return false;
    if(life==="ALIVE"&&!member.alive)return false;
    if(life==="DEAD"&&member.alive)return false;
    if(!search)return true;
    return [
      member.playerName,member.character,member.role,member.faction,
      member.ability.name,member.ability.type,member.ability.description
    ].join(" ").toLowerCase().includes(search);
  });
}

function memberStats(members){
  const alive=members.filter(m=>m.alive).length;
  const dead=members.length-alive;
  const limited=members.filter(m=>m.limited);
  const usesLeft=limited.reduce((sum,m)=>sum+(m.remaining||0),0);
  const hasUnlimited=members.some(m=>!m.limited);
  return {
    total:members.length,
    alive,
    dead,
    usesLeft,
    usesLabel:hasUnlimited?(limited.length?`${usesLeft} + ∞`:"∞"):String(usesLeft)
  };
}

let expandedAbilityCategory="";
let expandedAbilitySubtype="";

function renderAbilityIntelligence(){
  if(!document.getElementById("abilityHierarchy"))return;
  const hierarchy=buildAbilityHierarchy();
  const search=(abilityIntelSearch.value||"").trim().toLowerCase();

  const visibleCategories=hierarchy.map(category=>{
    const subtypes=category.subtypes.map(subtype=>{
      const members=filteredMembers(subtype.members);
      const subtypeNameMatches=!search||`${subtype.name} ${category.name}`.toLowerCase().includes(search);
      if(search&&!members.length&&!subtypeNameMatches)return null;
      if((abilityIntelLife.value!=="ALL"||abilityIntelFaction.value!=="ALL")&&!members.length)return null;
      return {...subtype,members:members.length?members:subtype.members};
    }).filter(Boolean);
    if(!subtypes.length)return null;
    return {...category,subtypes};
  }).filter(Boolean);

  abilityPowerSummary.innerHTML=visibleCategories.map(category=>{
    const members=category.subtypes.flatMap(s=>s.members);
    const stats=memberStats(members);
    return `<button type="button" class="metric ability-power-card" data-open-category="${escapeHtml(category.name)}">
      <strong>${stats.alive}</strong>
      <span>${escapeHtml(category.name)} alive</span>
      <small>${stats.total} in game • ${stats.usesLabel} uses left</small>
    </button>`;
  }).join("");

  abilityHierarchy.innerHTML=visibleCategories.map(category=>{
    const categoryMembers=category.subtypes.flatMap(s=>s.members);
    const catStats=memberStats(categoryMembers);
    const categoryOpen=expandedAbilityCategory===category.name;
    const subtypeHtml=categoryOpen?`<div class="ability-subtypes">${
      category.subtypes.map(subtype=>{
        const stats=memberStats(subtype.members);
        const subtypeKey=`${category.name}::${subtype.name}`;
        const subtypeOpen=expandedAbilitySubtype===subtypeKey;
        const factionGroups=["ACME Defense Force","Warner Syndicate","Independent Wildcard"].map(faction=>{
          const members=subtype.members.filter(m=>m.faction===faction);
          if(!members.length)return "";
          const fs=memberStats(members);
          return `<section class="faction-section">
            <h4>${escapeHtml(factionShortName(faction))}</h4>
            <div class="role-line">${fs.alive} alive • ${fs.dead} dead • ${fs.usesLabel} uses left</div>
            <div class="ability-player-list top-gap">${members.map(m=>`
              <div class="ability-player-row">
                <strong>${escapeHtml(m.playerName)} — ${escapeHtml(m.character)}</strong>
                <div class="role-line">${escapeHtml(m.role||"")} • ${m.alive?"Alive":"Dead"} • ${m.limited?`${m.remaining} uses left`:"Unlimited"}</div>
                <small>${escapeHtml(m.ability.description||m.ability.name||"")}</small>
              </div>`).join("")}
            </div>
          </section>`;
        }).join("");
        return `<div class="ability-subtype">
          <button type="button" class="ability-subtype-header" data-subtype="${escapeHtml(subtypeKey)}">
            <span class="ability-subtype-title"><strong>${escapeHtml(subtype.name)}</strong><small>${escapeHtml(category.name)}</small></span>
            <span class="ability-stat"><strong>${stats.total}</strong><small>In game</small></span>
            <span class="ability-stat"><strong>${stats.alive}</strong><small>Alive</small></span>
            <span class="ability-stat optional-stat"><strong>${stats.dead}</strong><small>Dead</small></span>
            <span class="ability-stat optional-stat"><strong>${stats.usesLabel}</strong><small>Uses left</small></span>
            <span class="chevron">${subtypeOpen?"▾":"▸"}</span>
          </button>
          ${subtypeOpen?`<div class="ability-subtype-details"><div class="faction-sections">${factionGroups||'<div class="empty">No matching players.</div>'}</div></div>`:""}
        </div>`;
      }).join("")
    }</div>`:"";
    return `<section class="ability-category">
      <button type="button" class="ability-category-header" data-category="${escapeHtml(category.name)}">
        <span class="ability-category-title"><strong>${escapeHtml(category.name)}</strong><small>${category.subtypes.length} subtypes</small></span>
        <span class="ability-stat"><strong>${catStats.total}</strong><small>In game</small></span>
        <span class="ability-stat"><strong>${catStats.alive}</strong><small>Alive</small></span>
        <span class="ability-stat optional-stat"><strong>${catStats.dead}</strong><small>Dead</small></span>
        <span class="ability-stat optional-stat"><strong>${catStats.usesLabel}</strong><small>Uses left</small></span>
        <span class="chevron">${categoryOpen?"▾":"▸"}</span>
      </button>
      ${subtypeHtml}
    </section>`;
  }).join("")||'<div class="empty">No matching abilities or players.</div>';

  abilityPowerSummary.querySelectorAll("[data-open-category]").forEach(button=>button.addEventListener("click",()=>{
    expandedAbilityCategory=button.dataset.openCategory;
    expandedAbilitySubtype="";
    renderAbilityIntelligence();
  }));
  abilityHierarchy.querySelectorAll("[data-category]").forEach(button=>button.addEventListener("click",()=>{
    expandedAbilityCategory=expandedAbilityCategory===button.dataset.category?"":button.dataset.category;
    expandedAbilitySubtype="";
    renderAbilityIntelligence();
  }));
  abilityHierarchy.querySelectorAll("[data-subtype]").forEach(button=>button.addEventListener("click",event=>{
    event.stopPropagation();
    expandedAbilitySubtype=expandedAbilitySubtype===button.dataset.subtype?"":button.dataset.subtype;
    renderAbilityIntelligence();
  }));
}


function countMechanic(players,terms,aliveOnly){
  return players.filter(p=>!aliveOnly||p.alive).reduce((sum,p)=>sum+p.abilities.filter(a=>mechanicMatches(a.type,terms)).length,0);
}
function renderStatistics(){
  renderRosterStatistics();
  renderAbilityIntelligence();

  const factions=["ACME Defense Force","Warner Syndicate","Independent Wildcard"];
  mechanicsByFaction.innerHTML=factions.map(f=>{
    const players=state.players.filter(p=>p.alive&&p.faction===f);
    const abilities=players.flatMap(p=>p.abilities||[]);
    const categoryCount=name=>abilities.filter(a=>classifyAbility(a).category===name).length;
    const subtypeCount=name=>abilities.filter(a=>classifyAbility(a).subtype===name).length;
    return `<div class="list-item">
      <strong>${escapeHtml(f)}</strong>
      <div class="role-line">${players.length} alive players</div>
      <div class="faction-counts top-gap">
        <span class="faction-chip">Investigation <strong>${categoryCount("Investigation")}</strong></span>
        <span class="faction-chip">Harmful <strong>${categoryCount("Harmful")}</strong></span>
        <span class="faction-chip">Protection <strong>${categoryCount("Protection")}</strong></span>
        <span class="faction-chip">Support <strong>${categoryCount("Support")}</strong></span>
        <span class="faction-chip">Chaos <strong>${categoryCount("Chaos")}</strong></span>
        <span class="faction-chip">Basic Ask <strong>${subtypeCount("Basic Ask")}</strong></span>
        <span class="faction-chip">Advanced Ask <strong>${subtypeCount("Advanced Ask")}</strong></span>
        <span class="faction-chip">Instant <strong>${subtypeCount("Instant Kill")}</strong></span>
        <span class="faction-chip">Super <strong>${subtypeCount("Super Kill")}</strong></span>
        <span class="faction-chip">Omega <strong>${subtypeCount("Omega Kill")}</strong></span>
      </div>
    </div>`;
  }).join("");

  const living=state.players.filter(p=>p.alive);
  const warnings=[];
  const livingAbilities=living.flatMap(p=>p.abilities||[]);
  const protection=livingAbilities.filter(a=>classifyAbility(a).category==="Protection").length;
  const intel=livingAbilities.filter(a=>classifyAbility(a).category==="Investigation").length;
  const highKills=livingAbilities.filter(a=>["Instant Kill","Super Kill","Omega Kill"].includes(classifyAbility(a).subtype)).length;
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


function renderWarnerFactionResources(){
  const el=document.getElementById("warnerFactionResources");
  if(!el)return;
  const used=state.queue.filter(q=>q.denAction&&q.day===state.day).length;
  const remaining=Math.max(0,2-used);
  el.innerHTML=`
    <div class="metrics">
      <div class="metric"><strong>2</strong><span>Warner Den Instant Kills per night</span></div>
      <div class="metric"><strong>${used}</strong><span>Queued this night</span></div>
      <div class="metric"><strong>${remaining}</strong><span>Remaining this night</span></div>
    </div>
    <div class="auto-resolution-note">
      These kills belong to the Warner Syndicate faction. They are not attached to Brain, Pinky, Yakko, Wakko, Dot, or any other player.
    </div>`;
}

function render(){
  renderLiveMode();
  renderDashboard();
  renderPlayers();
  renderActionSelectors();
  renderQueue();
  renderWarnerFactionResources();
  renderWorldEvents();
  renderDatabase();
  renderStatistics();
  renderLogAndArchive();
  renderTimeline();
  renderWarnerRoom();
}

initialize();
