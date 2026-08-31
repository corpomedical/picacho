import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data } = await s.from('generations').select('id,created_at,result_url,content_type').eq('content_type','video').eq('status','succeeded').order('created_at',{ascending:true}).limit(60);
console.log('checking', data.length, 'video urls, oldest first');
let dead=0;
for (const r of data) {
  if (!/^http/.test(r.result_url||'')) { console.log('SKIP non-http', r.created_at, r.result_url); continue; }
  try {
    const res = await fetch(r.result_url, {method:'HEAD'});
    if (!res.ok) { dead++; console.log('DEAD', res.status, r.created_at, r.id, r.result_url.slice(0,70)); }
  } catch(e) { dead++; console.log('ERR', r.created_at, r.id, e.message); }
}
console.log('dead video urls:', dead, 'of', data.length);
