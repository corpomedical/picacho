import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
const env={}; for (const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,"");}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const sharp=(await import("sharp")).default;
const OUT="/private/tmp/claude-501/-Users-ahmadkmm-Picacho/ec74451d-601d-4c3c-a4d1-903cc4b9eba6/scratchpad/eval";
const manifest=[];

async function save(id, buf, origin){
  const small = await sharp(buf).rotate().resize(512,512,{fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  writeFileSync(`${OUT}/${id}.jpg`, small);
  manifest.push({ id, origin, kb: small.length/1024|0 });
}

// every character reference photo (up to 3 each, for variety)
const { data: chars } = await db.from("character_profiles").select("name, reference_image_urls, render_style");
for (const c of chars ?? []) {
  const paths = (c.reference_image_urls||[]).slice(0,3);
  for (let i=0;i<paths.length;i++){
    const { data: s } = await db.storage.from("character-references").createSignedUrl(paths[i], 600);
    if(!s?.signedUrl) continue;
    const buf = Buffer.from(await (await fetch(s.signedUrl)).arrayBuffer());
    await save(`char-${c.name.replace(/\W/g,"_")}-${i}`, buf, `character:${c.name} stored=${c.render_style??"null"}`);
  }
}
// every chat attachment
const { data: users } = await db.from("profiles").select("id");
for (const u of users ?? []) {
  const { data: files } = await db.storage.from("chat-attachments").list(u.id, { limit: 40 });
  for (const f of (files??[]).filter(f=>/\.(png|jpe?g|webp)$/i.test(f.name))) {
    const { data: blob } = await db.storage.from("chat-attachments").download(`${u.id}/${f.name}`);
    if(!blob) continue;
    await save(`att-${f.name.slice(0,8)}`, Buffer.from(await blob.arrayBuffer()), `attachment:${f.name.slice(0,40)}`);
  }
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest,null,1));
console.log(`corpus: ${manifest.length} images`);
for (const m of manifest) console.log(`  ${m.id.padEnd(28)} ${String(m.kb).padStart(3)}KB  ${m.origin}`);
