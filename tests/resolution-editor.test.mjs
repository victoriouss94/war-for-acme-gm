import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildResolutionDraft,finalResolutionPayload,humanizeResolutionText,playerOutcomeDisplayRows,resolutionDifferences,resolutionDisplayLookup,usageAggregates,validateResolutionDraft} from '../js/resolution-editor.js';

const players=[{id:'riz',name:'Riz',roleId:'sheriff',currentFactionId:'town'},{id:'sky',name:'Sky',roleId:'guardian',currentFactionId:'town'},{id:'aj',name:'AJ',roleId:'basic',currentFactionId:'town'}];
const roles=[{id:'sheriff',name:'Sheriff',version:3,roleType:'STANDARD',tags:['Personal Instant Kill']},{id:'guardian',name:'Guardian',version:2,roleType:'STANDARD',tags:['Reflection']},{id:'basic',name:'Basic Villager',version:1,roleType:'BASIC',tags:[]}];
const abilities=[{id:'kill',name:'Personal Instant Kill'},{id:'reflect',name:'Reflection'},{id:'super',name:'Super Kill'}];
const factions=[{id:'town',name:'Town'},{id:'den',name:'Den'}];
const actions=[{id:'a1',sourcePlayerId:'riz',abilityId:'kill',name:'Personal Instant Kill',roleId:'sheriff',roleVersion:3,abilitySource:'ROLE',targetIds:['sky']},{id:'a2',sourcePlayerId:'aj',abilityId:'super',name:'Super Kill',roleId:'basic',roleVersion:1,abilitySource:'MINIGAME_REWARD',playerAbilityGrantId:'00000000-0000-0000-0000-000000000001',targetIds:['sky']}];

test('AI proposal becomes one editable result per stable queued action',()=>{
  const draft=buildResolutionDraft({proposal:{schema_version:2,action_results:[{action_id:'a1',result:'SUCCESS',use_disposition:'CONSUMED',final_target_ids:['sky'],affected_player_ids:['sky'],reason:'Kill lands.'}],final_ruling:'Sky dies.',confidence:'HIGH'},actions,players});
  assert.equal(draft.action_results.length,2);assert.equal(draft.action_results[0].role_version,3);assert.equal(draft.action_results[1].ability_source,'MINIGAME_REWARD');assert.equal(draft.player_outcomes.length,3);
});

test('AI faction-wide player outcomes and canonical grant sources survive normalization',()=>{
  const draft=buildResolutionDraft({proposal:{final_ruling:'The faction effect applies.',player_outcomes:[{player_id:'aj',life_state:'DEAD',role_id:'basic',faction_id:'town',summary:'Affected faction-wide.'}],grant_effects:[{operation:'GRANT',player_id:'riz',ability_id:'reflect',source_type:'MINI_GAME_REWARD',uses:1}]},actions:[actions[0]],players});
  assert.equal(draft.player_outcomes.find(item=>item.player_id==='aj').life_state,'DEAD');
  assert.equal(draft.grant_effects[0].source_type,'MINIGAME_REWARD');
});

test('GM final result, target, passive, and use disposition control official events',()=>{
  const draft=buildResolutionDraft({proposal:{final_ruling:'Initial.',action_results:[{action_id:'a1',result:'SUCCESS',use_disposition:'CONSUMED'}]},actions,players});
  draft.final_ruling='Sky survives.';draft.action_results[0].result='FAILURE';draft.action_results[0].final_target_ids=['aj'];draft.action_results[0].affected_player_ids=['aj'];draft.action_results[0].use_disposition='REFUNDED';draft.action_results[1].result='CANCELLED';draft.action_results[1].use_disposition='NOT_CONSUMED';draft.passive_results.push({id:'p1',source_action_id:'a1',player_id:'sky',ability_id:'reflect',ability_name:'Reflection',role_id:'guardian',role_version:2,triggered:true,result:'SUCCESS',target_ids:['riz'],affected_player_ids:['riz'],uses_consumed:0,uses_refunded:0,trigger_count:1,duration:'Immediate',effect:'Reflected.',reason:''});
  const payload=finalResolutionPayload(draft),primary=payload.events.filter(event=>['SUCCESS','FAILURE','BLOCK','CANCELLED','INELIGIBLE_EFFECT'].includes(event.event_type));
  assert.equal(primary.length,2);assert.equal(primary.find(event=>event.action_id==='a1').event_type,'FAILURE');assert.equal(payload.events.filter(event=>event.event_type==='USE_REFUNDED').length,1);assert.equal(payload.events.filter(event=>event.event_type==='ABILITY_CONSUMED').length,0);assert.equal(payload.events.filter(event=>event.event_type==='PASSIVE_TRIGGER').length,1);
});

test('passive not triggered creates no official passive usage',()=>{
  const draft=buildResolutionDraft({proposal:{final_ruling:'No trigger.'},actions:[],players});draft.passive_results=[{id:'p1',player_id:'sky',ability_id:'reflect',role_id:'guardian',role_version:2,triggered:false,result:'NOT_TRIGGERED',target_ids:[],affected_player_ids:[],uses_consumed:0,uses_refunded:0,trigger_count:0,duration:'',effect:'',reason:''}];
  assert.equal(finalResolutionPayload(draft).events.some(event=>event.event_type.startsWith('PASSIVE_')),false);
});

test('validation rejects duplicate attempts and warns before questionable state',()=>{
  const draft=buildResolutionDraft({proposal:{final_ruling:'Final.'},actions,players});draft.action_results[0].result='SUCCESS';draft.action_results[1].result='SUCCESS';draft.action_results.push({...draft.action_results[0]});draft.player_outcomes.find(item=>item.player_id==='sky').life_state='DEAD';
  const review=validateResolutionDraft(draft,{actions,players,roles,abilities,factions});assert.match(review.errors.join(' '),/Duplicate action attempt ID/);
  draft.action_results.pop();draft.action_results[1].source_type='ROLE';const warned=validateResolutionDraft(draft,{actions,players,roles,abilities,factions});assert.match(warned.warnings.join(' '),/Basic/);assert.match(warned.errors.join(' '),/explicitly enable GM override/);
});

