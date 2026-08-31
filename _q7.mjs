import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
async function listAll(bucket) {
  const out = [];
  const { data: top } = await s.storage.from(bucket).list('', { limit: 1000 });
  for (const f of top||[]) {
    if (f.id === null) {
      const { data: sub } = await s.storage.from(bucket).list(f.name, { limit: 1000 });
      for (const g of (sub||[])) {
        if (g.id === null) { const {data:s2}=await s.storage.from(bucket).list(`${f.name}/${g.name}`,{limit:1000}); for(const h of (s2||[])) out.push(`${f.name}/${g.name}/${h.name}`);}
        else out.push(`${f.name}/${g.name}`);
      }
    } else out.push(f.name);
  }
  return new Set(out);
}
const gi = await listAll('generated-images');
const cr = await listAll('character-references');
const ca = await listAll('chat-attachments');

// LIVE (non-deleted) generations pointing at a missing generated-images file
const { data: gens } = await s.from('generations').select('id,result_url,deleted_at,status,content_type,created_at,user_id');
const missing = [];
for (const g of gens) {
  if (g.deleted_at) continue;
  const m = (g.result_url||'').match(/generated-images\/(.+?)(\?|$)/);
  if (m) { const p = decodeURIComponent(m[1]); if (!gi.has(p)) missing.push([g.id,g.status,g.created_at,p]); }
}
console.log('LIVE generations whose generated-images file is MISSING:', missing.length);
missing.slice(0,20).forEach(r=>console.log('  ',r.join(' | ')));

// character references pointing at missing files
const { data: chars } = await s.from('character_profiles').select('id,user_id,name,reference_image_urls,outfit_image_urls');
let cmiss=0, refPaths=new Set();
for (const c of chars) {
  for (const p of [...(c.reference_image_urls||[]), ...(c.outfit_image_urls||[])]) {
    refPaths.add(p);
    if (!cr.has(p)) { cmiss++; console.log('  CHAR missing file:', c.id, c.name, p); }
  }
}
console.log('character reference/outfit paths pointing at MISSING files:', cmiss, 'of', refPaths.size);
const crOrphans=[...cr].filter(p=>!refPaths.has(p));
console.log('character-references objects not referenced by any character:', crOrphans.length);
crOrphans.slice(0,10).forEach(p=>console.log('   orphan:',p));
console.log('chat-attachments objects:', ca.size);
