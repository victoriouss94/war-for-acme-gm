(function(){
  const config=window.GM_SUPABASE_CONFIG||{};
  let client=null,session=null,channel=null,authListener=null;
  const required=()=>{if(!client)throw new Error('Shared database is not configured.');return client};
  const unwrap=({data,error})=>{if(error)throw error;return data};
  const displayName=()=>session?.user?.user_metadata?.display_name||session?.user?.email?.split('@')[0]||'GM';

  async function init(onAuth){
    if(!window.supabase?.createClient||!config.url||!config.publishableKey)return {available:false,session:null};
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},realtime:{params:{eventsPerSecond:20}}});
    session=(await client.auth.getSession()).data.session;
    authListener=client.auth.onAuthStateChange((_event,next)=>{session=next;queueMicrotask(()=>onAuth?.(next))}).data.subscription;
    return {available:true,session};
  }
  async function signIn(email,name){
    const redirectTo=location.origin+location.pathname;
    return unwrap(await required().auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,data:{display_name:name||email.split('@')[0]}}}));
  }
  async function passwordSignIn(email,password){return unwrap(await required().auth.signInWithPassword({email,password}))}
  async function createAccount(email,password,name){return unwrap(await required().auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{display_name:name||email.split('@')[0]}}}))}
  async function signOut(){await unsubscribe();unwrap(await required().auth.signOut())}
  async function listGames(){
    const rows=unwrap(await required().from('games').select('*,game_members(user_id,member_role)').order('updated_at',{ascending:false}));
    return rows.map(row=>({...row,member_role:row.game_members?.find(m=>m.user_id===session.user.id)?.member_role||'viewer'}));
  }
  async function loadGame(gameId){
    const document=unwrap(await required().from('game_documents').select('*').eq('game_id',gameId).single());
    const game=unwrap(await required().from('games').select('*').eq('id',gameId).single());
    const members=unwrap(await required().from('game_members').select('user_id,member_role,profiles(display_name)').eq('game_id',gameId));
    return {document,game,members};
  }
  async function createGame(document){return unwrap(await required().rpc('create_game',{game_id:document.game.id,initial_document:document}));}
  async function saveGame(gameId,version,document,audit={}){
    const rows=unwrap(await required().rpc('save_game_document',{target_game_id:gameId,expected_version:version,next_document:document,change_action:audit.action||'Game updated',change_entity_type:audit.entityType||'game',change_entity_id:audit.entityId||null}));
    return rows[0];
  }
  async function deleteGame(gameId){return unwrap(await required().rpc('delete_game',{target_game_id:gameId}))}
  async function joinGame(code){return unwrap(await required().rpc('join_game_by_code',{invite_code:code}))}
  async function setMemberRole(gameId,userId,role){return unwrap(await required().rpc('set_game_member_role',{target_game_id:gameId,target_user_id:userId,next_role:role}))}
  async function roleTemplates(){const rows=unwrap(await required().from('game_documents').select('game_id,document'));return rows.flatMap(row=>(row.document?.data?.roles||[]).map(role=>({key:row.game_id+':'+role.id,sourceGameId:row.game_id,sourceGameName:row.document?.game?.name||'Saved Game',role,abilities:row.document?.data?.abilities||[],factions:row.document?.data?.factions||[]})))}
  async function history(gameId){return unwrap(await required().from('change_history').select('*,profiles!change_history_profile_fkey(display_name)').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250))}
  async function unsubscribe(){if(channel&&client){await client.removeChannel(channel);channel=null}}
  async function subscribe(gameId,{onDocument,onPresence,onStatus}){
    await unsubscribe();
    channel=required().channel('game:'+gameId,{config:{private:true,presence:{key:session.user.id}}});
    channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_documents',filter:'game_id=eq.'+gameId},payload=>onDocument?.(payload.new));
    channel.on('presence',{event:'sync'},()=>onPresence?.(channel.presenceState()));
    channel.subscribe(async status=>{
      onStatus?.(status);
      if(status==='SUBSCRIBED')await channel.track({userId:session.user.id,name:displayName(),view:'game',editing:null,onlineAt:new Date().toISOString()});
    });
  }
  async function track(patch){if(channel)await channel.track({userId:session.user.id,name:displayName(),onlineAt:new Date().toISOString(),...patch})}
  function user(){return session?.user||null}
  function dispose(){authListener?.unsubscribe();unsubscribe()}
  window.GMCloud={init,signIn,passwordSignIn,createAccount,signOut,listGames,loadGame,createGame,saveGame,deleteGame,joinGame,setMemberRole,roleTemplates,history,subscribe,unsubscribe,track,user,dispose};
})();
