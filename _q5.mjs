import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

async function listAll(bucket) {
  const out = [];
  // top-level folders = user ids
  const { data: top, error } = await s.storage.from(bucket).list('', { limit: 1000 });
  if (error) { console.log(bucket, 'list ERR', error.message); return out; }
  for (const f of top) {
    if (f.id === null) { // folder
      const { data: sub } = await s.storage.from(bucket).list(f.name, { limit: 1000 });
      for (const g of (sub||[])) {
        if (g.id === null) {
          const { data: sub2 } = await s.storage.from(bucket).list(`${f.name}/${g.name}`, {limit:1000});
          for (const h of (sub2||[])) out.push({path:`${f.name}/${g.name}/${h.name}`, size:h.metadata?.size, created:h.created_at});
        } else out.push({path:`${f.name}/${g.name}`, size:g.metadata?.size, created:g.created_at});
      }
    } else out.push({path:f.name, size:f.metadata?.size, created:f.created_at});
  }
  return out;
}

for (const b of ['generated-images','character-references','chat-attachments']) {
  const objs = await listAll(b);
  const bytes = objs.reduce((a,o)=>a+(o.size||0),0);
  console.log(`${b}: ${objs.length} objects, ${(bytes/1048576).toFixed(1)} MB`);
  global[b] = objs;
}

// generated-images: which objects are referenced by a generations row?
const { data: gens } = await s.from('generations').select('id,result_url,deleted_at,status,user_id');
const refd = new Set();
for (const g of gens) {
  const u = g.result_url || '';
  const m = u.match(/generated-images\/(.+?)(\?|$)/);
  if (m) refd.add(decodeURIComponent(m[1]));
}
const objs = global['generated-images'];
const orphans = objs.filter(o=>!refd.has(o.path));
console.log('\ngenerated-images objects not referenced by ANY generations row:', orphans.length, ((orphans.reduce((a,o)=>a+(o.size||0),0))/1048576).toFixed(1)+' MB');
for (const o of orphans.slice(0,15)) console.log('  ', o.path, o.size, o.created);

// deleted generations whose file still exists
const stillThere = gens.filter(g=>g.deleted_at && g.content_type!=='video').map(g=>{
  const m=(g.result_url||'').match(/generated-images\/(.+?)(\?|$)/); return m?decodeURIComponent(m[1]):null;
}).filter(Boolean).filter(p=>objs.some(o=>o.path===p));
console.log('\nsoft-deleted image generations whose storage file STILL exists:', stillThere.length);
console.log(stillThere.slice(0,10));
