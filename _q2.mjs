import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data } = await s.from('generations').select('id,user_id,status,content_type,result_url,created_at,credits_used,refunded_at,deleted_at,match_score,video_model_id,model_id,angle_group_id,progress_stage').order('created_at',{ascending:false});
const bucketize = (u) => {
  if (!u) return 'NULL';
  if (u.startsWith('/api/media/')) return 'media-route';
  if (u.startsWith('mock://')) return 'mock';
  if (/storage\/v1\/object\/sign/.test(u)) return 'supabase-signed(expiring)';
  if (/fal\.media|fal\.run|fal\.ai/.test(u)) return 'fal-external';
  if (u.startsWith('data:')) return 'data-uri';
  if (u.startsWith('http')) return 'other-http:'+new URL(u).hostname;
  return 'other:'+u.slice(0,30);
};
const tally = {};
for (const r of data) {
  const k = `${r.content_type}|${r.status}|${bucketize(r.result_url)}`;
  tally[k] = (tally[k]||0)+1;
}
console.log('--- content_type|status|url-kind ---');
for (const [k,v] of Object.entries(tally).sort()) console.log(v.toString().padStart(4), k);
console.log('\n--- succeeded but no result_url ---');
console.log(data.filter(r=>r.status==='succeeded' && !r.result_url).map(r=>[r.id,r.content_type,r.created_at]).slice(0,20));
console.log('\n--- match_score coverage (succeeded) ---');
const succ = data.filter(r=>r.status==='succeeded');
console.log('succeeded:', succ.length, 'scored:', succ.filter(r=>r.match_score!=null).length);
console.log('by type:', ['image','video'].map(t=>`${t}: ${succ.filter(r=>r.content_type===t).length} succ / ${succ.filter(r=>r.content_type===t&&r.match_score!=null).length} scored`).join(' | '));
console.log('\n--- deleted rows ---');
console.log('deleted:', data.filter(r=>r.deleted_at).length, 'of which succeeded:', data.filter(r=>r.deleted_at&&r.status==='succeeded').length);
console.log('\n--- stuck non-terminal (older than 1h) ---');
const now=Date.now();
console.log(data.filter(r=>!['succeeded','failed'].includes(r.status) && now-new Date(r.created_at)>3600e3).map(r=>[r.id,r.status,r.progress_stage,r.created_at,r.credits_used,r.refunded_at]));
