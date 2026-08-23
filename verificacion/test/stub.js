// Servidor de prueba: replica la API con http nativo, sin dependencias.
// Sirve para validar el frontend end-to-end sin npm install ni Postgres ni API key.
// NO es parte de la app: server.js es el real.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, '..', 'public');
const MOUNT = '/verificacion'; // igual que en el servidor real
const { LVLTXT, semaforo, bloqueos, estadoIdentidad, tipoDocumento } = require('../rules'); // reglas reales del servidor
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
      candidate:clean(b.candidate), evaluator:clean(b.evaluator), mode:b.mode==='A'?'A':'B',
      kind:b.kind==='cierre'?'cierre':'sondeo', status:'draft',
      identity:{}, signals:{}, started_at:new Date().toISOString()};
    db.sessions.push(s);
    return json(res,200,{ok:true, id:s.id, report_code:s.report_code, kind:s.kind, started_at:s.started_at});
  }

  mm = p.match(/^\/api\/sessions\/(\d+)$/);
  if(mm && m==='GET'){
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    const ctx = {kind:s.kind, faceVerdict:s.face_verdict, diditStatus:s.didit_status, idNote:s.id_note};
    const {shot, ...sinImagen} = s;
    const v = db.vacancies.find(x=>x.id===s.vacancy_id);
    return json(res,200,{...sinImagen, vacancy_title:v&&v.title, company_name:v&&v.company_name,
      tiene_captura:!!shot, identidad:estadoIdentidad(ctx),
      documento:tipoDocumento(ctx), ratings:db.ratings.filter(r=>r.session_id===s.id)});
  }

  if(p === '/api/sessions' && m==='GET'){
    return json(res,200, db.sessions.slice().reverse().map(s=>{
      const v=db.vacancies.find(x=>x.id===s.vacancy_id);
      return {...s, vacancy_title:v&&v.title, company_name:v&&v.company_name};
    }));
  }

  mm = p.match(/^\/api\/sessions\/(\d+)\/beacon$/);
  if(mm && m==='POST'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(s){
      Object.assign(s, {identity:b.identity||{}, signals:b.signals||{},
        declara:b.declara||{}, recomendacion:b.recomendacion||{}});
      db.ratings = db.ratings.filter(r=>r.session_id!==s.id);
      (b.ratings||[]).forEach((r,i)=>db.ratings.push({id:nid(), session_id:s.id, req_text:r.req_text,
        requirement_id:r.requirement_id, ord:i, level:r.level, verdict:r.level?LVLTXT[r.level]:null, evidence:r.evidence}));
    }
    res.writeHead(204); return res.end();
  }

  mm = p.match(/^\/api\/sessions\/(\d+)$/);
  if(mm && m==='PATCH'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    const ctx = {kind:s.kind, faceVerdict:s.face_verdict, diditStatus:s.didit_status, idNote:s.id_note};
    const sem = semaforo({identity:b.identity||{}, signals:b.signals||{}, ...ctx});
    Object.assign(s, {identity:b.identity||{}, signals:b.signals||{}, semaforo:sem.color,
                      declara:b.declara||{}, recomendacion:b.recomendacion||{}});
    db.ratings = db.ratings.filter(r=>r.session_id!==s.id);
    (b.ratings||[]).forEach((r,i)=>db.ratings.push({id:nid(), session_id:s.id, req_text:r.req_text,
      requirement_id:r.requirement_id, ord:i, level:r.level, verdict:r.level?LVLTXT[r.level]:null, evidence:r.evidence}));
    return json(res,200,{ok:true, id:s.id, semaforo:sem, identidad:estadoIdentidad(ctx)});
  }

  mm = p.match(/^\/api\/sessions\/(\d+)\/issue$/);
  if(mm && m==='POST'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    const ctx = {kind:s.kind, faceVerdict:s.face_verdict, diditStatus:s.didit_status, idNote:s.id_note};
    const sem = semaforo({identity:b.identity||{}, signals:b.signals||{}, ...ctx});
    const ratings = b.ratings||[];
    const { faltas, identidad } = bloqueos({identity:b.identity||{}, signals:b.signals||{}, ratings, ...ctx});
    if(faltas.length) return json(res,409,{error:'No se puede emitir el documento', faltas, semaforo:sem, identidad});
    const hash = crypto.createHash('sha256').update(JSON.stringify({c:b.candidate, r:ratings.map(r=>[r.req_text,r.level])})).digest('hex');
    Object.assign(s, {status:'issued', semaforo:sem.color, integrity_hash:hash, issued_at:new Date().toISOString()});
    return json(res,200,{ok:true, semaforo:sem, identidad, documento:tipoDocumento(ctx),
      id:s.id, report_code:s.report_code, issued_at:s.issued_at, integrity_hash:hash});
  }

  // --- identidad simulada (no llama a Didit de verdad) ---
  mm = p.match(/^\/api\/sessions\/(\d+)\/shot$/);
  if(mm && m==='POST'){
    const b = await body(req);
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    if(!b.dataBase64) return json(res,400,{error:'falta la imagen'});
    s.shot = Buffer.from(b.dataBase64,'base64'); s.shot_mime = b.mime||'image/jpeg';
    return json(res,200,{ok:true, bytes:s.shot.length});
  }

  mm = p.match(/^\/api\/sessions\/(\d+)\/identidad$/);
  if(mm && m==='POST'){
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    if(s.kind!=='cierre') return json(res,400,{error:'La verificación de identidad solo aplica en una sesión de cierre.'});
    s.didit_session_id = 'sess_'+crypto.randomInt(100000,999999);
    s.didit_url = 'https://verify.didit.me/es/session/'+s.didit_session_id;
    s.didit_status = 'Not Started';
    return json(res,200,{ok:true, url:s.didit_url, sessionId:s.didit_session_id, status:s.didit_status});
  }

  mm = p.match(/^\/api\/sessions\/(\d+)\/identidad\/rechazada$/);
  if(mm && m==='POST'){
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    s.id_note = 'rechazada';
    return json(res,200,{ok:true});
  }

  // Simula que el candidato completó el KYC. En el servidor real esto lo dispara el webhook.
  mm = p.match(/^\/api\/sessions\/(\d+)\/identidad\/refrescar$/);
  if(mm && m==='POST'){
    const s = db.sessions.find(x=>x.id===+mm[1]);
    if(!s) return json(res,404,{error:'not found'});
    if(!s.didit_session_id) return json(res,400,{error:'Esta sesión no tiene verificación enviada.'});
    // El caso a simular se controla desde la prueba con __simular
    const sim = db.simular || {status:'Approved', score:96.4, verdict:'coincide'};
    s.didit_status = sim.status;
    if(sim.verdict){ s.face_verdict = sim.verdict; s.face_score = sim.score; }
    s.shot = null;   // el servidor real borra la captura tras el cotejo
    return json(res,200,{ok:true, sesion:s.id, diditStatus:s.didit_status, veredicto:s.face_verdict, score:s.face_score});
  }

  if(p === '/api/__simular' && m==='POST'){ db.simular = await body(req); return json(res,200,{ok:true}); }

  if(p === '/api/didit/estado') return json(res,200,{activo:true, falta:[], webhookFirmado:true, umbrales:{aprueba:70,duda:50}});

  mm = p.match(/^\/v\/(.+)$/);
  if(mm && m==='GET'){
    const s = db.sessions.find(x=>(x.report_code||'').toUpperCase()===decodeURIComponent(mm[1]).toUpperCase() && x.status==='issued');
    res.writeHead(s?200:404,{'Content-Type':'text/html; charset=utf-8'});
    return res.end(s
      ? `<html><body><h1>INFORME AUTÉNTICO</h1><p>${s.report_code}</p><p>Identidad verificada: ${s.face_verdict==='coincide'?'Sí':'No'}</p></body></html>`
      : `<html><body><h1>NO ENCONTRADO</h1></body></html>`);
  }

  // Una ruta /api inexistente responde 404 JSON, no la aplicación.
  if(p.startsWith('/api/')){
    if(p === '/api/didit/webhook' && m === 'GET'){
      return json(res,405,{esto_es:'El destino del webhook de Didit. Solo acepta POST.',
        ver_en_el_navegador_es_normal:true, listo_para_recibir:true, firma_validada:true, falta:[]});
    }
    return json(res,404,{error:'Esta ruta de la API no existe', ruta:MOUNT+p, metodo:m});
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
