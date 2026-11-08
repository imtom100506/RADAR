// Eligibility is rule-based. These checks are internal and never sent to Discord.
export const TOPICS = [
  ['Programación', /python|programaci[oó]n|programming|javascript|software|computaci[oó]n|computacional|computer science|algoritm|coding|sql|linux/i],
  ['Inteligencia artificial y datos', /inteligencia artificial|artificial intelligence|machine learning|deep learning|\bIA\b|\bAI\b|datos|data|estad[ií]stic|statistic|neural|neuronal|natural language/i],
  ['Ciencias', /ciencia|science|f[ií]sica|physics|matem[aá]tic|mathemat|[aá]lgebra|geometr|ecuaciones|qu[ií]mica|chemistry|biolog|astronom|\bspace\b|espaci|\bstem\b|telescope|\bmass\b|clim[aá]tic|climate|ecolog|energ[ií]a|energy|molecular|neuro|mam[ií]fer|mammal|salud|health/i],
  ['Tecnología e ingeniería', /tecnolog|technology|ingenier|engineering|electr[oó]nic|electromov|robot|ciber|cyber|redes|network|ciberseguridad|cybersecurity|hidr[oó]geno|hydrogen|transformaci[oó]n digital/i],
  ['Investigación y ciencia abierta', /investigaci[oó]n|research|ciencia abierta|open science|orcid|zotero|mendeley|prisma|revisiones sistem[aá]ticas|systematic review|boolean|vocabulario mesh/i]
];
export function topicsFor(value){return TOPICS.filter(([,re])=>re.test(value)).map(([name])=>name);}
export function rejectionReason(value) {
  const t=String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  if(/inscripciones? cerrad|matriculas? cerrad|cupos? agotad|curso (?:ha )?(?:finalizado|cerrado)|registration closed|enrollment (?:closed|ended)|course (?:has )?ended|archived course/.test(t)) return 'closed';
  if(/(?:exclusiv[oa]s?|solo|unicamente) (?:para |a |de )?(?:integrantes|miembros|alumn[oa]s|estudiantes|funcionarios|egresad[oa]s)|(?:correo|cuenta|credencial) institucional (?:obligatori|requerid)|(?:requiere|necesita|debes usar).{0,45}(?:correo|cuenta) (?:institucional|@)|(?:must|only).{0,30}(?:enrolled|university students|institutional account)|con tu cuenta @|licencia institucional/.test(t)) return 'restricted_audience';
  if(/(?:u\.?s\.?|united states) (?:citizens|residents) only|must be a (?:u\.?s\.?|united states) citizen|solo (?:para )?residentes (?:de|en) (?!chile)|exclusiv[oa].{0,30}(?:espana|mexico|colombia)/.test(t)) return 'geographic_restriction';
  if(/(?:se requiere|requisito obligatorio|debe contar|must have).{0,45}(?:titulo profesional|licenciatura|master.s degree|bachelor.s degree)|exclusivamente.{0,25}profesionales/.test(t)) return 'restricted_prerequisite';
  if(/(?:requiere|necesita|necesitara|necesitarás|must have|required|prerequisites).{0,70}(?:suscripcion|subscription|paid account|licencia de pago)|azure subscription|suscripcion de azure|free trial|prueba gratuita|arancel\s*[:$]|matricula\s*[:$]/.test(t))return 'paid_or_trial';
  return null;
}
export function enrollmentExpiry(text) {
  const values=[];
  const re=/(?:inscripciones?[^.]{0,70}hasta(?: el)?|cierre del curso\s*:|enrollment ends\s*:?)\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/gi;
  for(const m of text.matchAll(re))values.push(Date.UTC(+m[3],+m[2]-1,+m[1]+1));
  return values.length?Math.min(...values):null;
}
export function libraryEligible(item, now=Date.now()) {
  return item.publicAccess===true && item.cost==='Gratuito' && item.topics?.length>0 &&
    Number.isFinite(item.verifiedAt) && item.verifiedAt<=now+300000 && item.verifiedAt>=now-86400000 &&
    (!item.expiresAt || item.expiresAt>now);
}
