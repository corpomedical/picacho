import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data: posts, error } = await s.from('community_posts').select('id,generation_id,user_id,content_type,media_url,hidden_at,created_at');
if (error) { console.log('community_posts ERR', error.message); }
else {
  console.log('community_posts:', posts.length);
  const gids = posts.map(p=>p.generation_id);
  const { data: gens } = await s.from('generations').select('id,deleted_at,status,result_url,content_type').in('id', gids);
  const map = new Map(gens.map(g=>[g.id,g]));
  let broken=0;
  for (const p of posts) {
    const g = map.get(p.generation_id);
    if (!g) { console.log('POST with MISSING generation', p.id); continue; }
    if (g.deleted_at) { broken++; console.log('POST STILL PUBLIC but generation soft-deleted:', p.id, 'gen', g.id, 'deleted_at', g.deleted_at, 'ctype', p.content_type, 'url', (p.media_url||'').slice(0,70)); }
  }
  console.log('posts whose generation is soft-deleted:', broken);
}
