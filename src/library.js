import { XMLParser } from 'fast-xml-parser';
import { htmlPage, parsePage, plain } from './library-html.js';
import { topicsFor, rejectionReason, enrollmentExpiry, libraryEligible } from './library-policy.js';

const arr = value => Array.isArray(value) ? value : value ? [value] : [];
const educational = /curso|course|learn|modulo|module|guia|guide|tutorial|libro|book|actividad|activit|stem|lesson|lecture|material|dataset|datos|notebook|laboratorio/i;
const free = /gratuit|\bgratis\b|sin costo|libre acceso|acceso (?:libre|abierto)|open access|free (?:course|online|access|learning)|for free/i;
export function allowedURL(url, source) {
  try { const u=new URL(url); return u.protocol==='https:' && !u.username && !u.password && source.hosts.includes(u.hostname); } catch { return false; }
}
export async function readPublic(url, source, options={}) {
  if(!allowedURL(url,source))throw new Error('Unapproved destination');
  let response;
  for(let n=0;n<4;n++) {
    response=await fetch(url,{method:options.method??'GET',body:options.body,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'RADAR/0.2 educational resource reader',Accept:'application/json,text/html,application/xml,application/pdf;q=0.8',...(options.body?{'Content-Type':'application/json'}:{}),...(options.pdf?{Range:'bytes=0-1023'}:{})}});
    if(response.status>=300 && response.status<400) {
      const target=new URL(response.headers.get('location'),url).href;
      await response.body?.cancel();
      if(!allowedURL(target,source))throw new Error('Unapproved redirect');
      url=target; continue;
    }
    break;
  }
  if(!response.ok){await response.body?.cancel();throw new Error(`Public resource HTTP ${response.status}`);}
  const reader=response.body.getReader(); const chunks=[];let length=0;
  const limit=options.limit??2*1024*1024;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;chunks.push(value);
    if(options.pdf && length>=5){await reader.cancel();break;}
    if(length>limit){await reader.cancel();throw new Error('Public response too large');}}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const text=new TextDecoder().decode(bytes);
  if(options.pdf && !text.startsWith('%PDF-'))throw new Error('Not an accessible PDF');
  return {text,url};
}
async function pageAt(url,source){const r=await readPublic(url,source);return {...await parsePage(r.text,r.url),url:r.url};}
const metaValues=(item,key)=>arr(item.metadata?.[key]).map(x=>x.value).join(' ');
const canonical=url=>{const u=new URL(url);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|wt\.|ocwcl|fbclid)/i.test(k))u.searchParams.delete(k);return u.href;};

