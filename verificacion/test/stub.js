// Servidor de prueba: replica la API con http nativo, sin dependencias.
// Sirve para validar el frontend end-to-end sin npm install ni Postgres ni API key.
// NO es parte de la app: server.js es el real.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, '..', 'public');
const MOUNT = '/verificacion'; // igual que en el servidor real
const { LVLTXT, semaforo, bloqueos } = require('../rules'); // reglas reales del servidor
const db = { companies:[], vacancies:[], requirements:[], sessions:[], ratings:[], seq:1 };
const nid = () => db.seq++;
const clean = s => (s==null?'':String(s)).trim();

// Respuesta fija que imita lo que devuelve Claude, para probar el flujo sin API key.
const FAKE = {
  empresa:{nombre:'IDOM', sector:'Ingeniería y consultoría', contacto:'Marcela Ruiz · Gerente de TI'},
  vacante:{titulo:'Consultor SAP PP', seniority:'senior', modalidad:'híbrido', ciudad:'Bogotá',
    salario_texto:'entre 12 y 15 millones', salario_min:12000000, salario_max:15000000, moneda:'COP',
    contexto:'Entra al equipo de manufactura para sostener el módulo de producción tras el rollout de 2024.',
    urgencia:'Necesitan terna en tres semanas'},
  excluyentes:[
    {requisito:'Implementación de SAP PP en producción (5+ años)', evidencia_cita:'sin haber hecho un rollout de PP no nos sirve, eso es lo mínimo',
     anos_experiencia:5, criterio_cumple:'Debe poder narrar un rollout completo con fechas, alcance y su rol individual.',
     detalles_verificables:[
       {detalle:'¿Qué transacción usa para listas de materiales?', respuesta_esperada:'CS01/CS02/CS03'},
       {detalle:'¿Cuánto suele durar un rollout de PP?', respuesta_esperada:'entre 6 y 12 meses'},
       {detalle:'¿Qué se rompe primero en el go-live?', respuesta_esperada:'MRP y los datos maestros de material'}],
     pregunta_escena:'Llévame al último rollout de PP que hiciste: ¿cuándo fue, en qué empresa, y qué hiciste tú?',
     pregunta_friccion:'¿Qué se te cayó en ese go-live y cómo lo resolviste?',
     pregunta_cruce:'¿Qué diferencia hay entre una lista de materiales y una hoja de ruta?',
     senales_impostor:['Define PP de manual pero no dice qué pasa cuando falla el MRP','Nombra la transacción pero no describe la pantalla']},
    {requisito:'Integración PP con MM y QM', evidencia_cita:'tiene que entender cómo se conversa con compras y con calidad',
     anos_experiencia:null, criterio_cumple:'Debe explicar los puntos de quiebre entre módulos con un caso propio.',
     detalles_verificables:[{detalle:'¿Qué documento conecta PP con MM?', respuesta_esperada:'la reserva de materiales'}],
     pregunta_escena:'Cuéntame una integración PP-MM que hayas configurado tú.',
     pregunta_friccion:'¿Dónde se les rompió la integración?',
     pregunta_cruce:'¿Qué pasa con el lote si QM rechaza la inspección?',
     senales_impostor:['Habla de integración en abstracto sin nombrar documentos']}
  ],
  deseables:[{item:'Inglés conversacional', evidencia_cita:'ojalá se defienda en inglés'}],
  verificable_por_documento:[{item:'Certificación SAP', como_se_valida:'certificado oficial de SAP'}],
  descartes_previos:'Rechazaron dos candidatos que sabían la teoría pero nunca habían estado en un go-live.',
  vacios_del_levantamiento:[{pregunta:'¿Cuántos usuarios tiene el sistema hoy?', por_que:'cambia el tamaño de rollout que cuenta como experiencia válida'}],
  modalidad_sugerida:'B',
  modalidad_por_que:'No hay entregable en el proceso; toca sondear la experiencia contra los excluyentes.',
  resumen:'IDOM busca un consultor SAP PP senior que ya haya vivido un rollout completo. Lo que hay que verificar es experiencia real en producción, no conocimiento teórico.'
};

