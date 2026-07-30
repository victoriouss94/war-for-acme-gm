const STORAGE_KEY='gm_command_center_generic_v3';
const priorityMap={'Block':10,'Control / Swap':20,'Protection':30,'Investigation':40,'Kill / Harmful':50,'Save / Heal':60,'Other':70};
const defaultState=()=>({
  settings:{gameName:'Untitled Social Deduction Game',labels:{VILLAGER:'Villagers',DEN:'Den',NEUTRAL:'Neutrals'},allowMultiDen:true},
  factions:[
    {id:crypto.randomUUID(),name:'Villagers',class:'VILLAGER',alias:'village',teamNumber:1},
    {id:crypto.randomUUID(),name:'Den',class:'DEN',alias:'den',teamNumber:1},
    {id:crypto.randomUUID(),name:'Neutrals',class:'NEUTRAL',alias:'neutral',teamNumber:1}
  ],roles:[],players:[],actions:[]
});
let state=load();
function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||defaultState()}catch{return defaultState()}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));renderAll()}
const $=id=>document.getElementById(id);
function option(value,label=value){const o=document.createElement('option');o.value=value;o.textContent=label;return o}
function factionById(id){return state.factions.find(f=>f.id===id)}
function roleById(id){return state.roles.find(r=>r.id===id)}
function playerById(id){return state.players.find(p=>p.id===id)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function removeById(list,id){state[list]=state[list].filter(x=>x.id!==id);save()}
function renderSelects(){
  const factionSelects=[$('roleFaction'),$('roleFactionFilter'),$('statsFactionFilter')];
  factionSelects.forEach((sel,i)=>{const current=sel.value;sel.innerHTML='';if(i>0)sel.append(option('ALL','All factions'));state.factions.forEach(f=>sel.append(option(f.id,`${f.name} (${f.class})`)));if([...sel.options].some(o=>o.value===current))sel.value=current});
  const roleSelects=[$('playerRole')];roleSelects.forEach(sel=>{const current=sel.value;sel.innerHTML='';state.roles.forEach(r=>{const f=factionById(r.factionId);sel.append(option(r.id,`${r.name} — ${f?.name||'No faction'}`))});if([...sel.options].some(o=>o.value===current))sel.value=current});
  const actor=$('actionActor'),target=$('actionTarget');const ca=actor.value,ct=target.value;actor.innerHTML='';target.innerHTML='';state.players.filter(p=>p.alive).forEach(p=>{const role=roleById(p.roleId);actor.append(option(p.id,`${p.name} (${role?.name||'No role'})`));target.append(option(p.id,`${p.name} (${role?.name||'No role'})`))});if([...actor.options].some(o=>o.value===ca))actor.value=ca;if([...target.options].some(o=>o.value===ct))target.value=ct;
}
function renderDashboard(){
  const alive=state.players.filter(p=>p.alive).length;
  $('metrics').innerHTML=[['Factions',state.factions.length],['Roles',state.roles.length],['Players',state.players.length],['Alive',alive]].map(([l,v])=>`<div class="metric"><strong>${v}</strong><span>${l}</span></div>`).join('');
  $('factionOverview').innerHTML=state.factions.map(f=>{const roles=state.roles.filter(r=>r.factionId===f.id);const players=state.players.filter(p=>roles.some(r=>r.id===p.roleId));const aliveCount=players.filter(p=>p.alive).length;return `<div class="item-card"><h3>${esc(f.name)}</h3><span class="badge ${f.class}">${f.class}</span><p>${roles.length} roles • ${players.length} players • ${aliveCount} alive</p></div>`}).join('')||'<p class="muted">No factions.</p>';
}
function renderFactions(){
  $('factionList').innerHTML=state.factions.map(f=>`<div class="item-card"><h3>${esc(f.name)}</h3><span class="badge ${f.class}">${f.class}</span><p>Alias: ${esc(f.alias||'—')} • Team ${f.teamNumber||1}</p><button class="danger delete-faction" data-id="${f.id}">Delete</button></div>`).join('');
  document.querySelectorAll('.delete-faction').forEach(b=>b.onclick=()=>{if(state.roles.some(r=>r.factionId===b.dataset.id))return alert('Move or delete this faction’s roles first.');removeById('factions',b.dataset.id)});
}
function renderRoles(){
  const q=$('roleSearch').value.toLowerCase(),ff=$('roleFactionFilter').value;
  const roles=state.roles.filter(r=>(ff==='ALL'||r.factionId===ff)&&(`${r.name} ${r.tags.join(' ')}`.toLowerCase().includes(q)));
  $('roleList').innerHTML=roles.map(r=>{const f=factionById(r.factionId);return `<div class="item-card"><h3>${esc(r.name)}</h3><span class="badge ${f?.class||''}">${esc(f?.name||'No faction')}</span><p>${r.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join(' ')||'<span class="muted">No tags</span>'}</p><p class="muted">${esc(r.notes||'')}</p><button class="danger delete-role" data-id="${r.id}">Delete</button></div>`}).join('')||'<p class="muted">No matching roles.</p>';
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
  $('abilityStats').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>`<div class="stat-row"><strong>${esc(tag)}</strong><span>${count}</span><div class="bar"><span style="width:${(count/max)*100}%"></span></div></div>`).join('')||'<p class="muted">Add ability tags to roles to populate statistics.</p>';
}
function renderSettings(){
  $('gameName').value=state.settings.gameName;$('villagerLabel').value=state.settings.labels.VILLAGER;$('denLabel').value=state.settings.labels.DEN;$('neutralLabel').value=state.settings.labels.NEUTRAL;$('allowMultiDen').checked=state.settings.allowMultiDen;document.title=`${state.settings.gameName} — GM Command Center`;
}
function renderAll(){renderSelects();renderDashboard();renderFactions();renderRoles();renderPlayers();renderQueue();renderStats();renderSettings()}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.view).classList.add('active')}));
$('addFactionBtn').onclick=()=>{const name=$('factionName').value.trim();if(!name)return alert('Enter a faction name.');const cls=$('factionClass').value;if(cls==='DEN'&&!state.settings.allowMultiDen&&state.factions.some(f=>f.class==='DEN'))return alert('Multiple Den factions are disabled in Settings.');state.factions.push({id:crypto.randomUUID(),name,class:cls,alias:$('factionAlias').value.trim(),teamNumber:Number($('factionTeam').value)||1});$('factionName').value='';$('factionAlias').value='';save()};
$('addRoleBtn').onclick=()=>{const name=$('roleName').value.trim();if(!name||!$('roleFaction').value)return alert('Enter a role name and faction.');state.roles.push({id:crypto.randomUUID(),name,factionId:$('roleFaction').value,tags:$('roleTags').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),notes:$('roleNotes').value.trim()});$('roleName').value='';$('roleTags').value='';$('roleNotes').value='';save()};
$('addPlayerBtn').onclick=()=>{const name=$('playerName').value.trim();if(!name||!$('playerRole').value)return alert('Enter a player name and role.');state.players.push({id:crypto.randomUUID(),name,roleId:$('playerRole').value,alive:true});$('playerName').value='';save()};
$('addActionBtn').onclick=()=>{if(!$('actionActor').value||!$('actionTarget').value)return alert('Add living players first.');state.actions.push({id:crypto.randomUUID(),actorId:$('actionActor').value,targetId:$('actionTarget').value,name:$('actionName').value.trim()||$('actionCategory').value,category:$('actionCategory').value});$('actionName').value='';save()};
$('saveSettingsBtn').onclick=()=>{state.settings.gameName=$('gameName').value.trim()||'Untitled Social Deduction Game';state.settings.labels={VILLAGER:$('villagerLabel').value.trim()||'Villagers',DEN:$('denLabel').value.trim()||'Den',NEUTRAL:$('neutralLabel').value.trim()||'Neutrals'};state.settings.allowMultiDen=$('allowMultiDen').checked;save()};
$('allowMultiDen').onchange=()=>{state.settings.allowMultiDen=$('allowMultiDen').checked;save()};
['roleSearch','roleFactionFilter'].forEach(id=>$(id).addEventListener('input',renderRoles));['playerSearch','playerLifeFilter'].forEach(id=>$(id).addEventListener('input',renderPlayers));['statsFactionFilter','aliveOnlyStats'].forEach(id=>$(id).addEventListener('input',renderStats));
$('newGameBtn').onclick=()=>{if(confirm('Create a new blank game?')){state=defaultState();save()}};
$('resetBtn').onclick=()=>{if(confirm('Reset all locally stored engine data?')){localStorage.removeItem(STORAGE_KEY);state=defaultState();save()}};
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='gm-command-center-game.json';a.click();URL.revokeObjectURL(a.href)};
$('importFile').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{state=JSON.parse(reader.result);save()}catch{alert('Invalid game file.')}};reader.readAsText(file)};
renderAll();