export async function discover(source) {
  let candidates=[...(source.seeds??[])], successes=0;const errors=[];
  for(const catalog of source.catalogs){try{
    const {text}=await readPublic(catalog,source,{...(source.adapter==='kaggle'?{method:'POST',body:'{}'}:{}),limit:source.adapter==='microsoft'?10*1024*1024:2*1024*1024});
    let items=[];
    if(source.adapter==='kaggle')items=arr(JSON.parse(text).tracks).filter(t=>t.visible && t.lessons?.length).map(t=>({url:`https://www.kaggle.com/learn/${t.trackSlug}`,title:t.name,description:t.description,duration:t.estimatedTimeHours?`${t.estimatedTimeHours} horas`:null,type:'Curso'}));
    else if(source.adapter==='microsoft')items=arr(JSON.parse(text).modules).sort((a,b)=>Date.parse(b.last_modified)-Date.parse(a.last_modified)).slice(0,60).map(t=>({url:t.url,title:t.title,description:t.summary,duration:t.duration_in_minutes?`${t.duration_in_minutes} minutos`:null,level:t.levels?.join(', '),type:'Módulo'}));
    else if(source.adapter==='nasa')items=arr(JSON.parse(text)).map(t=>({url:t.link,title:htmlPage(t.title.rendered,catalog).text,description:htmlPage(t.content.rendered,catalog).text.slice(0,3000),type:'Recurso STEM'}));
    else if(source.adapter==='dspace')items=arr(JSON.parse(text)._embedded?.searchResult?._embedded?.objects).map(t=>t._embedded?.indexableObject).filter(t=>t && /guide|guia|book|libro|manual/i.test(t.name+' '+metaValues(t,'dc.type'))).map(t=>({url:`https://repositorio.udd.cl/items/${t.uuid}`,title:t.name,description:metaValues(t,'dc.description.abstract').slice(0,2000),type:'Guía / libro'}));
    else if(source.adapter==='dataverse')items=arr(JSON.parse(text).data?.items).map(t=>({url:`https://repositoriodedatos.unab.cl/dataset.xhtml?persistentId=${encodeURIComponent(t.global_id)}`,title:t.name,description:plain(t.description).slice(0,2000),type:'Datos abiertos'}));
    else if(source.adapter==='sitemap' || source.adapter==='video-feed'){
      if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('DTD not supported');
      const doc=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true}).parse(text);
      items=source.adapter==='sitemap'?arr(doc.urlset?.url).map(t=>({url:t.loc,title:t.loc.split('/').pop().replaceAll('-',' '),type:'Curso'})):
        arr(doc.feed?.entry).map(t=>({url:arr(t.link).find(l=>l['@_rel']==='alternate')?.['@_href'],title:t.title,description:t['media:group']?.['media:description'],type:'Clase grabada'}));
    } else {
      const page=await parsePage(text,catalog);
      items=page.links.filter(t=>source.paths.some(p=>new RegExp(p,'i').test(new URL(t.url).pathname))).map(t=>({...t,catalogFree:source.policy==='usm' && /cursos abiertos y gratuitos/i.test(page.text)}));
      if(source.externalCatalogLinks)items=items.filter(t=>new URL(t.url).hostname!=='opencenia.github.io');
    }
    candidates.push(...items);successes++;
  }catch(e){errors.push(e.message);}}
  if(!successes)throw new Error(errors.join('; ')||'No catalog available');
  const unique=new Map();
  for(const item of candidates){
    if(!item.url || !allowedURL(item.url,source))continue;
    item.url=canonical(item.url);
    if(source.adapter==='sitemap'){
      if(!source.paths.some(p=>new RegExp(p).test(new URL(item.url).pathname)))continue;
      const u=new URL(item.url);u.search='';u.searchParams.set('courseLang','es-XL');item.url=u.href;
    }
    if(!topicsFor(`${item.title} ${new URL(item.url).pathname.replaceAll('-',' ')} ${source.adapter==='video-feed'?'':item.description??''}`).length)continue;
    unique.set(item.url,{...item,description:plain(item.description).slice(0,3000)});
  }
  return {items:[...unique.values()].slice(0,100),errors};
}