function body(req){
  return new Promise(res => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{res(JSON.parse(b||'{}'))}catch(e){res({})} }); });
}
function json(res, code, obj){ res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = u.pathname;
  const m = req.method;

  // fuera del mount point no existe nada (igual que en el servidor del Sandler)
  if(p === MOUNT) { res.writeHead(301, {Location: MOUNT + '/'}); return res.end(); }
  if(!p.startsWith(MOUNT + '/')) { res.writeHead(404); return res.end('fuera del mount point'); }
  p = p.slice(MOUNT.length) || '/';

  if(p === '/api/health') return json(res,200,{ok:true, db:true, dbReady:true, llm:true, model:'stub'});

  if(p === '/api/extract-text' && m==='POST'){
    const b = await body(req);
    const buf = Buffer.from(b.dataBase64||'', 'base64');
    const text = buf.toString('utf8').replace(/\r\n/g,'\n').trim();
    return json(res,200,{ok:true, text, chars:text.length});
  }

  if(p === '/api/intake/analyze' && m==='POST'){
    const b = await body(req);
    if(!b.sourceText || b.sourceText.trim().length < 200) return json(res,400,{error:'texto muy corto'});
    return json(res,200,JSON.parse(JSON.stringify(FAKE)));
  }

  if(p === '/api/vacancies' && m==='POST'){
    const b = await body(req);
    const emp=b.empresa||{}, vac=b.vacante||{};
    const reqs=(b.excluyentes||[]).filter(r=>clean(r.requisito));
    if(!clean(emp.nombre)) return json(res,400,{error:'Falta el nombre de la empresa'});
    if(!clean(vac.titulo)) return json(res,400,{error:'Falta el título del cargo'});
    if(!reqs.length) return json(res,400,{error:'Se necesita al menos un requisito excluyente'});
    let c = db.companies.find(x=>x.name.toLowerCase()===clean(emp.nombre).toLowerCase());
    if(!c){ c={id:nid(), name:clean(emp.nombre), sector:clean(emp.sector), contact:clean(emp.contacto)}; db.companies.push(c); }
    const v={id:nid(), company_id:c.id, company_name:c.name, title:clean(vac.titulo), seniority:clean(vac.seniority),
      modality:clean(vac.modalidad), city:clean(vac.ciudad), salary_text:clean(vac.salario_texto),
      context:clean(vac.contexto), suggested_mode:clean(b.modalidad_sugerida), status:'activa',
      created_at:new Date().toISOString()};
    db.vacancies.push(v);
    reqs.forEach((r,i)=>db.requirements.push({id:nid(), vacancy_id:v.id, ord:i, text:clean(r.requisito),
      criterio:clean(r.criterio_cumple), detalles:r.detalles_verificables||[], q_escena:clean(r.pregunta_escena),
      q_friccion:clean(r.pregunta_friccion), q_cruce:clean(r.pregunta_cruce), senales:r.senales_impostor||[]}));
    return json(res,200,{ok:true, id:v.id, company_id:c.id});
  }

  if(p === '/api/vacancies' && m==='GET'){
    return json(res,200, db.vacancies.slice().reverse().map(v=>({...v,
      req_count: db.requirements.filter(q=>q.vacancy_id===v.id).length,
      session_count: db.sessions.filter(s=>s.vacancy_id===v.id).length})));
  }

  let mm = p.match(/^\/api\/vacancies\/(\d+)$/);
  if(mm && m==='GET'){
    const v = db.vacancies.find(x=>x.id===+mm[1]);
    if(!v) return json(res,404,{error:'not found'});
    return json(res,200,{...v, requirements: db.requirements.filter(q=>q.vacancy_id===v.id).sort((a,b)=>a.ord-b.ord)});
  }

  if(p === '/api/sessions' && m==='POST'){
    const b = await body(req);
    if(!clean(b.candidate)) return json(res,400,{error:'Falta el nombre del candidato'});
    const s={id:nid(), vacancy_id:b.vacancy_id||null, report_code:'PKV-2026-'+crypto.randomInt(100000,999999),
      candidate:clean(b.candidate), evaluator:clean(b.evaluator), mode:b.mode==='A'?'A':'B', status:'draft',
      identity:{}, signals:{}, started_at:new Date().toISOString()};
    db.sessions.push(s);
    return json(res,200,{ok:true, id:s.id, report_code:s.report_code, started_at:s.started_at});
  }

  if(p === '/api/sessions' && m==='GET'){
    return json(res,200, db.sessions.slice().reverse().map(s=>{
      const v=db.vacancies.find(x=>x.id===s.vacancy_id);
      return {...s, vacancy_title:v&&v.title, company_name:v&&v.company_name};
    }));
  }

  mm = p.match(/^\/api\/sessions\/(\d+)$/);
  if(mm && m==='PATCH'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    const sem = semaforo({identity:b.identity||{}, signals:b.signals||{}});
    Object.assign(s, {identity:b.identity||{}, signals:b.signals||{}, semaforo:sem.color});
    db.ratings = db.ratings.filter(r=>r.session_id!==s.id);
    (b.ratings||[]).forEach((r,i)=>db.ratings.push({id:nid(), session_id:s.id, req_text:r.req_text, ord:i,
      level:r.level, verdict:r.level?LVLTXT[r.level]:null, evidence:r.evidence}));
    return json(res,200,{ok:true, id:s.id, semaforo:sem});
  }

  mm = p.match(/^\/api\/sessions\/(\d+)\/issue$/);
  if(mm && m==='POST'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    const sem = semaforo({identity:b.identity||{}, signals:b.signals||{}});
    const ratings = b.ratings||[];
    const { faltas } = bloqueos({identity:b.identity||{}, signals:b.signals||{}, ratings});
    if(faltas.length) return json(res,409,{error:'No se puede emitir el acta', faltas, semaforo:sem});
    const hash = crypto.createHash('sha256').update(JSON.stringify({c:b.candidate, r:ratings.map(r=>[r.req_text,r.level])})).digest('hex');
    Object.assign(s, {status:'issued', semaforo:sem.color, integrity_hash:hash, issued_at:new Date().toISOString()});
    return json(res,200,{ok:true, semaforo:sem, id:s.id, report_code:s.report_code, issued_at:s.issued_at, integrity_hash:hash});
  }

  // estáticos
  let f = p === '/' ? '/index.html' : p;
  const full = path.join(PUB, f);
  if(full.startsWith(PUB) && fs.existsSync(full) && fs.statSync(full).isFile()){
    const ct = full.endsWith('.css')?'text/css':full.endsWith('.js')?'text/javascript':'text/html';
    res.writeHead(200,{'Content-Type':ct+'; charset=utf-8'});
    return res.end(fs.readFileSync(full));
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(path.join(PUB,'index.html')));
});

const P = Number(process.env.PORT || 3111);
server.listen(P, '127.0.0.1', () => console.log('stub en http://127.0.0.1:' + P));
