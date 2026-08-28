import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {effectivePlayerAbilities} from '../js/player-abilities.js';
import {abilityModeAccess,formatRoleModeAssignments,isModeContextAbility,normalizeRoleModes,parseRoleModeAssignments,roleModeContext} from '../js/role-modes.js';
import {roleAbilityMap,roleModeAbilityMap} from '../scripts/build-transformers-payload.mjs';

const ability=(id,name,{phase='Night',type='ONE_PLAYER',manual=false}={})=>({id,name,category:phase==='Passive'?'Protection':'Support',phase,definition:name,mechanics:[],targeting:{type,selectionRuleType:'HARD_SELECTION_RESTRICTION',minTargets:type==='ONE_PLAYER'?1:0,maxTargets:type==='ONE_PLAYER'?1:0,livingOnly:type==='ONE_PLAYER',deadOnly:false,selfAllowed:true,selfProhibited:false,factionMemberOnly:false,nonFactionMemberOnly:false,hiddenInformationSafe:true,manuallyTriggerable:manual,selectionRules:[],effectEligibilityRules:[],targetFactionRestrictions:[],targetRoleRestrictions:[]}});
const abilities=[ability('guard','Guard'),ability('reflect','Reflection',{phase:'Passive',type:'NO_TARGET'}),ability('plates','Protective Plates',{phase:'Passive',type:'NO_TARGET'}),ability('den-block','Den Block',{type:'FACTION'}),ability('save','Save'),ability('heal','Heal'),ability('protect','Protect'),ability('ask','Basic Ask'),ability('roleblock','Roleblock'),ability('death','Death Immunity',{phase:'Passive',type:'NO_TARGET'}),ability('instant','Personal Instant Kill'),ability('super','Super Kill'),ability('wide','Role-wide Signal'),{...ability('robot-mode','Ironhide — Robot Mode'),recordType:'MODE_CONTEXT',selectableAsAction:false}];
const modes=(roleId,robotIds,altIds,robotPassives=[])=>[
  {id:`${roleId}:robot`,name:'Robot Mode',abilityIds:robotIds,passiveAbilityIds:robotPassives},
  {id:`${roleId}:alt`,name:'Alt Mode',abilityIds:altIds,passiveAbilityIds:[]}
];
const role=(id,name,roleModes,wide=[])=>({id,name,roleType:'STANDARD',tags:[...new Set([...wide,...roleModes.flatMap(mode=>[...mode.abilityIds,...mode.passiveAbilityIds])])].map(id=>abilities.find(item=>item.id===id)?.name).filter(Boolean),modes:roleModes,roleWideAbilityIds:wide,modeSelectionPolicy:'CHOOSE_BEFORE_ACTION'});
const ironhide=role('ironhide','Den Blocker – Ironhide',modes('ironhide',['guard'],['den-block'],['reflect','plates']));
const ratchet=role('ratchet','Doc – Ratchet',modes('ratchet',['save','heal'],['protect']));
const optimus=role('optimus','Ultimate – Optimus',modes('optimus',['ask','protect','roleblock','save'],[],['death']),['instant','super']);
const names=result=>result.abilities.map(item=>item.name);
const effective=(player,currentRole,selectedModeId='',extra={})=>effectivePlayerAbilities({player,role:currentRole,abilities,grants:extra.grants||[],statuses:extra.statuses||[],resolutionEvents:[],roleModifiers:[],game:{currentPhase:'Night',currentDay:1},selectedModeId});