test('structured differences preserve AI and final GM values',()=>{
  const ai=buildResolutionDraft({proposal:{final_ruling:'Sky dies.',action_results:[{action_id:'a1',result:'SUCCESS',final_target_ids:['sky'],use_disposition:'CONSUMED'}]},actions:[actions[0]],players}),final=structuredClone(ai);final.action_results[0].result='FAILURE';final.action_results[0].use_disposition='REFUNDED';final.final_ruling='Sky survives.';
  const paths=resolutionDifferences(ai,final).map(item=>item.path);assert.ok(paths.includes('actions.a1.result'));assert.ok(paths.includes('actions.a1.use_disposition'));assert.ok(paths.includes('final_ruling'));
});

test('player analytics include rewards while role-owned analytics remain separate',()=>{
  const rows=[{player_id:'aj',player_name:'AJ',role_id:'basic',role_name:'Basic Villager',ability_id:'super',ability_name:'Super Kill',source_type:'MINIGAME_REWARD',attempts:1,successful:1},{player_id:'riz',player_name:'Riz',role_id:'sheriff',role_name:'Sheriff',ability_id:'kill',ability_name:'Personal Instant Kill',source_type:'ROLE',attempts:1,failed:1}];
  const all=usageAggregates(rows),roleOwned=usageAggregates(rows.filter(row=>row.source_type==='ROLE'));assert.equal(all.players.find(item=>item.id==='aj').attempts,1);assert.equal(roleOwned.roles.some(item=>item.id==='basic'),false);assert.equal(roleOwned.roles.find(item=>item.id==='sheriff').attempts,1);
});

test('passive classification and numbered action order are enforced before approval',()=>{
  const orderedActions=[{id:'kill-action',sourcePlayerId:'riz',abilityId:'kill',name:'Personal Instant Kill',roleId:'sheriff',targetIds:['sky']},{id:'convert-action',sourcePlayerId:'riz',abilityId:'convert',name:'Convert',roleId:'sheriff',targetIds:['sky']}],orderedAbilities=[...abilities,{id:'convert',name:'Convert'}],draft=buildResolutionDraft({proposal:{final_ruling:'Final.',action_results:[{action_id:'kill-action',result:'SUCCESS'},{action_id:'convert-action',result:'SUCCESS'}]},actions:orderedActions,players});
  draft.action_results.find(item=>item.action_id==='kill-action').order=1;draft.action_results.find(item=>item.action_id==='convert-action').order=2;
  const review=validateResolutionDraft(draft,{actions:orderedActions,players,roles,abilities:orderedAbilities,factions,allowWarnings:true});assert.match(review.errors.join(' '),/global category order/);
  const passive=buildResolutionDraft({proposal:{final_ruling:'Passive.',action_results:[{action_id:'reflect-action',result:'SUCCESS',resolution_category:'REDIRECTS',active_passive:'PASSIVE'}]},actions:[{id:'reflect-action',sourcePlayerId:'sky',abilityId:'reflect',name:'Reflection',roleId:'guardian',targetIds:[]}],players}).action_results[0];assert.equal(passive.resolution_category,'PASSIVES');assert.equal(passive.resolution_timing,'EVENT_TRIGGERED');assert.equal(passive.resolution_priority,null);
});

test('GM resolution editor exposes classification, authority, and target-history review controls',async()=>{
  const app=await readFile('js/app.js','utf8');
  for(const field of ['standardized_ability_type','resolution_category','resolution_timing','source_game_rule','global_rule_used'])assert.match(app,new RegExp(`data-field="${field}"`));
  assert.match(app,/Original target\(s\)/);assert.match(app,/Transformation history/);assert.match(app,/Unknown historical role/);assert.match(app,/Unknown player/);
});

test('normal player outcomes use player and final faction names without internal status codes',()=>{
  const playerId='0ba93b57-d7fb-4086-81d5-c842903dc5e2',townId='5108cddd-3e6e-4760-b18f-f171739da6d1',denId='72c4a82c-ee58-47b0-9b6b-a902a8f4deea',lookup=resolutionDisplayLookup({players:[{id:playerId,name:'Riz',currentFactionId:townId}],factions:[{id:townId,name:'Village'},{id:denId,name:'Den'}]});
  const rows=playerOutcomeDisplayRows([{player_id:playerId,life_state:'UNCHANGED',faction_id:denId}],lookup);
  assert.deepEqual(rows,['Riz — Den']);assert.doesNotMatch(rows[0],/UNCHANGED|0ba93b57|72c4a82c/);
});

test('GM-facing resolution prose resolves known entities and masks unknown UUIDs',()=>{
  const playerId='0ba93b57-d7fb-4086-81d5-c842903dc5e2',factionId='5108cddd-3e6e-4760-b18f-f171739da6d1',unknown='e85f355f-0cc3-49c0-99a3-41b621a68f37',lookup=resolutionDisplayLookup({players:[{id:playerId,name:'Riz'}],factions:[{id:factionId,name:'Village'}]});
  const readable=humanizeResolutionText(`${playerId}: UNCHANGED • faction ${factionId}; source ${unknown}`,lookup);
  assert.match(readable,/Riz/);assert.match(readable,/Village/);assert.doesNotMatch(readable,/UNCHANGED|0ba93b57|5108cddd|e85f355f/);assert.match(readable,/Internal record/);
});
