import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {LIBRARY_SOURCES} from '../src/library-sources.js';
import {discover,verifyCandidate,allowedURL,readPublic} from '../src/library.js';
import {rejectionReason,enrollmentExpiry,libraryEligible,topicsFor} from '../src/library-policy.js';
import {htmlPage} from '../src/library-html.js';
import {discordPost,sourceAt,chileDay} from '../src/feeds.js';
import {run} from '../src/worker.js';
const source=id=>LIBRARY_SOURCES.find(s=>s.id===id);
const now=Date.parse('2026-11-08T15:27:00Z'); // Kaggle slot

test('Eligibility rejects expired, stale, paid and unrelated metadata',()=>{
  const good={publicAccess:true,cost:'Gratuito',topics:['Programación'],verifiedAt:now};
  assert.ok(libraryEligible(good,now));
  for(const change of [{publicAccess:false},{cost:'Pagado'},{topics:[]},{verifiedAt:now-86400001},{expiresAt:now-1}])assert.equal(libraryEligible({...good,...change},now),false);
});
test('Internal eligibility excludes audience, location, trial and expired enrollments',()=>{
  for(const text of ['Curso exclusivo para estudiantes de esta universidad','Se requiere correo institucional','Con tu cuenta @uandes.cl','U.S. citizens only','Solo residentes en España','Se requiere título profesional','Prerequisites: Azure subscription','Free trial','Inscripciones cerradas'])assert.ok(rejectionReason(text),text);
  assert.equal(rejectionReason('Si no eres miembro de la universidad, crea una cuenta pública. Certificado opcional de pago.'),null);
  assert.equal(enrollmentExpiry('Período de inscripciones: desde el 13/10/2025 hasta el 19/12/2026 Cierre del curso: 23/01/2027'),Date.UTC(2026,11,20));
  assert.deepEqual(topicsFor('Democracia y participación ciudadana'),[]);
});
test('HTML parsing handles unquoted links and excludes navigation text',()=>{
  const p=htmlPage('<nav>Solo estudiantes</nav><main><h1>Python</h1><a href=/course/python>Curso</a><script>private</script></main>','https://example.org');
  assert.equal(p.title,'Python');assert.equal(p.links[0].url,'https://example.org/course/python');assert.ok(!p.text.includes('Solo estudiantes'));assert.ok(!p.text.includes('private'));
});
test('Fetch rejects unsafe hosts and cross-host redirects',async t=>{
  const s=source('kaggle-learn');
  for(const url of ['http://www.kaggle.com/learn','https://www.kaggle.com.evil.org/','https://user:pass@www.kaggle.com/'])assert.equal(allowedURL(url,s),false);
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:302,headers:{location:'https://evil.org/'}}));
  await assert.rejects(readPublic('https://www.kaggle.com/learn/python',s),/redirect/);
});
test('Cisco deduplicates all language variants into the Spanish course URL',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<urlset><url><loc>https://www.netacad.com/courses/python-essentials-1?courseLang=en-US</loc></url><url><loc>https://www.netacad.com/courses/python-essentials-1?courseLang=fr-FR</loc></url></urlset>'));
  const result=await discover(source('cisco-netacad'));assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://www.netacad.com/courses/python-essentials-1?courseLang=es-XL');
});
test('UAbierta verifies the actual enrollment page and rejects expired access',async t=>{
  let closed=false;
  t.mock.method(globalThis,'fetch',async url=>new Response(String(url).includes('open.uchile.cl')?`<main>Precio Gratis. Curso 100% online y asincrónico. Inscripciones hasta el ${closed?'01/01/2020':'19/12/2026'}. Certificado opcional de pago.</main>`:'<main><h1>Inteligencia artificial</h1><a href="https://open.uchile.cl/courses/course-v1:test/about">Inscripción</a></main>'));
  const hint={title:'Inteligencia artificial',url:'https://www.uabierta.uchile.cl/course/ia/'};
  assert.ok((await verifyCandidate(hint,source('uchile-uabierta'),now)).item);closed=true;
  assert.equal((await verifyCandidate(hint,source('uchile-uabierta'),now)).reason,'expired');
});
test('Protected datasets and login pages disguised as PDFs are rejected',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:{latestVersion:{versionState:'RELEASED',license:{name:'CC BY'},files:[{restricted:true}]}}}));
  assert.equal((await verifyCandidate({title:'Molecular data',url:'https://repositoriodedatos.unab.cl/dataset.xhtml?persistentId=doi:abc'},source('unab-abierta'),now)).reason,'insufficient_access_evidence');
  await assert.rejects(readPublic('https://biologia.uc.cl/guide.pdf',source('uc-abierta'),{pdf:true}),/PDF/);
});
test('Microsoft modules with unverified exercise costs are omitted',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<main><h1>Azure machine learning</h1>Requisitos previos. Unidades. Ejercicio: crear recursos de Azure.</main>'));
  assert.equal((await verifyCandidate({url:'https://learn.microsoft.com/es-es/training/modules/test/'},source('microsoft-learn'),now)).reason,'unverified_exercise_cost');
});
test('Public messages include resource facts and omit internal eligibility evidence',()=>{
  const post=discordPost({title:'Python',url:'https://www.kaggle.com/learn/python',type:'Curso',topics:['Programación'],language:'Inglés',duration:'5 horas',cost:'Gratuito',reason:'geographic_restriction',publicAccess:true},source('kaggle-learn'));
  assert.match(post.message.content,/Duración: 5 horas/);assert.doesNotMatch(post.message.content,/geographic|correo|estudiantes chilen/i);assert.deepEqual(post.message.allowed_mentions,{parse:[]});
});