test('1. multi-mode player defaults to current mode abilities',()=>{const result=effective({id:'p1',currentModeId:'ratchet:robot'},ratchet);assert.equal(result.modeContext.selectedModeId,'ratchet:robot');assert.deepEqual(names(result),['Heal','Save'])});
test('2. selecting a mode updates the mode-specific ability list',()=>{assert.deepEqual(names(effective({id:'p1',currentModeId:'ratchet:robot'},ratchet,'ratchet:alt')),['Protect'])});
test('3. selecting a mode alone never selects an ability',()=>{const context=roleModeContext({player:{id:'p1',currentModeId:'ratchet:robot'},role:ratchet,abilities,selectedModeId:'ratchet:alt'});assert.equal(context.selectedModeId,'ratchet:alt');assert.equal('selectedAbilityId' in context,false);const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');assert.match(app,/Choose an ability from this mode\./)});
test('4. a one-ability mode still returns a choice rather than the mode record',()=>{const result=effective({id:'p1'},ratchet,'ratchet:alt');assert.deepEqual(result.abilities.map(item=>item.abilityId),['protect']);assert.notEqual(result.abilities[0].abilityId,'ratchet:alt')});
test('5. a mode with several active abilities exposes every actual ability',()=>{const result=effective({id:'p1',currentModeId:'optimus:robot'},optimus);assert.deepEqual(result.abilities.filter(item=>!item.passive&&!item.roleWide).map(item=>item.name),['Basic Ask','Protect','Roleblock','Save'])});
test('6. inactive mode abilities are unavailable when mode choice is not authorized',()=>{const locked={...ratchet,modeSelectionPolicy:'CURRENT_ONLY'},result=effective({id:'p1',currentModeId:'ratchet:robot'},locked,'ratchet:alt');assert.deepEqual(names(result),['Protect']);assert.equal(result.abilities[0].available,false);assert.ok(result.abilities[0].reasons.includes('INACTIVE_MODE'))});
test('7. role-wide abilities remain visible in every mode',()=>{for(const selected of ['optimus:robot','optimus:alt']){const result=effective({id:'p1',currentModeId:'optimus:robot'},optimus,selected);assert.ok(names(result).includes('Personal Instant Kill'));assert.ok(names(result).includes('Super Kill'))}});
test('8. passive mode mechanics remain modeled but are not normal actions',()=>{const result=effective({id:'p1',currentModeId:'ironhide:robot'},ironhide);assert.ok(result.abilities.find(item=>item.name==='Reflection')?.passive);const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');assert.match(app,/!ability\.passive\|\|ability\.targeting\.manuallyTriggerable/)});
test('9. temporary access to a second mode exposes both modes abilities',()=>{const locked={...ratchet,modeSelectionPolicy:'CURRENT_ONLY'},statuses=[{playerId:'p1',state:'ACTIVE',metadata:{modeIds:['ratchet:alt']}}],result=effective({id:'p1',currentModeId:'ratchet:robot'},locked,'ratchet:robot',{statuses});assert.deepEqual(names(result),['Heal','Protect','Save']);assert.deepEqual(result.modeContext.temporaryModeIds,['ratchet:alt'])});
test('10. browsing another mode does not mutate the player current mode',()=>{const player={id:'p1',currentModeId:'ratchet:robot'};effective(player,ratchet,'ratchet:alt');assert.equal(player.currentModeId,'ratchet:robot')});
test('11. queued action persistence keeps modeId and abilityId distinct',()=>{const sql=readFileSync(new URL('../supabase/migrations/20260828050000_multi_mode_action_context.sql',import.meta.url),'utf8');assert.match(sql,/'modeId'/);assert.match(sql,/'abilityId'/);assert.match(sql,/mode_id=ability_id/);assert.match(sql,/MODE_IS_NOT_AN_ACTION/)});
test('12. reopening a queued action restores both mode and ability selection',()=>{const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');assert.match(app,/selectedActionModeId=action\.modeId\|\|''/);assert.match(app,/selectedEffectiveAbilityKey=action\.playerAbilityGrantId/)});
test('13. Ironhide Alt Mode exposes Den Block as the action',()=>{const result=effective({id:'p1',currentModeId:'ironhide:robot'},ironhide,'ironhide:alt');assert.deepEqual(names(result),['Den Block']);assert.equal(result.abilities[0].modeName,'Alt Mode')});
test('14. Ironhide Robot Mode retains Guard and reflection mechanics',()=>{const result=effective({id:'p1',currentModeId:'ironhide:robot'},ironhide);assert.ok(names(result).includes('Guard'));assert.ok(names(result).includes('Reflection'));assert.equal(result.abilities.find(item=>item.name==='Reflection').passive,true)});
test('15. Ratchet Robot Mode exposes Save and Heal',()=>{assert.deepEqual(names(effective({id:'p1',currentModeId:'ratchet:robot'},ratchet)),['Heal','Save'])});
test('16. Ratchet Alt Mode exposes Protect only',()=>{assert.deepEqual(names(effective({id:'p1'},ratchet,'ratchet:alt')),['Protect'])});
test('17. Optimus current mode filters mode abilities and keeps role-wide actions',()=>{const result=effective({id:'p1',currentModeId:'optimus:alt'},optimus);assert.deepEqual(names(result),['Personal Instant Kill','Super Kill'])});
test('18. legacy mode-name records are context-only and cannot enter role actions',()=>{const placeholder=abilities.find(item=>item.id==='robot-mode');assert.equal(isModeContextAbility(placeholder,ironhide),true);const legacy={...ironhide,tags:[...ironhide.tags,placeholder.name],activeAbilityId:placeholder.id};assert.equal(effective({id:'p1',currentModeId:'ironhide:robot'},legacy).abilities.some(item=>item.abilityId==='robot-mode'),false)});

test('role editor parses and formats Role → Mode → Ability assignments',()=>{const parsed=parseRoleModeAssignments('Robot Mode: Guard, Reflection\nAlt Mode: Den Block',abilities,['guard','reflect','den-block','wide']);assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.roleWideAbilityIds,['wide']);const record={id:'r',modes:parsed.modes,roleWideAbilityIds:parsed.roleWideAbilityIds};assert.match(formatRoleModeAssignments(record,abilities),/Robot Mode: Guard, Reflection/);assert.equal(normalizeRoleModes(record,abilities).modes.length,2);assert.equal(abilityModeAccess({abilityId:'den-block',context:roleModeContext({player:{id:'p'},role:{...record,modeSelectionPolicy:'CHOOSE_BEFORE_ACTION'},abilities,selectedModeId:'mode:alt-mode'})}).modeName,'Alt Mode')});

test('all 27 source-defined Transformers mode roles have complete ability coverage',()=>{
  assert.equal(Object.keys(roleAbilityMap).length,37);
  assert.equal(Object.keys(roleModeAbilityMap).length,27);
  for(const [roleName,mapping] of Object.entries(roleModeAbilityMap)){
    const assigned=new Set([...Object.values(mapping.modes).flat(),...mapping.roleWide]);
    assert.deepEqual([...assigned].sort(),[...roleAbilityMap[roleName].abilities].sort(),roleName);
    assert.deepEqual(Object.keys(mapping.modes),['Robot Mode','Alt Mode'],roleName);
  }
  assert.deepEqual(roleModeAbilityMap['Ultimate – Optimus'].modes['Alt Mode'],['Personal Instant Kill','Super Kill']);
  assert.deepEqual(roleModeAbilityMap['Drunk – Kup'].modes['Alt Mode'],['Drunk','Place Swap']);
});

test('production source rebuild is hash-scoped, complete, and preserves stable game entities',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260828070000_rebuild_transformers_roles_from_source.sql',import.meta.url),'utf8');
  const embedded=sql.match(/role_map constant jsonb := \$map\$([\s\S]+?)\$map\$::jsonb;/);
  assert.ok(embedded);
  const mapping=JSON.parse(embedded[1]);
  assert.equal(mapping.length,27);
  assert.equal(new Set(mapping.map(role=>role.name)).size,27);
  assert.match(sql,/81427a283aa7914b0b5bf3b0eb846b1544d12944fdf76263d2b39a838443aa04/);
  assert.doesNotMatch(sql,/56b8cfc4-c45e-4227-a37b-14652ca9ed48/);
  assert.match(sql,/Preserved 39 roles, 50 players, 101 ability records/);
  assert.match(sql,/version=version\+1/);
  for(const role of mapping){
    const source=roleModeAbilityMap[role.name]||roleModeAbilityMap['Omega Supreme – 2 nd in command'];
    assert.ok(source,role.name);
    assert.deepEqual(role.modes.map(mode=>mode.name),['Robot Mode','Alt Mode'],role.name);
  }
});
