import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ahmadkmm/Picacho/.env.local','utf8').split('\n').filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data, error } = await s.from('generations').select('*').limit(1);
if (error) { console.log('ERR', error.message); process.exit(1); }
console.log('COLUMNS:', Object.keys(data[0]||{}).join(', '));
const { count } = await s.from('generations').select('id',{count:'exact',head:true});
console.log('total generations rows:', count);
