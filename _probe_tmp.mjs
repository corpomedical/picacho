import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data: chars } = await sb.from('character_profiles').select('id,name,reference_image_urls,outfit_image_urls,created_at');
for (const c of chars) {
  console.log(`${c.id.slice(0,8)} refs=${(c.reference_image_urls||[]).length} outfits=${(c.outfit_image_urls||[]).length} created=${c.created_at.slice(0,10)}`);
}
const { data: gens } = await sb.from('generations').select('id,content_type,status,created_at,character_profile_id').order('created_at',{ascending:false}).limit(400);
const byType = {};
for (const g of gens) { const k=g.content_type+':'+g.status; byType[k]=(byType[k]||0)+1; }
console.log('recent gens by type:status', JSON.stringify(byType));
const refCount = Object.fromEntries(chars.map(c=>[c.id,(c.reference_image_urls||[]).length]));
const vid = gens.filter(g=>g.content_type==='video');
console.log('video gens in last 400:', vid.length, '| on a >=2-photo character:', vid.filter(g=>refCount[g.character_profile_id]>=2).length);
console.log('oldest of the 400:', gens[gens.length-1]?.created_at);
