import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ABILITY_DATA_STATUSES,ROLE_TYPES,classifyRoleAbilityData,createAssignmentPlan,expandRoleSlots,normalizeRoleSetup,parsePlayerFile,parsePlayerText,previewPlayerImport,rosterAnalysis} from '../js/player-setup.js';

const roles=[
  {id:'sheriff',name:'Sheriff',factionId:'village',roleType:'STANDARD',slotCount:1,tags:['Ask'],enabled:true},
  {id:'basic',name:'Basic Villager',factionId:'village',roleType:'BASIC',slotCount:2,tags:[],enabled:true},
  {id:'den',name:'Den Member',factionId:'den',roleType:'STANDARD',slotCount:1,tags:['Kill'],enabled:true}
];
const players=['Riz','Sky','AJ','Ruby'].map((name,index)=>({id:'p'+index,name,roleId:''}));
const sequence=(...values)=>{let index=0;return limit=>values[index++%values.length]%limit};

test('Basic Roles are explicit first-class zero-ability roles',()=>{
  assert.deepEqual(normalizeRoleSetup({roleType:'BASIC',slotCount:10}),{roleType:ROLE_TYPES.BASIC,abilityDataStatus:ABILITY_DATA_STATUSES.INTENTIONALLY_NONE,basicEvidence:'Explicit Basic Role',slotCount:10});
  assert.equal(classifyRoleAbilityData({name:'Juror',description:'No abilities.'}).roleType,ROLE_TYPES.BASIC);
  assert.equal(classifyRoleAbilityData({name:'Witness',description:'Vanilla'}).abilityDataStatus,ABILITY_DATA_STATUSES.INTENTIONALLY_NONE);
});

test('powered and unresolved roles are not accidentally classified Basic',()=>{
  assert.equal(classifyRoleAbilityData({name:'Sheriff',tags:['Ask']}).roleType,ROLE_TYPES.STANDARD);
  assert.equal(classifyRoleAbilityData({name:'Mystery'}).abilityDataStatus,ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE);
});

test('TXT and CSV player names preserve display spelling',()=>{
  assert.deepEqual(parsePlayerText(' Riz \nSky\nAJ'),['Riz','Sky','AJ']);
  assert.deepEqual(parsePlayerText('Player,Team\n"Riz, Jr.",Village\nSky,Den',{format:'csv'}),['Riz, Jr.','Sky']);
});

test('DOCX player-name branch extracts raw text',async()=>{
  const file={name:'players.docx',size:100,arrayBuffer:async()=>new ArrayBuffer(4)};
  const names=await parsePlayerFile(file,{extractRawText:async()=>({value:'Riz\nSky\nAJ'})});
  assert.deepEqual(names,['Riz','Sky','AJ']);
});

test('player import preview detects duplicates, existing players, removals, and possible renames',()=>{
  const preview=previewPlayerImport([' Riz ','riz','Sky','Phenix'],[{id:'1',name:'Riz'},{id:'2',name:'Phoenix'},{id:'3',name:'Ruby'}]);
  assert.deepEqual(preview.duplicates,['Riz']);assert.deepEqual(preview.existing,['Riz']);assert.deepEqual(preview.newPlayers,['Sky','Phenix']);assert.deepEqual(preview.removed,['Phoenix','Ruby']);assert.deepEqual(preview.possibleRenames,[{from:'Phoenix',to:'Phenix'}]);
});

test('role templates expand to slots without duplicate role definitions',()=>{
  assert.equal(expandRoleSlots(roles).length,4);assert.equal(expandRoleSlots(roles).filter(slot=>slot.roleId==='basic').length,2);
  assert.deepEqual(rosterAnalysis(players,roles),{players:4,roleSlots:4,difference:0,unassignedPlayers:4,assignedPlayers:0,basicRoleSlots:2,unusedRoleSlots:0,assignedRoleIds:[]});
});

test('random assignment uses every player and Basic slots normally',()=>{
  const plan=createAssignmentPlan({players,roles,randomInt:sequence(1,0,2,0,0,0,0,0)});
  assert.equal(Object.keys(plan.assignments).length,4);assert.equal(plan.summary.unassigned,0);assert.equal(plan.summary.basicRoleAssignments,2);assert.equal(new Set(Object.keys(plan.assignments)).size,4);
});

test('locked, partial random, and faction-constrained assignments are preserved',()=>{
  const plan=createAssignmentPlan({players,roles,lockedAssignments:{p0:'sheriff'},factionConstraints:{p3:'den'},randomInt:sequence(0,0,0,0,0,0)});
  assert.equal(plan.assignments.p0,'sheriff');assert.equal(plan.assignments.p3,'den');assert.ok(plan.locked.includes('p0'));
});

test('existing live assignments are preserved unless replacement is explicit',()=>{
  const assigned=players.map(player=>({...player}));assigned[0].roleId='sheriff';const plan=createAssignmentPlan({players:assigned,roles,randomInt:sequence(0,0,0,0,0)});assert.equal(plan.assignments.p0,'sheriff');assert.ok(plan.locked.includes('p0'));
});

test('shortage and impossible faction constraints fail without partial assignment',()=>{
  assert.throws(()=>createAssignmentPlan({players:[...players,{id:'p4',name:'Lilly',roleId:''}],roles,randomInt:sequence(0)}),/NOT_ENOUGH_ROLE_SLOTS/);
  assert.throws(()=>createAssignmentPlan({players:players.slice(0,3),roles:roles.filter(role=>role.factionId==='village'),factionConstraints:{p0:'den'},randomInt:sequence(0)}),/NO_ELIGIBLE_ROLE_SLOT/);
});

test('shuffle can produce a new mapping while locks remain stable',()=>{
  const first=createAssignmentPlan({players,roles,lockedAssignments:{p0:'sheriff'},randomInt:sequence(0,0,0,0,0)}),second=createAssignmentPlan({players,roles,lockedAssignments:{p0:'sheriff'},randomInt:sequence(2,1,1,1,1)});
  assert.equal(first.assignments.p0,'sheriff');assert.equal(second.assignments.p0,'sheriff');assert.notDeepEqual(first.assignments,second.assignments);
});

test('migration enforces approval, active-game safety, permissions, secrecy, and audit history',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260823090000_basic_roles_player_assignment.sql',import.meta.url),'utf8');
  assert.match(sql,/confirm_active_game boolean/);assert.match(sql,/ACTIVE_GAME_CONFIRMATION_REQUIRED/);assert.match(sql,/public\.can_edit_game\(preview\.game_id\)/);assert.match(sql,/role_assignment_history_gm_read/);assert.match(sql,/insert into public\.role_assignment_history/);assert.match(sql,/public\.save_game_document/);assert.match(sql,/order by gen_random_uuid\(\)/);assert.doesNotMatch(sql,/grant (insert|update|delete).*role_assignment_/i);
});

test('feature reuses existing role, player, and player.roleId architecture',async()=>{
  const [app,sql]=await Promise.all([readFile(new URL('../js/app.js',import.meta.url),'utf8'),readFile(new URL('../supabase/migrations/20260823090000_basic_roles_player_assignment.sql',import.meta.url),'utf8')]);
  assert.match(app,/state\.roles/);assert.match(app,/state\.players/);assert.match(app,/roleId/);assert.doesNotMatch(sql,/create table if not exists public\.(basic_roles|imported_players|live_role_assignments)/i);
});
