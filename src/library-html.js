import { parse } from 'parse5';
import { decodeHTML } from 'entities';

export const plain = value => String(value ?? '').replace(/\s+/g,' ').trim();
const ignored = new Set(['script','style','nav','header','footer','noscript','svg']);
const attrs = node => Object.fromEntries((node.attrs ?? []).map(a => [a.name,a.value]));
function text(node) {
  if (ignored.has(node.tagName)) return '';
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes ?? []).map(text).join(' ');
}
function all(node, predicate, found=[]) {
  if(predicate(node)) found.push(node);
  for (const child of node.childNodes ?? []) all(child,predicate,found);
  return found;
}
export function htmlPage(html, base) {
  const doc=parse(html);
  const meta=Object.fromEntries(all(doc,n=>n.tagName==='meta').map(n=>{const a=attrs(n);return [a.name??a.property,a.content];}));
  const main=all(doc,n=>n.tagName==='main')[0] ?? all(doc,n=>n.tagName==='article')[0] ?? all(doc,n=>n.tagName==='body')[0] ?? doc;
  const title=plain(text(all(main,n=>n.tagName==='h1')[0] ?? {childNodes:[]})) || meta['og:title'] || plain(text(all(doc,n=>n.tagName==='title')[0] ?? {childNodes:[]}));
  const links=all(main,n=>n.tagName==='a').flatMap(n=>{
    const a=attrs(n); if(!a.href) return [];
    try {
      const url=new URL(a.href,base); if(url.protocol!=='https:' && url.protocol!=='http:')return [];
      let label=plain(text(n));
      if(label.length<8){
        let parent=n.parentNode;
        for(let i=0;i<4 && parent;i++,parent=parent.parentNode){
          const heading=all(parent,p=>/^h[2-4]$/.test(p.tagName))[0];
          if(heading){label=plain(text(heading));break;}
        }
      }
      return [{url:url.href,title:label,context:plain(text(n.parentNode ?? n)).slice(0,1500)}];
    }catch{return [];}
  });
  return {title:plain(title), description:plain(meta.description??meta['og:description']), text:plain(text(main)),links,
    language:attrs(all(doc,n=>n.tagName==='html')[0]??{}).lang, modified:meta['article:modified_time']??meta['ms.date']};
}

// Cloudflare's streaming parser avoids building a DOM for large catalogs.
// Node diagnostics use parse5; the same extraction contract is checked in workerd.
export async function parsePage(html,base) {
  if(typeof HTMLRewriter==='undefined')return htmlPage(html,base);
  const make=()=>({text:'',links:[],title:''});
  const body=make(),main=make(),article=make();
  let inMain=0,inArticle=0,seenMain=false,seenArticle=false,blocked=0,inHead=0;
  let activeLink=null,headingTargets=[],documentTitle=false,title='',language='';const meta={};
  const active=()=>[body,...(inMain?[main]:[]),...(inArticle?[article]:[])];
  const rw=new HTMLRewriter()
    .on('html',{element(e){language=e.getAttribute('lang')??'';}})
    .on('head',{element(e){inHead++;e.onEndTag(()=>inHead--);}})
    .on('meta',{element(e){meta[e.getAttribute('name')??e.getAttribute('property')]=e.getAttribute('content');}})
    .on('title',{element(e){documentTitle=true;e.onEndTag(()=>documentTitle=false);}})
    .on('script,style,nav,header,footer,noscript,svg,template',{element(e){blocked++;e.onEndTag(()=>blocked--);}})
    .on('main',{element(e){if(!seenMain){seenMain=true;inMain++;e.onEndTag(()=>inMain--);}}})
    .on('article',{element(e){if(!seenArticle){seenArticle=true;inArticle++;e.onEndTag(()=>inArticle--);}}})
    .on('h1',{element(e){headingTargets=blocked?[]:active().filter(t=>!t.seenHeading);for(const t of headingTargets)t.seenHeading=true;e.onEndTag(()=>headingTargets=[]);}})
    .on('a',{element(e){
      if(blocked)return;
      try {const href=e.getAttribute('href');if(!href)return;const u=new URL(href,base);if(!['https:','http:'].includes(u.protocol))return;
        const link={url:u.href,title:'',context:''};activeLink=link;
        for(const target of active())if(target.links.length<1200)target.links.push(link);
        e.onEndTag(()=>{link.title=plain(decodeHTML(link.title));activeLink=null;});
      }catch{}
    }})
    .onDocument({text(chunk){
      if(blocked)return;
      const value=chunk.text+(chunk.lastInTextNode?' ':'');
      if(documentTitle)title+=value;
      if(inHead)return;
      for(const target of active()){
        if(target.text.length<100000)target.text+=value;
        if(headingTargets.includes(target) && target.title.length<500)target.title+=value;
      }
      if(activeLink && activeLink.title.length<500)activeLink.title+=value;
    }});
  await rw.transform(new Response(html)).arrayBuffer();
  const selected=seenMain?main:seenArticle?article:body;
  return {title:plain(decodeHTML(selected.title||meta['og:title']||title)),description:plain(decodeHTML(meta.description??meta['og:description']??'')),text:plain(decodeHTML(selected.text)),links:selected.links,language,modified:meta['article:modified_time']??meta['ms.date']};
}