function pipeline(t){
  const db=new DatabaseSync(':memory:');for(const path of ['0001.sql','0002_library.sql'])db.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'));
  t.after(()=>db.close());
  const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a);},async first(){return db.prepare(sql).get(...args);},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}});
  const env={ENABLED:'true',NEWS_DAILY_LIMIT:'12',LIBRARY_DAILY_LIMIT:'8',DISCORD_BOT_TOKEN:'test',NEWS_CHANNEL_ID:'123456789012345678',LIBRARY_CHANNEL_ID:'234567890123456789',DB:{prepare:wrap,async batch(s){return Promise.all(s.map(x=>x.run()));}}};
  let sent=0,changed=false;
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('discord.com')){sent++;return Response.json({id:'999999999999999999'});}
    if(String(url).includes('GetTracks'))return Response.json({tracks:[{visible:true,lessons:[{}],trackSlug:changed?'sql':'python',name:changed?'SQL':'Python',description:'Programming course',estimatedTimeHours:5}]});
    return new Response(`<head><title>Learn Python Tutorials</title></head>`);
  });
  assert.equal(sourceAt(now).id,'kaggle-learn');
  return {db,env,sent:()=>sent,change:()=>{changed=true;}};
}
test('Catalog changes discover new resources, publish once and retain source history',async t=>{
  const f=pipeline(t);assert.equal((await run(f.env,now)).status,'published');assert.equal(f.sent(),1);
  assert.equal((await run(f.env,now)).status,'no_new_items');
  f.change();assert.equal((await run(f.env,now+5*3600000)).status,'published');assert.equal(f.sent(),2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM library_candidates').get().n,2);
});
test('Catalog refresh continues when the publication cap is reached',async t=>{
  const f=pipeline(t);const insert=f.db.prepare("INSERT INTO entries(url,source,status,local_day) VALUES(?,'freecodecamp-es','sent',?)");
  for(let i=0;i<8;i++)insert.run('https://example.org/'+i,chileDay(now));
  assert.equal((await run(f.env,now)).status,'daily_limit');assert.equal(f.sent(),0);
  assert.equal(f.db.prepare('SELECT discovered FROM library_checks').get().discovered,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM library_candidates').get().n,1);
});
test('Initialization-only checks catalogs without publishing',async t=>{
  const f=pipeline(t);f.env.INITIALIZE_ONLY='true';assert.equal((await run(f.env,now)).status,'checked_without_publishing');assert.equal(f.sent(),0);
});
