const STORAGE_KEY='gm_command_center_generic_v3';
const priorityMap={'Block':10,'Control / Swap':20,'Protection':30,'Investigation':40,'Kill / Harmful':50,'Save / Heal':60,'Other':70};
const id=()=>crypto.randomUUID();
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
].map(([name,category,definition,phase,mechanics])=>({id:id(),name,category,definition,phase,mechanics:mechanics.split(',').map(x=>x.trim()),builtIn:true}));

const defaultState=()=>({
  settings:{gameName:'Untitled Social Deduction Game',labels:{VILLAGER:'Villagers',DEN:'Den',NEUTRAL:'Neutrals'},allowMultiDen:true},
  factions:[
    {id:id(),name:'Villagers',class:'VILLAGER',alias:'village',teamNumber:1},
    {id:id(),name:'Den',class:'DEN',alias:'den',teamNumber:1},
    {id:id(),name:'Neutrals',class:'NEUTRAL',alias:'neutral',teamNumber:1}
  ],roles:[],players:[],actions:[],abilities:standardAbilities()
});
let state=load();
let editingAbilityId=null;
function migrate(data){
  const base=defaultState();
  data.settings={...base.settings,...(data.settings||{}),labels:{...base.settings.labels,...(data.settings?.labels||{})}};
  data.factions=Array.isArray(data.factions)?data.factions:base.factions;
  data.roles=Array.isArray(data.roles)?data.roles:[];
  data.players=Array.isArray(data.players)?data.players:[];
  data.actions=Array.isArray(data.actions)?data.actions:[];
  if(!Array.isArray(data.abilities)||!data.abilities.length)data.abilities=standardAbilities();
  data.abilities=data.abilities.map(a=>({...a, mechanics:Array.isArray(a.mechanics)?a.mechanics:[], revisions:Array.isArray(a.revisions)?a.revisions:[]}));
  return data;
}
function load(){try{return migrate(JSON.parse(localStorage.getItem(STORAGE_KEY))||defaultState())}catch{return defaultState()}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));renderAll()}
const $=id=>document.getElementById(id);
function option(value,label=value){const o=document.createElement('option');o.value=value;o.textContent=label;return o}
function factionById(id){return state.factions.find(f=>f.id===id)}
function roleById(id){return state.roles.find(r=>r.id===id)}
function playerById(id){return state.players.find(p=>p.id===id)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function normalized(s=''){return s.trim().toLowerCase()}
function removeById(list,itemId){state[list]=state[list].filter(x=>x.id!==itemId);save()}
function rolesUsingAbility(ability){return state.roles.filter(r=>r.tags.some(t=>normalized(t)===normalized(ability.name)))}
function renderSelects(){
  const factionSelects=[$('roleFaction'),$('roleFactionFilter'),$('statsFactionFilter')];
  factionSelects.forEach((sel,i)=>{const current=sel.value;sel.innerHTML='';if(i>0)sel.append(option('ALL','All factions'));state.factions.forEach(f=>sel.append(option(f.id,`${f.name} (${f.class})`)));if([...sel.options].some(o=>o.value===current))sel.value=current});
  const roleSelects=[$('playerRole')];roleSelects.forEach(sel=>{const current=sel.value;sel.innerHTML='';state.roles.forEach(r=>{const f=factionById(r.factionId);sel.append(option(r.id,`${r.name} — ${f?.name||'No faction'}`))});if([...sel.options].some(o=>o.value===current))sel.value=current});
  const actor=$('actionActor'),target=$('actionTarget');const ca=actor.value,ct=target.value;actor.innerHTML='';target.innerHTML='';state.players.filter(p=>p.alive).forEach(p=>{const role=roleById(p.roleId);actor.append(option(p.id,`${p.name} (${role?.name||'No role'})`));target.append(option(p.id,`${p.name} (${role?.name||'No role'})`))});if([...actor.options].some(o=>o.value===ca))actor.value=ca;if([...target.options].some(o=>o.value===ct))target.value=ct;
}
function renderDashboard(){
  const alive=state.players.filter(p=>p.alive).length;
  $('metrics').innerHTML=[['Factions',state.factions.length],['Roles',state.roles.length],['Players',state.players.length],['Known Abilities',state.abilities.length]].map(([l,v])=>`<div class="metric"><strong>${v}</strong><span>${l}</span></div>`).join('');
  $('factionOverview').innerHTML=state.factions.map(f=>{const roles=state.roles.filter(r=>r.factionId===f.id);const players=state.players.filter(p=>roles.some(r=>r.id===p.roleId));const aliveCount=players.filter(p=>p.alive).length;return `<div class="item-card"><h3>${esc(f.name)}</h3><span class="badge ${f.class}">${f.class}</span><p>${roles.length} roles • ${players.length} players • ${aliveCount} alive</p></div>`}).join('')||'<p class="muted">No factions.</p>';
}
function renderFactions(){
  $('factionList').innerHTML=state.factions.map(f=>`<div class="item-card"><h3>${esc(f.name)}</h3><span class="badge ${f.class}">${f.class}</span><p>Alias: ${esc(f.alias||'—')} • Team ${f.teamNumber||1}</p><button class="danger delete-faction" data-id="${f.id}">Delete</button></div>`).join('');
  document.querySelectorAll('.delete-faction').forEach(b=>b.onclick=()=>{if(state.roles.some(r=>r.factionId===b.dataset.id))return alert('Move or delete this faction’s roles first.');removeById('factions',b.dataset.id)});
}
function renderRoles(){
  const q=$('roleSearch').value.toLowerCase(),ff=$('roleFactionFilter').value;
  const roles=state.roles.filter(r=>(ff==='ALL'||r.factionId===ff)&&(`${r.name} ${r.tags.join(' ')}`.toLowerCase().includes(q)));
  $('roleList').innerHTML=roles.map(r=>{const f=factionById(r.factionId);return `<div class="item-card"><h3>${esc(r.name)}</h3><span class="badge ${f?.class||''}">${esc(f?.name||'No faction')}</span><p>${r.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join(' ')||'<span class="muted">No abilities</span>'}</p><p class="muted">${esc(r.notes||'')}</p><button class="danger delete-role" data-id="${r.id}">Delete</button></div>`}).join('')||'<p class="muted">No matching roles.</p>';
  document.querySelectorAll('.delete-role').forEach(b=>b.onclick=()=>{if(state.players.some(p=>p.roleId===b.dataset.id))return alert('Remove players assigned to this role first.');removeById('roles',b.dataset.id)});
}
function renderPlayers(){
  const q=$('playerSearch').value.toLowerCase(),life=$('playerLifeFilter').value;
  const players=state.players.filter(p=>(life==='ALL'||(life==='ALIVE'&&p.alive)||(life==='DEAD'&&!p.alive))&&(`${p.name} ${roleById(p.roleId)?.name||''}`.toLowerCase().includes(q)));
  $('playerList').innerHTML=players.map(p=>{const r=roleById(p.roleId),f=factionById(r?.factionId);return `<div class="item-card"><h3>${esc(p.name)}</h3><p>${esc(r?.name||'No role')}</p><span class="badge ${f?.class||''}">${esc(f?.name||'No faction')}</span><p><strong>${p.alive?'Alive':'Dead'}</strong></p><button class="secondary toggle-life" data-id="${p.id}">${p.alive?'Mark Dead':'Revive'}</button> <button class="danger delete-player" data-id="${p.id}">Delete</button></div>`}).join('')||'<p class="muted">No matching players.</p>';
  document.querySelectorAll('.toggle-life').forEach(b=>b.onclick=()=>{const p=playerById(b.dataset.id);p.alive=!p.alive;save()});
  document.querySelectorAll('.delete-player').forEach(b=>b.onclick=()=>removeById('players',b.dataset.id));
}
function renderQueue(){
  const sorted=[...state.actions].sort((a,b)=>priorityMap[a.category]-priorityMap[b.category]);
  $('queueList').innerHTML=sorted.map((a,i)=>{const actor=playerById(a.actorId),target=playerById(a.targetId);return `<div class="queue-row"><strong>${i+1}</strong><div><strong>${esc(a.name)}</strong><div class="muted">${esc(actor?.name||'Unknown')} → ${esc(target?.name||'Unknown')} • ${esc(a.category)}</div></div><button class="danger delete-action" data-id="${a.id}">Remove</button></div>`}).join('')||'<p class="muted">No queued actions.</p>';
  document.querySelectorAll('.delete-action').forEach(b=>b.onclick=()=>removeById('actions',b.dataset.id));
}
function renderStats(){
  const ff=$('statsFactionFilter').value,aliveOnly=$('aliveOnlyStats').checked;
  let roles=state.roles.filter(r=>ff==='ALL'||r.factionId===ff);
  if(aliveOnly){const activeRoleIds=new Set(state.players.filter(p=>p.alive).map(p=>p.roleId));roles=roles.filter(r=>activeRoleIds.has(r.id))}
  const counts={};roles.forEach(r=>r.tags.forEach(t=>counts[t]=(counts[t]||0)+1));
  const max=Math.max(1,...Object.values(counts));
  $('abilityStats').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>`<div class="stat-row"><strong>${esc(tag)}</strong><span>${count}</span><div class="bar"><span style="width:${(count/max)*100}%"></span></div></div>`).join('')||'<p class="muted">Add abilities to roles to populate statistics.</p>';
}
function abilityTemplateByName(name){return standardAbilities().find(a=>normalized(a.name)===normalized(name))}
function snapshotAbility(a){return {name:a.name,category:a.category,definition:a.definition,phase:a.phase,mechanics:[...a.mechanics],savedAt:new Date().toISOString()}}
function clearAbilityForm(){
  editingAbilityId=null;
  $('abilityFormTitle').textContent='Add Ability';
  $('abilityEditNotice').hidden=true;
  $('addAbilityBtn').textContent='Add Ability';
  $('cancelAbilityEditBtn').hidden=true;
  $('abilityName').value='';$('abilityDefinition').value='';$('abilityMechanics').value='';$('abilityCategory').value='Investigation';$('abilityPhase').value='Night';
}
function beginAbilityEdit(abilityId){
  const a=state.abilities.find(x=>x.id===abilityId);if(!a)return;
  editingAbilityId=a.id;
  $('abilityFormTitle').textContent=`Edit ${a.name}`;
  $('abilityEditNotice').hidden=false;
  $('abilityEditNotice').textContent=a.builtIn?'Built-in abilities can be customized and restored to their default definition at any time.':'Editing a custom ability.';
  $('addAbilityBtn').textContent='Save Changes';
  $('cancelAbilityEditBtn').hidden=false;
  $('abilityName').value=a.name;$('abilityCategory').value=a.category;$('abilityDefinition').value=a.definition;$('abilityPhase').value=a.phase||'Any';$('abilityMechanics').value=a.mechanics.join(', ');
  $('abilityName').focus();
}
function duplicateAbility(abilityId){
  const source=state.abilities.find(x=>x.id===abilityId);if(!source)return;
  let name=`${source.name} Copy`,number=2;
  while(state.abilities.some(a=>normalized(a.name)===normalized(name)))name=`${source.name} Copy ${number++}`;
  state.abilities.push({...source,id:id(),name,builtIn:false,revisions:[]});save();
}
function resetBuiltInAbility(abilityId){
  const current=state.abilities.find(x=>x.id===abilityId);if(!current?.builtIn)return;
  const template=abilityTemplateByName(current.name);
  if(!template)return alert('The original built-in definition could not be found.');
  if(!confirm(`Restore ${current.name} to its original built-in definition?`))return;
  current.revisions=[...(current.revisions||[]),snapshotAbility(current)];
  Object.assign(current,{category:template.category,definition:template.definition,phase:template.phase,mechanics:template.mechanics});
  save();
}
function renderEncyclopedia(){
  const search=normalized($('abilitySearch').value),category=$('abilityCategoryFilter').value;
  const categories=[...new Set(state.abilities.map(a=>a.category))].sort();
  const filter=$('abilityCategoryFilter'),current=filter.value;filter.innerHTML='';filter.append(option('ALL','All categories'));categories.forEach(c=>filter.append(option(c,c)));if([...filter.options].some(o=>o.value===current))filter.value=current;
  const abilities=state.abilities.filter(a=>(category==='ALL'||a.category===category)&&normalized(`${a.name} ${a.definition} ${a.mechanics.join(' ')}`).includes(search)).sort((a,b)=>a.name.localeCompare(b.name));
  $('abilityCount').textContent=`${state.abilities.length} known`;
  $('abilityList').innerHTML=abilities.map(a=>{const used=rolesUsingAbility(a),revisionCount=(a.revisions||[]).length;return `<article class="ability-entry" data-id="${a.id}"><div class="ability-summary"><div><div class="ability-name">${esc(a.name)}</div><div class="ability-definition">${esc(a.definition)}</div></div><span class="category-badge">${esc(a.category)}</span><span class="expand-mark">＋</span></div><div class="ability-details"><div class="detail-grid"><div class="detail-box"><strong>Usual phase</strong>${esc(a.phase||'Any')}</div><div class="detail-box"><strong>Related mechanics</strong>${a.mechanics.map(m=>`<span class="badge">${esc(m)}</span>`).join(' ')||'None'}</div><div class="detail-box"><strong>Used by roles</strong>${used.length}</div></div><strong>Roles using this ability</strong>${used.length?`<ul class="usage-list">${used.map(r=>`<li>${esc(r.name)} — ${esc(factionById(r.factionId)?.name||'No faction')}</li>`).join('')}</ul>`:'<p class="muted">No roles currently use this ability.</p>'}<div class="ability-meta"><span>${a.builtIn?'Built-in engine ability':'Custom ability'}</span><span>${revisionCount} saved revision${revisionCount===1?'':'s'}</span></div><div class="ability-actions"><button class="secondary edit-ability" data-id="${a.id}">Edit</button><button class="secondary duplicate-ability" data-id="${a.id}">Duplicate</button>${a.builtIn?`<button class="secondary reset-ability" data-id="${a.id}">Reset Default</button>`:`<button class="danger delete-ability" data-id="${a.id}">Delete</button>`}</div></div></article>`}).join('')||'<div class="empty-state">No abilities match this search.</div>';
  document.querySelectorAll('.ability-summary').forEach(el=>el.onclick=()=>{const entry=el.closest('.ability-entry');entry.classList.toggle('open');entry.querySelector('.expand-mark').textContent=entry.classList.contains('open')?'−':'＋'});
  document.querySelectorAll('.edit-ability').forEach(b=>b.onclick=e=>{e.stopPropagation();beginAbilityEdit(b.dataset.id)});
  document.querySelectorAll('.duplicate-ability').forEach(b=>b.onclick=e=>{e.stopPropagation();duplicateAbility(b.dataset.id)});
  document.querySelectorAll('.reset-ability').forEach(b=>b.onclick=e=>{e.stopPropagation();resetBuiltInAbility(b.dataset.id)});
  document.querySelectorAll('.delete-ability').forEach(b=>b.onclick=e=>{e.stopPropagation();const a=state.abilities.find(x=>x.id===b.dataset.id);if(rolesUsingAbility(a).length&&!confirm('This ability is used by one or more roles. Delete it anyway?'))return;if(editingAbilityId===a.id)clearAbilityForm();removeById('abilities',b.dataset.id)});
}
function renderSettings(){
  $('gameName').value=state.settings.gameName;$('villagerLabel').value=state.settings.labels.VILLAGER;$('denLabel').value=state.settings.labels.DEN;$('neutralLabel').value=state.settings.labels.NEUTRAL;$('allowMultiDen').checked=state.settings.allowMultiDen;document.title=`${state.settings.gameName} — GM Command Center`;
}
function renderAll(){renderSelects();renderDashboard();renderFactions();renderRoles();renderPlayers();renderQueue();renderStats();renderEncyclopedia();renderSettings()}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.view).classList.add('active')}));
$('addFactionBtn').onclick=()=>{const name=$('factionName').value.trim();if(!name)return alert('Enter a faction name.');const cls=$('factionClass').value;if(cls==='DEN'&&!state.settings.allowMultiDen&&state.factions.some(f=>f.class==='DEN'))return alert('Multiple Den factions are disabled in Settings.');state.factions.push({id:id(),name,class:cls,alias:$('factionAlias').value.trim(),teamNumber:Number($('factionTeam').value)||1});$('factionName').value='';$('factionAlias').value='';save()};
$('addRoleBtn').onclick=()=>{const name=$('roleName').value.trim();if(!name||!$('roleFaction').value)return alert('Enter a role name and faction.');state.roles.push({id:id(),name,factionId:$('roleFaction').value,tags:$('roleTags').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),notes:$('roleNotes').value.trim()});$('roleName').value='';$('roleTags').value='';$('roleNotes').value='';save()};
$('addPlayerBtn').onclick=()=>{const name=$('playerName').value.trim();if(!name||!$('playerRole').value)return alert('Enter a player name and role.');state.players.push({id:id(),name,roleId:$('playerRole').value,alive:true});$('playerName').value='';save()};
$('addActionBtn').onclick=()=>{if(!$('actionActor').value||!$('actionTarget').value)return alert('Add living players first.');state.actions.push({id:id(),actorId:$('actionActor').value,targetId:$('actionTarget').value,name:$('actionName').value.trim()||$('actionCategory').value,category:$('actionCategory').value});$('actionName').value='';save()};
$('addAbilityBtn').onclick=()=>{const name=$('abilityName').value.trim(),definition=$('abilityDefinition').value.trim();if(!name||!definition)return alert('Ability name and definition are required.');const duplicate=state.abilities.find(a=>normalized(a.name)===normalized(name)&&a.id!==editingAbilityId);if(duplicate)return alert('An ability with this name already exists.');const fields={name,category:$('abilityCategory').value,definition,phase:$('abilityPhase').value,mechanics:$('abilityMechanics').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)};if(editingAbilityId){const ability=state.abilities.find(a=>a.id===editingAbilityId);if(!ability)return clearAbilityForm();ability.revisions=[...(ability.revisions||[]),snapshotAbility(ability)];Object.assign(ability,fields)}else state.abilities.push({id:id(),...fields,builtIn:false,revisions:[]});clearAbilityForm();save()};
$('cancelAbilityEditBtn').onclick=clearAbilityForm;
$('saveSettingsBtn').onclick=()=>{state.settings.gameName=$('gameName').value.trim()||'Untitled Social Deduction Game';state.settings.labels={VILLAGER:$('villagerLabel').value.trim()||'Villagers',DEN:$('denLabel').value.trim()||'Den',NEUTRAL:$('neutralLabel').value.trim()||'Neutrals'};state.settings.allowMultiDen=$('allowMultiDen').checked;save()};
$('allowMultiDen').onchange=()=>{state.settings.allowMultiDen=$('allowMultiDen').checked;save()};
['roleSearch','roleFactionFilter'].forEach(i=>$(i).addEventListener('input',renderRoles));['playerSearch','playerLifeFilter'].forEach(i=>$(i).addEventListener('input',renderPlayers));['statsFactionFilter','aliveOnlyStats'].forEach(i=>$(i).addEventListener('input',renderStats));['abilitySearch','abilityCategoryFilter'].forEach(i=>$(i).addEventListener('input',renderEncyclopedia));
$('newGameBtn').onclick=()=>{if(confirm('Create a new blank game? Built-in encyclopedia abilities will remain available.')){state=defaultState();save()}};
$('resetBtn').onclick=()=>{if(confirm('Reset all locally stored engine data?')){localStorage.removeItem(STORAGE_KEY);state=defaultState();save()}};
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='gm-command-center-game.json';a.click();URL.revokeObjectURL(a.href)};
$('importFile').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{state=migrate(JSON.parse(reader.result));save()}catch{alert('Invalid game file.')}};reader.readAsText(file)};
renderAll();