export async function verifyCandidate(hint,source,now=Date.now()) {
  const reject=reason=>({reason});
  let title=hint.title,description=hint.description??'',text='',type=hint.type??'Recurso educativo',expiresAt=null,certificate=null,duration=hint.duration;
  let publicAccess=false;
  if(source.adapter==='dataverse'){
    const id=new URL(hint.url).searchParams.get('persistentId');
    const j=JSON.parse((await readPublic(`https://repositoriodedatos.unab.cl/api/datasets/:persistentId/?persistentId=${encodeURIComponent(id)}`,source)).text);
    const v=j.data?.latestVersion;
    publicAccess=v?.versionState==='RELEASED' && v.files?.length>0 && v.files.every(f=>f.restricted===false) && !!v.license;
    text=description;type='Datos abiertos';
  } else if(source.adapter==='dspace'){
    const id=new URL(hint.url).pathname.split('/').pop();
    const base=`https://repositorio.udd.cl/server/api/core/items/${id}`;
    const item=JSON.parse((await readPublic(base,source)).text);
    if(item.withdrawn || !item.inArchive || !free.test(metaValues(item,'dcterms.accessRights')))return reject('repository_not_open');
    const bundles=JSON.parse((await readPublic(base+'/bundles',source)).text)._embedded?.bundles??[];
    const original=bundles.find(b=>b.name==='ORIGINAL');
    if(!original)return reject('missing_file');
    const files=JSON.parse((await readPublic(`https://repositorio.udd.cl/server/api/core/bundles/${original.uuid}/bitstreams`,source)).text)._embedded?.bitstreams??[];
    const pdf=files.find(f=>/\.pdf$/i.test(f.name));if(!pdf)return reject('missing_pdf');
    await readPublic(`https://repositorio.udd.cl/server/api/core/bitstreams/${pdf.uuid}/content`,source,{pdf:true});
    title=item.name;text=metaValues(item,'dc.description.abstract');publicAccess=true;
  } else if(/\.pdf(?:\?|$)/i.test(hint.url)){
    if(!(hint.directOpenDocument || source.policy==='open-guide'))return reject('unverified_document');
    await readPublic(hint.url,source,{pdf:true});text=hint.context??'';publicAccess=true;type=hint.type??'Guía';
  } else if(source.adapter==='video-feed'){
    const j=JSON.parse((await readPublic(`https://www.youtube.com/oembed?url=${encodeURIComponent(hint.url)}&format=json`,source)).text);
    title=j.title;text=description;publicAccess=!!j.title;type=/entrevista/i.test(title)?'Video educativo':'Clase grabada';
  } else {
    let page=await pageAt(hint.url,source);
    title=page.title||title;description=page.description||description;text=page.text;
    if(source.policy==='uabierta'){
      const enrollment=page.links.find(l=>l.url.startsWith('https://open.uchile.cl/courses/') && l.url.endsWith('/about'));
      if(!enrollment)return reject('missing_enrollment');
      page=await pageAt(enrollment.url,source);text=page.text;description=page.description||description;
      publicAccess=free.test(text) && /inscri|inscrí|enroll|registr/i.test(text) && /online|asincron|asíncron/i.test(text);
      expiresAt=enrollmentExpiry(text);if(!expiresAt)return reject('unverified_enrollment_dates');
      if(/certificad/i.test(text))certificate='Certificación opcional; consulta su costo en la fuente.';
      type='Curso';
    }else if(source.policy==='usm'){
      publicAccess=(free.test(text)||hint.catalogFree===true) && /100%\s*online|asincron|asíncron/i.test(text) && /(?:pre)?requisitos\s*:?\s*ninguno/i.test(text);
      const cohorts=[...text.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g)].map(m=>Date.UTC(+m[3],+m[2]-1,+m[1]+1));
      expiresAt=cohorts.length?Math.max(...cohorts):null;
      if(!expiresAt)return reject('unverified_enrollment_dates');
      publicAccess &&=page.links.some(l=>l.url.startsWith('https://usmx.cl/register?'));
      type='Curso';
    }else if(source.policy==='cisco')publicAccess=free.test(description+' '+text) && /online|en linea|en línea/i.test(description+' '+text);
    else if(source.policy==='ocw'){publicAccess=/download|course material|lecture|syllabus/i.test(text);type='Material de curso';}
    else if(source.policy==='learn'){
      if(/ejercicio|exercise|laboratorio|hands.on lab/i.test(text))return reject('unverified_exercise_cost');
      publicAccess=/prerequisites|requisitos previos|unidades|units/i.test(text);type='Módulo';certificate='Este recurso no equivale a una certificación profesional.';
    }
    else if(source.policy==='stem'){
      if(/internship|opportunities|scholarship|competition/i.test(title) || (/challenge/i.test(title) && !/engineering design challenges/i.test(title)) || /registration deadline|submission deadline/i.test(text))return reject('opportunity_not_resource');
      publicAccess=educational.test(title+' '+text) && text.length>200;
    }else if(source.policy==='open-code'){publicAccess=/readme|files|notebook|dataset|github|repository/i.test(text);type=/huggingface/.test(hint.url)?'Datos abiertos':'Material de curso / código';}
    else if(source.policy==='open-guide'){
      // A public tutorial must remain usable without a paid institutional product.
      if(/scopus|web of science|turnitin|copilot|endnote/i.test(title))return reject('restricted_tool');
      publicAccess=/guia|guía|tutorial/i.test(title+' '+hint.url) && text.length>300;type='Guía';
    }else{
      publicAccess=free.test(text) && educational.test(title) && page.links.some(l=>/\.pdf(?:\?|$)|\/courses?\//i.test(l.url) && allowedURL(l.url,source));
      if(publicAccess){const resource=page.links.find(l=>/\.pdf(?:\?|$)/i.test(l.url) && allowedURL(l.url,source));if(resource)await readPublic(resource.url,source,{pdf:true});else publicAccess=false;}
    }
    if(source.adapter==='kaggle')publicAccess=/learn|tutorial|course/i.test(title) && !!hint.duration;
  }
  const reason=rejectionReason(`${title} ${description} ${text}`);if(reason)return reject(reason);
  const topics=topicsFor(`${title} ${source.adapter==='video-feed'?'':description}`);
  duration??=text.match(/duraci[oó]n(?:\s+de)?\s*:?\s*(\d+\s*(?:horas?|hrs?|minutos?|semanas?|mes(?:es)?))/i)?.[1];
  const levels={beginner:'Inicial',intermediate:'Intermedio',advanced:'Avanzado'};
  const item={title:plain(title).slice(0,200),url:hint.url,description:plain(description).slice(0,500),type,topics,language:source.language,duration,level:levels[hint.level]??hint.level,cost:'Gratuito',certificate,publicAccess,verifiedAt:now,expiresAt,date:now};
  return libraryEligible(item,now)?{item}:reject(expiresAt && expiresAt<=now?'expired':'insufficient_access_evidence');
}

export async function refreshLibrary(db,source,now) {
  let discovered=0,accepted=0,rejected=0;const items=[];let detail='';
  try{
    const found=await discover(source);discovered=found.items.length;detail=found.errors.join('; ');
    const writes=[];
    for(let offset=0;offset<found.items.length;offset+=20){
      const group=found.items.slice(offset,offset+20);
      writes.push(db.prepare(`INSERT INTO library_candidates(source,url,hint,discovered_at) VALUES ${group.map(()=>'(?,?,?,?)').join(',')} ON CONFLICT(source,url) DO UPDATE SET hint=excluded.hint`).bind(...group.flatMap(h=>[source.id,h.url,JSON.stringify(h),now])));
    }
    if(writes.length)await db.batch(writes);
    const pending=await db.prepare("SELECT c.url,c.hint FROM library_candidates c WHERE c.source=? AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.url=c.url) AND (c.checked_at IS NULL OR c.checked_at<=?) ORDER BY c.checked_at IS NOT NULL,c.checked_at,c.discovered_at DESC,c.url LIMIT 2").bind(source.id,now-5*3600000).all();
    for(const row of pending.results){
      let result;try{result=await verifyCandidate(JSON.parse(row.hint),source,now);}catch(e){result={reason:e.message};}
      if(result.item){accepted++;items.push(result.item);}else rejected++;
      await db.prepare('UPDATE library_candidates SET checked_at=?,status=?,metadata=?,reason=? WHERE source=? AND url=?').bind(now,result.item?'eligible':'rejected',result.item?JSON.stringify(result.item):null,result.reason??null,source.id,row.url).run();
    }
  }catch(e){detail=e.message;
    await db.prepare("INSERT OR REPLACE INTO library_checks(source,checked_at,status,discovered,accepted,rejected,detail) VALUES(?,?,'error',?,?,?,?)").bind(source.id,now,discovered,accepted,rejected,detail.slice(0,500)).run();throw e;
  }
  await db.prepare("INSERT OR REPLACE INTO library_checks(source,checked_at,status,discovered,accepted,rejected,detail) VALUES(?,?,'ok',?,?,?,?)").bind(source.id,now,discovered,accepted,rejected,detail.slice(0,500)).run();
  return items;
}
