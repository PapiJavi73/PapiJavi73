// ════════════════════════════════════════════════════
// CONTRAPODER · LM Las Rozas · app.js
// Supabase backend — flujo: Escanear→Referencias→Bultos→Maestra
// Calendario independiente (fotos de cargas e incidencias)
// ════════════════════════════════════════════════════

const SUPABASE_URL      = 'https://hjyregaizhllxqjcbvjq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqeXJlZ2FpemhsbHhxamNidmpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTU3MjksImV4cCI6MjA5NzE3MTcyOX0.CBVQnMivVWIWSWttwp3-wujwIvvcq8DUKwp6Guxh4dc';
const BUCKET = 'contrapoder';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ════════════════════════════════════════════════════
// UTILS GENERALES
// ════════════════════════════════════════════════════
function today() { return new Date().toISOString().slice(0,10); }
function fmtDate(s) {
  if (!s) return '';
  // Input: YYYY-MM-DD → Output: DD/MM/YYYY
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function manana() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function showToast(msg, ms=2600) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), ms);
}

function setDate() {
  const d=new Date();
  const dias=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  document.getElementById('headerDate').innerHTML=dias[d.getDay()]+' '+d.getDate()+'<br>'+meses[d.getMonth()];
}
setDate();

function compressImage(dataUrl, maxW, quality, cb) {
  const img=new Image();
  img.onload=()=>{
    let w=img.width, h=img.height;
    if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    cb(c.toDataURL('image/jpeg',quality));
  };
  img.src=dataUrl;
}

// ── Stat card helper ──
function statCard(num, label, color) {
  return `<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;text-align:center;box-shadow:var(--shadow-sm)">
    <div style="font-size:24px;font-weight:700;color:${color||'var(--green)'}">${num}</div>
    <div style="font-size:11px;color:var(--slate-lt);margin-top:2px">${label}</div>
  </div>`;
}

// ════════════════════════════════════════════════════
// NAV
// ════════════════════════════════════════════════════
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('view-'+tab.dataset.view).classList.add('active');
    if(tab.dataset.view==='scan')        scInit();
    if(tab.dataset.view==='referencias') refCargar();
    if(tab.dataset.view==='bultos')      bulCargar();
    if(tab.dataset.view==='maestra')     mstInit();
    if(tab.dataset.view==='calendario')  renderCal();
  });
});

// ════════════════════════════════════════════════════
// ══ MÓDULO 1: ESCANEAR ══
// Extrae pedidos de Excel/foto y los guarda en Supabase
// tabla: pedidos_control  estado: 'pendiente_refs'
// ════════════════════════════════════════════════════
const SC_COL = {EAN:0, DESIG:1, QTY:3, H:7, UBIC:11};
const SC_UBIC_SKIP = ['G','PLG','PROV','PROVEEDOR'];
let scPedidos=[], scDetalleIdx=null;

function scInit() {
  document.getElementById('sc-entrada-fecha').textContent = 'Sesión del día '+fmtDate(today());
  scShow('sc-entrada');
  scCargarHoy();
}

function scShow(id) {
  ['sc-entrada','sc-procesando','sc-lista','sc-detalle-pedido']
    .forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = s === id ? 'block' : 'none';
    });
}

// ── Historial de subidas del día (guardado local) ──
const SC_HISTORIAL_KEY = 'sc_historial_v1';

function scGetHistorial() {
  try { return JSON.parse(localStorage.getItem(SC_HISTORIAL_KEY) || '[]'); } catch(e) { return []; }
}
function scSaveHistorial(h) {
  localStorage.setItem(SC_HISTORIAL_KEY, JSON.stringify(h));
}

function scCargarHoy() {
  const hoy = today();
  // Limpiar historial de días anteriores
  const h = scGetHistorial().filter(e => e.fecha === hoy);
  scSaveHistorial(h);
  scRenderHistorial(h);
}

function scRenderHistorial(h) {  const wrap  = document.getElementById('sc-historial-wrap');  const lista = document.getElementById('sc-historial-lista');  if (!h || !h.length) { wrap.style.display = 'none'; return; }  wrap.style.display = 'block';  lista.innerHTML = h.map((entry, i) => {    const detalle = [];    if (entry.insertados   != null) detalle.push(entry.insertados   + ' nuevo'       + (entry.insertados!==1?'s':''));    if (entry.actualizados != null) detalle.push(entry.actualizados + ' actualizado' + (entry.actualizados!==1?'s':''));    if (entry.sinCambios   != null && entry.sinCambios > 0) detalle.push(entry.sinCambios + ' sin cambios');    const detalleStr = detalle.length ? ' (' + detalle.join(', ') + ')' : '';    const esUltima   = i === 0;    return `    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">      <div style="flex:1;min-width:0">        <div style="font-size:13px;font-weight:600">          ${entry.numPedidos} pedido${entry.numPedidos!==1?'s':''}${detalleStr}        </div>        <div style="font-size:11px;color:var(--slate-lt);margin-top:2px">          ${entry.hora} · ${entry.pedidos.slice(0,5).join(', ')}${entry.pedidos.length>5?' y '+(entry.pedidos.length-5)+' más':''}        </div>      </div>      ${esUltima        ? `<button onclick="scConfirmarBorrarSubida(${i})"            style="background:var(--red-lt);color:var(--red);border:none;border-radius:var(--radius-sm);padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;font-family:var(--font)">            Borrar última          </button>`        : '<span style="font-size:10px;color:var(--slate-lt);padding:6px 0;flex-shrink:0">Anterior</span>'      }    </div>`;  }).join('');}
function scConfirmarBorrarSubida(idx) {
  if (!confirm('¿Borrar esta subida? Se eliminarán los pedidos de Supabase y no podrán recuperarse.')) return;
  scBorrarSubida(idx);
}

async function scBorrarSubida(idx) {
  const h = scGetHistorial();
  const entry = h[idx];
  if (!entry) return;
  try {
    if (entry.ids && entry.ids.length) {
      // Borrar por IDs de Supabase (lo más preciso)
      const { error } = await sb.from('pedidos_control')
        .delete()
        .in('id', entry.ids);
      if (error) throw error;
    } else {
      // Fallback: borrar por num_pedido sin filtrar fecha
      // (para entradas antiguas del historial que no guardaron IDs)
      const { error } = await sb.from('pedidos_control')
        .delete()
        .in('num_pedido', entry.pedidos)
        .in('estado', ['pendiente_refs']); // solo borrar si aún no se ha procesado
      if (error) throw error;
    }
    h.splice(idx, 1);
    scSaveHistorial(h);
    scRenderHistorial(h);
    showToast('✓ Subida eliminada · ' + entry.numPedidos + ' pedido' + (entry.numPedidos!==1?'s':'') + ' borrado' + (entry.numPedidos!==1?'s':''));
  } catch(e) { showToast('⚠ Error al borrar: ' + e.message); }
}

// ── LISTA PEDIDOS — con swipe para quitar ──
let scSwipeState = {}; // idx → swipeOpen

function scRenderLista() {
  const total = scPedidos.length;
  document.getElementById('sc-lista-count').textContent =
    total + ' pedido' + (total!==1?'s':'') + ' detectado' + (total!==1?'s':'');

  document.getElementById('sc-lista-items').innerHTML = scPedidos.map((p, i) => {
    const ctrl = p.refs.filter(r => !r.excluida).length;
    const exc  = p.refs.filter(r => r.excluida).length;
    return `
    <div class="sc-swipe-wrap" id="sw-${i}">
      <div class="sc-swipe-content" id="sw-content-${i}"
        ontouchstart="swipeStart(event,${i})"
        ontouchend="swipeEnd(event,${i})">
        <div class="scan-pedido-card" style="margin-bottom:0;border-radius:var(--radius-sm)"
          onclick="scAbrirDetalle(${i})">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">Pedido ${p.numPedido}</div>
            <div style="font-size:12px;color:var(--slate-lt);margin-top:2px">
              ${ctrl} ref${ctrl!==1?'s':''} a controlar
              ${exc ? ' · <span style="color:var(--amber)">'+exc+' excluida'+(exc!==1?'s':'')+'</span>' : ''}
              ${p.agencia ? ' · <b style="color:var(--green)">'+p.agencia+'</b>' : ''}
            </div>
            ${p.fechaEntrega ? '<div style="font-size:11px;color:var(--slate-lt);margin-top:2px">📅 Entrega: '+p.fechaEntrega+'</div>' : ''}
          </div>
          <span style="color:var(--slate-lt);font-size:18px">›</span>
        </div>
      </div>
      <div class="sc-swipe-action" id="sw-action-${i}">
        <button onclick="scQuitarPedido(${i})"
          style="background:var(--red);color:#fff;border:none;height:100%;padding:0 18px;font-size:12px;font-weight:600;cursor:pointer;border-radius:0 var(--radius-sm) var(--radius-sm) 0">
          Quitar ✕
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Swipe logic ──
let swipeStartX = 0;
function swipeStart(e, i) { swipeStartX = e.touches[0].clientX; }
function swipeEnd(e, i) {
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const content = document.getElementById('sw-content-' + i);
  const action  = document.getElementById('sw-action-'  + i);
  if (!content || !action) return;
  if (dx < -50) { // deslizó izquierda
    content.style.transform = 'translateX(-72px)';
    action.style.opacity = '1'; action.style.pointerEvents = 'auto';
    scSwipeState[i] = true;
  } else if (dx > 20 && scSwipeState[i]) { // deslizó derecha → cerrar
    content.style.transform = 'translateX(0)';
    action.style.opacity = '0'; action.style.pointerEvents = 'none';
    scSwipeState[i] = false;
  }
}

function scQuitarPedido(idx) {
  if (!confirm('¿Quitar el pedido ' + scPedidos[idx].numPedido + ' del volcado?')) return;
  scPedidos.splice(idx, 1);
  scSwipeState = {};
  scRenderLista();
  if (!scPedidos.length) { scShow('sc-entrada'); scCargarHoy(); }
}

function scNueva() {
  scPedidos = [];
  document.getElementById('sc-excel-input').value = '';
  document.getElementById('sc-foto-input').value  = '';
  scSwipeState = {};
  scShow('sc-entrada');
  scCargarHoy();
}

// ── DETALLE (info opcional) ──
function scAbrirDetalle(idx) {
  scDetalleIdx = idx;
  const p = scPedidos[idx];
  document.getElementById('sc-det-titulo').textContent = 'Pedido ' + p.numPedido;
  document.getElementById('sc-det-agencia').value = p.agencia || '';
  document.getElementById('sc-det-obs').value = p.obs || '';

  const refs     = p.refs.filter(r => !r.excluida);
  const excluidas = p.refs.filter(r => r.excluida);

  document.getElementById('sc-det-refs').innerHTML = `
    <div style="font-size:12px;color:var(--slate-lt);margin-bottom:10px">
      📅 Fecha de entrega: <b style="color:var(--slate)">${p.fechaEntrega || 'No detectada'}</b>
      ${excluidas.length ? ' · <span style="color:var(--amber)">'+excluidas.length+' excluida'+(excluidas.length!==1?'s':'')+' (G*/PLG/MAT)</span>' : ''}
    </div>
    ${refs.map(r => `
    <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:600;color:var(--slate-lt)">${r.ean || 'Sin EAN'}${r.refLM?' · '+r.refLM:''}</div>
        <div style="font-size:13px;font-weight:500;margin:2px 0;line-height:1.3">${r.desig}</div>
        <div style="font-size:11px;color:var(--slate-lt);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          <span>×${r.qty}</span>
          ${r.precio ? '<span>'+Number(r.precio).toFixed(2)+'€</span>' : ''}
          ${r.tipo ? '<span style="background:var(--bg);padding:1px 5px;border-radius:3px;border:1px solid var(--border)">'+r.tipo+'</span>' : ''}
          <span style="color:${r.estado==='Disponible'?'var(--green)':r.estado==='Retirado'?'var(--amber)':'var(--slate-mid)'}">${r.estado}</span>
          ${r.ubic ? '<span>📍 '+r.ubic+'</span>' : ''}
        </div>
      </div>
    </div>`).join('')}`;

  scShow('sc-detalle-pedido');
}

function scGuardarPedido() {
  const p = scPedidos[scDetalleIdx];
  p.agencia = document.getElementById('sc-det-agencia').value;
  p.obs     = document.getElementById('sc-det-obs').value.trim();
  scRenderLista();
  scShow('sc-lista');
  showToast('Info adicional guardada');
}

async function scGuardarTodos() {
  if (!scPedidos.length) { showToast('No hay pedidos para volcar'); return; }
  showToast('Comprobando duplicados…');

  try {
    // 1. Recopilar todas las claves num_pedido + fecha de lo que vamos a subir
    const claves = scPedidos.map(p => ({
      num_pedido: p.numPedido,
      fecha:      fechaEntregaToISO(p.fechaEntrega)
    }));

    // 2. Consultar en Supabase si alguno ya existe
    const numPedidos = claves.map(c => c.num_pedido);
    const { data: existentes, error: errEx } = await sb
      .from('pedidos_control')
      .select('id,num_pedido,fecha,refs,estado,agencia,obs_refs')
      .in('num_pedido', numPedidos);
    if (errEx) throw errEx;

    // Indexar existentes por "num_pedido|fecha"
    const existMap = {};
    (existentes || []).forEach(e => {
      existMap[e.num_pedido + '|' + e.fecha] = e;
    });

    const insertar  = []; // nuevos
    const actualizar = []; // ya existen — hay que hacer merge

    for (const p of scPedidos) {
      const fecha = fechaEntregaToISO(p.fechaEntrega);
      const clave = p.numPedido + '|' + fecha;
      const exist = existMap[clave];

      if (!exist) {
        // Pedido nuevo — insertar completo
        insertar.push({
          num_pedido:           p.numPedido,
          fecha,
          fecha_entrega_str:    p.fechaEntrega || '',
          agencia:              p.agencia || '',
          refs:                 p.refs,
          estado:               'pendiente_refs',
          obs_refs:             p.obs || '',
          consolidacion_refs:   null,
          obs_bultos:           null,
          consolidacion_bultos: null,
          ts:                   Date.now()
        });
      } else {
        // Pedido existente — merge de referencias
        const refsExistentes = Array.isArray(exist.refs) ? exist.refs : [];
        const refsNuevas     = p.refs || [];

        // Indexar existentes por EAN si lo tiene, o por desig si no hay EAN
        const refMap = {};
        refsExistentes.forEach(r => {
          const key = (r.ean && r.ean.trim() && r.ean !== 'Sin EAN') ? 'ean:' + r.ean : 'desig:' + (r.desig || '').toLowerCase().trim();
          refMap[key] = r;
        });

        // Añadir refs nuevas que no existan; no tocar las ya chequeadas
        let huboCambios = false;
        for (const rn of refsNuevas) {
          const key = (rn.ean && rn.ean.trim() && rn.ean !== 'Sin EAN') ? 'ean:' + rn.ean : 'desig:' + (rn.desig || '').toLowerCase().trim();
          if (!refMap[key]) {
            refMap[key] = rn;
            huboCambios = true;
          } else if ((refMap[key].estado_ctrl || 'pendiente') === 'pendiente') {
            // Actualizar solo el EAN si antes no lo tenía y ahora sí
            if (!refMap[key].ean && rn.ean) {
              refMap[key].ean = rn.ean;
              huboCambios = true;
            }
            // Actualizar metadata (qty, precio, ubic) pero conservar estado_ctrl
            refMap[key] = { ...rn, estado_ctrl: refMap[key].estado_ctrl || 'pendiente', excluida_manual: refMap[key].excluida_manual || false };
            huboCambios = true;
          }
        }

        const refsMergeadas = Object.values(refMap);

        actualizar.push({
          id:               exist.id,
          refs:             refsMergeadas,
          // Solo actualizar agencia si no tenía
          agencia:          exist.agencia || p.agencia || '',
          fecha_entrega_str: p.fechaEntrega || exist.fecha_entrega_str || '',
          ts:               Date.now(),
          _cambios:         huboCambios,
          _numPedido:       p.numPedido
        });
      }
    }

    let insertados   = 0;
    let actualizados = 0;
    let sinCambios   = 0;
    const idsAfectados = []; // IDs reales de Supabase para poder borrar después

    // 3. Insertar nuevos y recuperar IDs generados
    if (insertar.length) {
      const { data: insertData, error } = await sb.from('pedidos_control')
        .insert(insertar)
        .select('id');
      if (error) throw error;
      insertados = insertar.length;
      (insertData || []).forEach(r => idsAfectados.push(r.id));
    }

    // 4. Actualizar existentes
    for (const u of actualizar) {
      const { _cambios, _numPedido, id, ...campos } = u;
      idsAfectados.push(id); // guardar ID aunque no haya cambios
      if (_cambios) {
        const { error } = await sb.from('pedidos_control')
          .update({ refs: campos.refs, agencia: campos.agencia, fecha_entrega_str: campos.fecha_entrega_str, ts: campos.ts })
          .eq('id', id);
        if (error) throw error;
        actualizados++;
      } else {
        sinCambios++;
      }
    }

    // 5. Guardar historial local con IDs reales
    const hora = new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
    const h = scGetHistorial();
    h.unshift({
      fecha:       today(),
      hora,
      numPedidos:  scPedidos.length,
      pedidos:     scPedidos.map(p => p.numPedido),
      ids:         idsAfectados, // ← IDs de Supabase para borrado preciso
      insertados,
      actualizados,
      sinCambios
    });
    scSaveHistorial(h);

    // 6. Toast informativo
    const partes = [];
    if (insertados)   partes.push(insertados + ' nuevo' + (insertados!==1?'s':''));
    if (actualizados) partes.push(actualizados + ' actualizado' + (actualizados!==1?'s':''));
    if (sinCambios)   partes.push(sinCambios + ' sin cambios');
    showToast('✓ ' + partes.join(' · ') + ' → Referencias');

    scPedidos = [];
    scSwipeState = {};
    scShow('sc-entrada');
    scCargarHoy();

  } catch(e) { showToast('⚠ Error: ' + e.message); console.error(e); }
}
function scOnExcel(files) {
  if(!files||!files[0]) return;
  scShow('sc-procesando');
  document.getElementById('sc-proc-msg').textContent='Leyendo Excel…';
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const wb=XLSX.read(e.target.result,{type:'binary',cellStyles:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      const peds=scParsear(rows,ws);
      if(!peds.length){alert('No se encontraron pedidos válidos.');scShow('sc-entrada');return;}
      scPedidos=peds;
      scRenderLista();
      scShow('sc-lista');
    } catch(err){alert('Error al leer el Excel: '+err.message);scShow('sc-entrada');}
  };
  reader.readAsBinaryString(files[0]);
}

function scParsear(rows, ws) {
  const pedidos = [];
  let ped = null, enRefs = false;

  // Estados que se incluyen (controlables)
  const ESTADOS_OK = ['disponible', 'inmediato', 'validado'];
  // Estados a excluir
  const ESTADOS_SKIP = ['anulado', 'saldado', 'retirado'];
  // Direcciones a excluir
  const UBIC_SKIP_RE = /^(G\d|PLG|MAT|PROV)/i;

  function tachada(r, c) {
    const cell = ws[XLSX.utils.encode_cell({r, c})];
    return !!(cell?.s?.strike || cell?.s?.font?.strike);
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const v = (c) => String(row[c] || '').trim();

    // ── Detectar cabecera de pedido ──
    // Fila con "Nº pedido:" en col 4 y número en col 7
    if (/nº\s*pedido/i.test(v(4)) && /^\d{5,}$/.test(v(7))) {
      if (ped && ped.refs.some(r => !r.excluida)) pedidos.push(ped);
      ped = {
        numPedido:    v(7),
        agencia:      '',
        fechaEntrega: '',
        refs:         [],
        obs:          ''
      };
      enRefs = false;
      continue;
    }

    if (!ped) continue;

    // ── Fecha de entrega: col 9 = "fecha de entrega:" → col 11 ──
    if (/fecha de entrega/i.test(v(9)) && v(11)) {
      ped.fechaEntrega = v(11); // formato DD/MM/YYYY
      continue;
    }

    // ── Detectar inicio de referencias ──
    if (/c[oó]digo\s*ean/i.test(v(0))) {
      enRefs = true;
      continue;
    }

    if (!enRefs) continue;

    // ── Filtrar tipo SE (servicios) — col 7 ──
    if (/^SE$/i.test(v(7))) continue;

    // ── Filtrar líneas tachadas ──
    if (tachada(r, 0) || tachada(r, 1)) continue;

    // ── Leer datos ──
    const ean    = v(0);
    const desigRaw = v(1); // "NOMBRE PRODUCTO\nREFLM"
    const partes = desigRaw.split('\n');
    const desig  = partes[0].trim();
    const refLM  = partes[1] ? partes[1].trim() : '';
    const qty    = parseFloat(v(3).replace(',', '.')) || 0;
    const precio = parseFloat(v(4).replace(',', '.')) || 0;
    const tipo   = v(7);   // PS / RSS
    const estado = v(8);
    const ubic   = v(11);

    // Saltar filas vacías o de cabecera repetida
    if (!desig) continue;
    if (/designaci[oó]n/i.test(desig) || /c[oó]digo/i.test(ean)) continue;

    // ── Filtrar por estado — solo excluir Anulado y Saldado, NO Retirado ──
    const estadoL = estado.toLowerCase();
    if (estadoL.includes('anulado') || estadoL.includes('saldado')) continue;

    // ── Filtrar por dirección ──
    const excluida = ubic !== '' && UBIC_SKIP_RE.test(ubic);

    // Solo incluir estados controlables: Disponible, Inmediato, Validado, Retirado
    if (!ESTADOS_OK.some(s => estadoL.includes(s)) && !estadoL.includes('retirado') && estadoL !== '') continue;

    ped.refs.push({
      ean,
      desig,
      refLM,
      qty,
      precio,
      tipo,
      estado,
      ubic,
      excluida,
      excluida_manual: false, // el operario puede excluirla manualmente
      estado_ctrl: 'pendiente',
      notas: ''
    });
  }

  // Último pedido
  if (ped && ped.refs.some(r => !r.excluida)) pedidos.push(ped);

  // Filtrar pedidos donde TODAS las refs son excluidas (todas G*, PLG, MAT)
  return pedidos.filter(p => p.refs.some(r => !r.excluida));
}

// Convierte fecha DD/MM/YYYY → YYYY-MM-DD para Supabase
function fechaEntregaToISO(str) {
  if (!str) return today();
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return today();
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

// ── FOTO / VISION ──
function scOnFoto(files) {
  if(!files||!files[0]) return;
  scShow('sc-procesando');
  document.getElementById('sc-proc-msg').textContent='Analizando con IA…';
  const reader=new FileReader();
  reader.onload=e=>{
    compressImage(e.target.result,1600,0.85,async compressed=>{
      try {
        const peds=await scVision(compressed.split(',')[1]);
        if(!peds.length){alert('No se detectaron pedidos. Intenta con foto más nítida.');scShow('sc-entrada');return;}
        scPedidos=peds; scRenderLista(); scShow('sc-lista');
      } catch(err){alert('Error IA: '+err.message);scShow('sc-entrada');}
    });
  };
  reader.readAsDataURL(files[0]);
}

async function scVision(b64) {
  // Llamamos a nuestro proxy PHP en vez de a api.anthropic.com directamente
  // (el navegador bloquea llamadas CORS a dominios externos)
  const res = await fetch('vision-proxy.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: `Analiza este albarán de Leroy Merlin Las Rozas. Devuelve JSON puro sin markdown ni texto adicional.

Formato exacto:
[{"numPedido":"string","fechaEntrega":"DD/MM/YYYY","agencia":"Geacargo|Method|","refs":[{"ean":"string","desig":"string","refLM":"string","qty":1,"precio":0,"tipo":"PS|RSS","estado":"Disponible","ubic":"string","excluida":false,"estado_ctrl":"pendiente","notas":""}]}]

REGLAS ESTRICTAS:
- Extrae TODOS los pedidos del albarán
- Ignora líneas con tipo "SE" (son servicios, no productos físicos)
- Si la ubicación empieza por G+números, PLG o MAT: excluida=true
- Ignora líneas con estado Anulado, Saldado o Retirado
- Solo incluye estado Disponible, Inmediato o Validado
- refLM es la referencia numérica que aparece debajo del nombre del producto
- Devuelve SOLO el JSON, sin ningún texto antes ni después` }
        ]
      }]
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Proxy error ' + res.status + ': ' + txt.slice(0, 200));
  }
  const data  = await res.json();
  const text  = data.content.map(c => c.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ── LISTA PEDIDOS EXTRAÍDOS ──
// ════════════════════════════════════════════════════
// ══ MÓDULO 2: REFERENCIAS ══
// Carga pedidos del día en estado 'pendiente_refs'
// Al completar → estado: 'pendiente_bultos'
// ════════════════════════════════════════════════════
let refPedidoActivo = null;

// ── Hora de cierre de referencias (16:00) ──
function refCerrado() {
  const h = new Date().getHours();
  return h >= 16;
}

// ── Buscador de Referencias — busca en pendientes + completados + anterior ──
let refPedidosCached     = [];
let refCompletadosCached = [];
let refAnteriorCached    = [];

function refFiltrarBusqueda() {
  const q = document.getElementById('ref-buscar').value.trim().toLowerCase();
  document.getElementById('ref-buscar-clear').style.display = q ? '' : 'none';
  if (q) refBuscarGlobal(q); else refRenderListaFiltrada('');
}

function refLimpiarBusqueda() {
  document.getElementById('ref-buscar').value = '';
  document.getElementById('ref-buscar-clear').style.display = 'none';
  refRenderListaFiltrada('');
}

function refMatchPedido(p, q) {
  if ((p.num_pedido || '').toLowerCase().includes(q)) return true;
  return (p.refs || []).some(r =>
    (r.ean   || '').toLowerCase().includes(q) ||
    (r.desig || '').toLowerCase().includes(q) ||
    (r.refLM || '').toLowerCase().includes(q)
  );
}

async function refBuscarGlobal(q) {
  // 1. Filtrar cache de pendientes
  const enPendientes   = refPedidosCached.filter(p => refMatchPedido(p, q));

  // 2. Buscar en Supabase (completados + anterior) si no están ya cacheados
  let enCompletados = refCompletadosCached.filter(p => refMatchPedido(p, q));
  let enAnterior    = refAnteriorCached.filter(p => refMatchPedido(p, q));

  // Si los caches de completados/anterior están vacíos, consultamos Supabase
  if (!refCompletadosCached.length || !refAnteriorCached.length) {
    try {
      const { data } = await sb.from('pedidos_control')
        .select('id,num_pedido,fecha,agencia,estado,refs')
        .in('estado', ['pendiente_bultos', 'completado'])
        .order('fecha', { ascending: false })
        .limit(100);
      refCompletadosCached = data || [];
      enCompletados = refCompletadosCached.filter(p => refMatchPedido(p, q));

      const idsAnterior = anteriorGetHoy();
      if (idsAnterior.length) {
        const { data: dA } = await sb.from('pedidos_control')
          .select('id,num_pedido,fecha,agencia,estado,refs')
          .in('id', idsAnterior);
        refAnteriorCached = dA || [];
        enAnterior = refAnteriorCached.filter(p => refMatchPedido(p, q));
      }
    } catch(e) { console.warn('refBuscarGlobal:', e); }
  }

  const total = enPendientes.length + enCompletados.length + enAnterior.length;
  const hoy   = today();

  if (!total) {
    document.getElementById('ref-lista-items').innerHTML =
      `<div style="padding:20px;text-align:center;font-size:13px;color:var(--slate-lt)">
        Sin resultados para "<b>${q}</b>"<br>
        <span style="font-size:11px">Prueba con otro término</span>
      </div>`;
    return;
  }

  let html = '';

  if (enPendientes.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--slate-lt);text-transform:uppercase;letter-spacing:0.6px;padding:8px 0 5px">
      Pendientes (${enPendientes.length})</div>`;
    html += refRenderItems(enPendientes, 'pendiente');
  }

  if (enCompletados.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--slate-lt);text-transform:uppercase;letter-spacing:0.6px;padding:${enPendientes.length?'14px':'8px'} 0 5px">
      Ya controlados (${enCompletados.length}) · <span style="color:var(--green)">Pulsa para abrir</span></div>`;
    html += refRenderItems(enCompletados, 'completados');
  }

  if (enAnterior.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:0.6px;padding:${(enPendientes.length||enCompletados.length)?'14px':'8px'} 0 5px">
      Carpeta Anterior (${enAnterior.length})</div>`;
    html += refRenderItems(enAnterior, 'anterior');
  }

  document.getElementById('ref-lista-items').innerHTML = html;
}

function refRenderListaFiltrada(q) {
  const peds = q ? refPedidosCached.filter(p => refMatchPedido(p, q)) : refPedidosCached;
  if (!peds.length && q) {
    document.getElementById('ref-lista-items').innerHTML =
      `<div style="padding:20px;text-align:center;font-size:13px;color:var(--slate-lt)">Sin resultados para "<b>${q}</b>"</div>`;
    return;
  }
  document.getElementById('ref-lista-items').innerHTML = refRenderItems(peds, 'pendiente');
}

function refRenderItems(peds, origen) {
  const hoy = today();
  return peds.map(p => {
    const refs     = (p.refs || []).filter(r => !r.excluida);
    const ok       = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
    const inc      = refs.filter(r => ['incidencia','falta'].includes(r.estado_ctrl || '')).length;
    const esFuturo = p.fecha > hoy;

    // Acción al pulsar según origen
    let onclick, badge, borde = '';
    if (origen === 'pendiente') {
      onclick = `refAbrirRevision('${p.id}')`;
      badge   = `<span class="badge ${ok===refs.length&&refs.length>0?'badge-ok':'badge-warn'}">${ok}/${refs.length}</span>`;
      borde   = esFuturo ? 'border-left:3px solid var(--green)' : '';
    } else if (origen === 'completados') {
      onclick = `refAbrirDesdeCompletados('${p.id}')`;
      badge   = `<span class="badge ${p.estado==='completado'?'badge-ok':'badge-warn'}">${p.estado==='completado'?'Completo':'En bultos'}</span>`;
      borde   = 'border-left:3px solid var(--green)';
    } else { // anterior
      onclick = `refForzarAbierto('${p.id}')`;
      badge   = `<span class="badge badge-warn">Anterior</span>`;
      borde   = 'border-left:3px solid var(--amber)';
    }

    return `<div class="scan-pedido-card" onclick="${onclick}" style="${borde}">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600">Pedido ${p.num_pedido}</div>
        <div style="font-size:12px;color:var(--slate-lt);margin-top:2px">
          ${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)} · ${refs.length} ref${refs.length!==1?'s':''}
          ${esFuturo&&origen==='pendiente'?' · <span style="color:var(--green);font-weight:600">Próximo</span>':''}
          ${inc?' · <span style="color:var(--red)">'+inc+' incid.</span>':''}
        </div>
      </div>
      ${badge}
      <span style="color:var(--slate-lt);font-size:18px">›</span>
    </div>`;
  }).join('');
}

// Abre un pedido de completados — abre la carpeta y lo carga
async function refAbrirDesdeCompletados(id) {
  // Abrir panel completados si no está abierto
  const panel = document.getElementById('ref-completados-panel');
  if (panel && panel.style.display !== 'block') {
    refToggleCarpeta('completados');
  }
  // Cargar el pedido y abrirlo en revisión (solo lectura si es completado)
  const { data, error } = await sb.from('pedidos_control').select('*').eq('id', id).single();
  if (error || !data) { showToast('⚠ Error al cargar pedido'); return; }
  refPedidoActivo = data;
  refRenderRevision();
  document.getElementById('ref-lista-sec').style.display = 'none';
  document.getElementById('ref-revision-sec').style.display = 'block';
  // Scroll suave al panel
  setTimeout(() => document.getElementById('ref-revision-sec').scrollIntoView({ behavior:'smooth', block:'start' }), 50);
}

// ── Buscador de Bultos — busca en pendientes y completados ──
let bulPedidosCached      = [];
let bulCompletadosCached  = [];

function bulFiltrarBusqueda() {
  const q = document.getElementById('bul-buscar').value.trim().toLowerCase();
  document.getElementById('bul-buscar-clear').style.display = q ? '' : 'none';
  if (q) bulBuscarGlobal(q); else bulRenderListaFiltrada('');
}

function bulLimpiarBusqueda() {
  document.getElementById('bul-buscar').value = '';
  document.getElementById('bul-buscar-clear').style.display = 'none';
  bulRenderListaFiltrada('');
}

function bulMatchPedido(p, q) {
  if ((p.num_pedido || '').toLowerCase().includes(q)) return true;
  return (p.refs || []).some(r =>
    (r.ean   || '').toLowerCase().includes(q) ||
    (r.desig || '').toLowerCase().includes(q) ||
    (r.refLM || '').toLowerCase().includes(q)
  );
}

async function bulBuscarGlobal(q) {
  const enPendientes = bulPedidosCached.filter(p => bulMatchPedido(p, q));

  // Completados — busca en Supabase si cache vacío
  if (!bulCompletadosCached.length) {
    try {
      const { data } = await sb.from('pedidos_control')
        .select('id,num_pedido,fecha,agencia,estado,refs,consolidacion_bultos')
        .eq('estado', 'completado')
        .order('fecha', { ascending: false })
        .limit(100);
      bulCompletadosCached = data || [];
    } catch(e) {}
  }
  const enCompletados = bulCompletadosCached.filter(p => bulMatchPedido(p, q));

  const total = enPendientes.length + enCompletados.length;

  if (!total) {
    document.getElementById('bul-lista-items').innerHTML =
      `<div style="padding:20px;text-align:center;font-size:13px;color:var(--slate-lt)">
        Sin resultados para "<b>${q}</b>"
      </div>`;
    return;
  }

  let html = '';

  if (enPendientes.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--slate-lt);text-transform:uppercase;letter-spacing:0.6px;padding:8px 0 5px">
      Pendientes (${enPendientes.length})</div>`;
    html += bulRenderItems(enPendientes, 'pendiente');
  }

  if (enCompletados.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:0.6px;padding:${enPendientes.length?'14px':'8px'} 0 5px">
      Completados (${enCompletados.length}) · <span style="color:var(--green)">Pulsa para ver</span></div>`;
    html += bulRenderItems(enCompletados, 'completado');
  }

  document.getElementById('bul-lista-items').innerHTML = html;
}

function bulRenderListaFiltrada(q) {
  const peds = q ? bulPedidosCached.filter(p => bulMatchPedido(p, q)) : bulPedidosCached;
  document.getElementById('bul-lista-items').innerHTML = bulRenderItems(peds, 'pendiente');
}

function bulRenderItems(peds, origen) {
  if (!peds.length) return '<div class="carpeta-empty">Sin resultados.</div>';
  return peds.map(p => {
    const onclick = origen === 'completado'
      ? `bulAbrirRevision('${p.id}')`
      : `bulAbrirRevision('${p.id}')`;
    const badge = origen === 'completado'
      ? `<span class="badge badge-ok">Completo</span>`
      : `<span class="badge badge-warn">Pendiente</span>`;
    const borde = origen === 'completado' ? 'border-left:3px solid var(--green)' : '';
    return `<div class="scan-pedido-card" onclick="${onclick}" style="${borde}">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600">Pedido ${p.num_pedido}</div>
        <div style="font-size:12px;color:var(--slate-lt);margin-top:2px">
          ${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)}
        </div>
      </div>
      ${badge}
      <span style="color:var(--slate-lt);font-size:18px">›</span>
    </div>`;
  }).join('');
}

// ── Carpeta Anterior — pedidos del día que quedan tras las 16:00 ──
// La lógica: al cargar referencias, si son ≥16:00 los pedidos de hoy
// van a la carpeta "Anterior". Al día siguiente se archivan con la fecha.
const ANTERIOR_KEY = 'ref_anterior_v1';

function anteriorGetHoy() {
  try {
    const d = JSON.parse(localStorage.getItem(ANTERIOR_KEY) || '{}');
    return d.fecha === today() ? (d.ids || []) : [];
  } catch(e) { return []; }
}

function anteriorGuardar(ids) {
  localStorage.setItem(ANTERIOR_KEY, JSON.stringify({ fecha: today(), ids }));
}

async function anteriorArchivar() {
  // Llamado al arrancar: si hay datos de "ayer" en Anterior, archivarlos en Supabase
  try {
    const raw = JSON.parse(localStorage.getItem(ANTERIOR_KEY) || '{}');
    if (!raw.fecha || raw.fecha === today() || !raw.ids?.length) return;
    // Archivar: marcar en Supabase con carpeta = fecha del día anterior
    await sb.from('pedidos_control')
      .update({ carpeta_archivo: raw.fecha })
      .in('id', raw.ids)
      .is('carpeta_archivo', null);
    localStorage.removeItem(ANTERIOR_KEY);
  } catch(e) { console.warn('anteriorArchivar:', e); }
}



async function refCargar() {
  const agencia = document.getElementById('ref-filtro-agencia').value;
  const hoy = today();

  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('*').eq('estado','pendiente_refs').order('fecha').order('ts');
    if (error) throw error;
    let peds = data || [];
    if (agencia) peds = peds.filter(p => p.agencia === agencia);

    // Solo hoy y futuros — sin bloqueo por hora
    const visibles = peds.filter(p => p.fecha >= hoy);
    const pasados  = peds.filter(p => p.fecha <  hoy);

    document.getElementById('ref-fecha-label').textContent =
      visibles.length
        ? 'Entrega: ' + [...new Set(visibles.map(p => fmtDate(p.fecha)))].join(', ')
        : 'Sin pedidos pendientes para hoy o días futuros';

    document.getElementById('ref-stats').innerHTML =
      statCard(visibles.length, 'Pendientes', 'var(--amber)') +
      statCard(visibles.filter(p => (p.refs||[]).some(x => (x.estado_ctrl||'') === 'incidencia')).length, 'Con incidencia', 'var(--red)') +
      statCard(visibles.filter(p => p.fecha === hoy).length, 'De hoy', 'var(--green)');

    refPedidosCached = visibles;

    if (!visibles.length) {
      document.getElementById('ref-empty').style.display = 'block';
      document.getElementById('ref-lista-items').innerHTML = '';
    } else {
      document.getElementById('ref-empty').style.display = 'none';
      document.getElementById('ref-lista-items').innerHTML = refRenderItems(visibles);
    }

    document.getElementById('ref-lista-sec').style.display = 'block';
    document.getElementById('ref-revision-sec').style.display = 'none';
    refRenderCompletados();

  } catch(e) { showToast('⚠ Error al cargar referencias'); console.error(e); }
}

function refToggleCarpeta(cual) {
  const panel   = document.getElementById('ref-' + cual + '-panel');
  const chevron = document.getElementById('ref-' + cual + '-chevron');
  const open    = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display     = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  if (open) {
    if (cual === 'completados') refRenderCompletados();
    if (cual === 'anterior')    refRenderAnterior();
  }
}

async function refAbrirRevision(id) {
  const { data, error } = await sb.from('pedidos_control').select('*').eq('id', id).single();
  if (error || !data) { showToast('⚠ Error al cargar pedido'); return; }
  refPedidoActivo = data;
  refRenderRevision();
  document.getElementById('ref-lista-sec').style.display = 'none';
  document.getElementById('ref-revision-sec').style.display = 'block';
}

function refRenderRevision() {
  const p = refPedidoActivo;
  // refs controlables = no excluidas por ubicación NI excluidas manualmente
  const refs = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
  // para el render mostramos también las excluidas manualmente (atenuadas)
  const refsConExcluidas = (p.refs || []).filter(r => !r.excluida);
  const ok = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
  document.getElementById('ref-rev-titulo').textContent = 'Pedido ' + p.num_pedido;
  document.getElementById('ref-rev-agencia').textContent = (p.agencia || 'Sin agencia') + ' · Entrega ' + fmtDate(p.fecha);
  document.getElementById('ref-rev-badge').innerHTML = `<span class="badge ${ok === refs.length && refs.length > 0 ? 'badge-ok' : 'badge-warn'}">${ok}/${refs.length}</span>`;
  document.getElementById('ref-rev-barra').style.width = (refs.length ? Math.round(ok / refs.length * 100) : 0) + '%';
  document.getElementById('ref-rev-prog-txt').textContent = ok + ' de ' + refs.length + ' referencias verificadas';
  document.getElementById('ref-rev-obs').value = p.obs_refs || '';

  const todasMarcadas = refs.length > 0 && refs.every(r => (r.estado_ctrl || 'pendiente') !== 'pendiente');
  const btn = document.getElementById('ref-btn-completar');
  btn.disabled = !todasMarcadas; btn.style.opacity = todasMarcadas ? '1' : '0.4';

  document.getElementById('ref-rev-refs').innerHTML = refsConExcluidas.map(ref => {
    const realIdx = (p.refs || []).indexOf(ref);
    const ctrl = ref.estado_ctrl || 'pendiente';
    const esRetirado = (ref.estado || '').toLowerCase().includes('retirado');
    const excluidaManual = ref.excluida_manual || false;

    // Si está excluida manualmente, mostrar como tarjeta atenuada con botón de reactivar
    if (excluidaManual) {
      return `<div class="scan-ref-row" style="border-left:3px solid var(--border);opacity:0.5">
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;font-weight:600;color:var(--slate-lt)">${ref.ean || 'Sin EAN'}${ref.refLM ? ' · ' + ref.refLM : ''}</div>
          <div style="font-size:13px;font-weight:500;margin:2px 0;color:var(--slate-lt);text-decoration:line-through">${ref.desig || '—'}</div>
          <div style="font-size:11px;color:var(--slate-lt)">Excluida manualmente · ×${ref.qty}</div>
        </div>
        <button class="scan-est-btn" onclick="refToggleExcluir(${realIdx})"
          style="background:var(--bg);color:var(--slate-mid);font-size:10px;min-width:60px">
          ↩ Incluir
        </button>
      </div>`;
    }

    const borde = ctrl === 'ok' ? 'var(--green)'
      : ctrl === 'falta' ? 'var(--red)'
      : ctrl === 'incidencia' ? 'var(--amber)'
      : esRetirado ? 'var(--amber)'
      : 'var(--border)';

    return `<div class="scan-ref-row" style="border-left:3px solid ${borde}">
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:600;color:var(--slate-lt);letter-spacing:0.3px">${ref.ean || 'Sin EAN'}${ref.refLM ? ' · ' + ref.refLM : ''}</div>
        <div style="font-size:13px;font-weight:500;margin:2px 0;line-height:1.3">${ref.desig || '—'}</div>
        <div style="font-size:11px;color:var(--slate-lt);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          <span><b>×${ref.qty}</b></span>
          ${ref.precio ? '<span>' + Number(ref.precio).toFixed(2) + '€</span>' : ''}
          ${ref.tipo ? '<span style="background:var(--bg);padding:1px 5px;border-radius:3px;border:1px solid var(--border);font-size:10px">' + ref.tipo + '</span>' : ''}
          <span style="color:${esRetirado ? 'var(--amber)' : ctrl === 'ok' ? 'var(--green)' : 'var(--slate-mid)'};font-weight:${esRetirado ? '600' : '400'}">${ref.estado || ''}</span>
          ${ref.ubic ? '<span>📍 ' + ref.ubic + '</span>' : '<span style="color:var(--amber)">Sin ubicación</span>'}
        </div>
        ${esRetirado ? '<div style="font-size:11px;color:var(--amber);margin-top:4px;padding:4px 6px;background:var(--amber-lt);border-radius:4px">⚠ Retirado por cliente — puede estar fuera</div>' : ''}
      </div>
      <div class="scan-ref-btns">
        <button class="scan-est-btn ${ctrl === 'ok' ? 'ok' : ''}"          onclick="refSetEstado(${realIdx},'ok')">✓ OK</button>
        <button class="scan-est-btn ${ctrl === 'falta' ? 'falta' : ''}"    onclick="refSetEstado(${realIdx},'falta')">✗ Falta</button>
        <button class="scan-est-btn ${ctrl === 'incidencia' ? 'inc' : ''}" onclick="refSetEstado(${realIdx},'incidencia')">⚠ Incid.</button>
        ${esRetirado ? '<button class="scan-est-btn" onclick="refToggleExcluir(' + realIdx + ')" style="background:var(--red-lt);color:var(--red);border-color:var(--red-lt);font-size:10px">✕ Excluir</button>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════
// ESCÁNER EAN — QuaggaJS (mejor rendimiento en móvil)
// ════════════════════════════════════════════════════
let refScannerActivo = false;
let refUltimoEAN     = '';
let refEANBuffer     = {}; // cuenta lecturas consecutivas para confirmar

// ── Botón incidencia ──
function refNuevaIncidencia() {
  const form = document.getElementById('ref-inc-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') document.getElementById('ref-inc-texto').focus();
}
function refCerrarIncidencia() {
  document.getElementById('ref-inc-form').style.display = 'none';
  document.getElementById('ref-inc-texto').value = '';
}
function refGuardarIncidencia() {
  const texto = document.getElementById('ref-inc-texto').value.trim();
  if (!texto) { showToast('⚠ Escribe qué ha ocurrido'); return; }
  const obs = document.getElementById('ref-rev-obs');
  obs.value = (obs.value.trim() ? obs.value.trim() + '\n' : '') + '⚠ ' + texto;
  refCerrarIncidencia();
  showToast('✓ Incidencia anotada');
}

// ── Iniciar escáner ──
async function refToggleScanner() {
  if (refScannerActivo) { refDetenerScanner(); return; }

  const area = document.getElementById('ref-scanner-area');
  const btn  = document.getElementById('ref-scan-btn');
  area.style.display = 'block';
  document.getElementById('ref-manual-area').style.display = 'none';
  btn.textContent      = '⏳ Iniciando cámara…';
  btn.style.background = '#64748B';
  btn.disabled         = true;
  refEANBuffer         = {};
  refUltimoEAN         = '';

  // Esperar a que el DOM renderice el div antes de que Quagga lo use
  await new Promise(r => setTimeout(r, 150));

  Quagga.init({
    inputStream: {
      name: 'Live',
      type: 'LiveStream',
      target: document.getElementById('ref-scanner-reader'),
      constraints: {
        width:  { min: 640, ideal: 1920, max: 1920 },
        height: { min: 480, ideal: 1080, max: 1080 },
        facingMode: 'environment',
        aspectRatio: { ideal: 1.7777 }
      },
      area: {
        top:    '34%',
        right:  '6%',
        left:   '6%',
        bottom: '34%'
      },
      singleChannel: false
    },
    locator: {
      patchSize: 'medium',
      halfSample: true
    },
    numOfWorkers: navigator.hardwareConcurrency ? Math.min(4, navigator.hardwareConcurrency) : 2,
    frequency: 15,
    decoder: {
      readers: [
        'ean_reader',
        'ean_8_reader',
        'code_128_reader',
        'code_39_reader',
        'upc_reader',
        'upc_e_reader'
      ],
      multiple: false
    },
    locate: true
  }, err => {
    if (err) {
      console.error('Quagga init error:', err);
      // Mostrar el error real en un toast para diagnosticar
      const msg = (typeof err === 'string') ? err : (err.message || JSON.stringify(err));
      showToast('⚠ Error cámara: ' + msg.slice(0, 80), 6000);
      area.style.display   = 'none';
      btn.textContent      = '📷 Escanear EAN con cámara';
      btn.style.background = 'var(--green)';
      btn.disabled         = false;
      document.getElementById('ref-manual-area').style.display = 'block';
      return;
    }

    Quagga.start();
    refScannerActivo     = true;
    btn.textContent      = '📷 Escáner activo';
    btn.style.background = '#16a34a';
    btn.disabled         = false;

    // ── Configurar cámara: autofoco continuo, guardar track para torch/zoom ──
    setTimeout(() => refConfigurarCamara(), 600);

    // Toque en el visor = reenfocar en ese punto
    const reader = document.getElementById('ref-scanner-reader');
    reader.style.cursor = 'pointer';
    reader.onclick = () => refEnfocar();

    // Dibujar línea roja sobre el código detectado
    Quagga.onProcessed(result => {
      const ctx = Quagga.canvas.ctx.overlay;
      const cvs = Quagga.canvas.dom.overlay;
      if (!ctx || !cvs) return;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      if (result && result.codeResult && result.box) {
        Quagga.ImageDebug.drawPath(result.box, { x: 0, y: 1 }, ctx,
          { color: '#00C853', lineWidth: 3 });
      }
    });

    // Procesar resultado con confirmación doble
    Quagga.onDetected(result => {
      const ean = result.codeResult.code;
      if (!ean) return;

      // Confirmar con 2 lecturas consecutivas del mismo código
      refEANBuffer[ean] = (refEANBuffer[ean] || 0) + 1;
      if (refEANBuffer[ean] < 2) return;
      refEANBuffer = {};

      if (ean === refUltimoEAN) return;
      refUltimoEAN = ean;
      setTimeout(() => { refUltimoEAN = ''; }, 2000);

      refCheckEAN(ean);
    });
  });
}

// ── Control avanzado de cámara ──
let refCamTrack   = null;
let refTorchOn    = false;
let refZoomActual = 1;

function refConfigurarCamara() {
  try {
    const video = document.querySelector('#ref-scanner-reader video');
    if (!video || !video.srcObject) return;
    const track = video.srcObject.getVideoTracks()[0];
    if (!track) return;
    refCamTrack = track;

    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const constraints = { advanced: [] };

    // Autofoco continuo
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      constraints.advanced.push({ focusMode: 'continuous' });
    }
    // Distancia de enfoque cercana (macro) si está disponible
    if (caps.focusDistance) {
      constraints.advanced.push({ focusDistance: caps.focusDistance.min });
    }
    // Zoom inicial ligero para acercar
    if (caps.zoom) {
      refZoomActual = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1.5));
      constraints.advanced.push({ zoom: refZoomActual });
    }

    if (constraints.advanced.length) {
      track.applyConstraints(constraints).catch(e => console.warn('Constraints:', e));
    }

    // Ocultar botón de linterna si no está soportada
    if (!caps.torch) {
      const tb = document.getElementById('ref-torch-btn');
      if (tb) tb.style.opacity = '0.4';
    }
  } catch(e) { console.warn('refConfigurarCamara:', e); }
}

// Forzar reenfoque manual
function refEnfocar() {
  if (!refCamTrack) return;
  const caps = refCamTrack.getCapabilities ? refCamTrack.getCapabilities() : {};
  if (!caps.focusMode) { showToast('Enfoque automático no disponible'); return; }
  // Truco: cambiar a manual y volver a continuo fuerza un reenfoque
  refCamTrack.applyConstraints({ advanced: [{ focusMode: 'manual' }] })
    .then(() => new Promise(r => setTimeout(r, 120)))
    .then(() => refCamTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }))
    .then(() => { if (navigator.vibrate) navigator.vibrate(30); })
    .catch(() => {});
}

// Linterna
function refToggleTorch() {
  if (!refCamTrack) return;
  const caps = refCamTrack.getCapabilities ? refCamTrack.getCapabilities() : {};
  if (!caps.torch) { showToast('Linterna no disponible en este dispositivo'); return; }
  refTorchOn = !refTorchOn;
  refCamTrack.applyConstraints({ advanced: [{ torch: refTorchOn }] })
    .then(() => {
      const tb = document.getElementById('ref-torch-btn');
      if (tb) {
        tb.style.background = refTorchOn ? '#FEF08A' : 'var(--bg)';
        tb.style.color      = refTorchOn ? '#854D0E' : 'var(--slate-mid)';
      }
    })
    .catch(() => showToast('No se pudo activar la linterna'));
}

// Zoom digital
function refCamZoom(dir) {
  if (!refCamTrack) return;
  const caps = refCamTrack.getCapabilities ? refCamTrack.getCapabilities() : {};
  if (!caps.zoom) { showToast('Zoom no disponible'); return; }
  const step = (caps.zoom.max - caps.zoom.min) / 8;
  refZoomActual = Math.min(caps.zoom.max, Math.max(caps.zoom.min, refZoomActual + dir * step));
  refCamTrack.applyConstraints({ advanced: [{ zoom: refZoomActual }] }).catch(() => {});
}

function refDetenerScanner() {
  if (refScannerActivo) {
    // Apagar linterna antes de parar
    if (refCamTrack && refTorchOn) {
      try { refCamTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch(e) {}
    }
    try { Quagga.stop(); } catch(e) {}
    refScannerActivo = false;
  }
  refCamTrack   = null;
  refTorchOn    = false;
  refZoomActual = 1;
  refEANBuffer  = {};
  refUltimoEAN  = '';
  const tb = document.getElementById('ref-torch-btn');
  if (tb) { tb.style.background = 'var(--bg)'; tb.style.color = 'var(--slate-mid)'; }
  document.getElementById('ref-scanner-area').style.display = 'none';
  const btn = document.getElementById('ref-scan-btn');
  if (btn) {
    btn.textContent      = '📷 Escanear EAN con cámara';
    btn.style.background = 'var(--green)';
    btn.disabled         = false;
  }
}

function refToggleManual() {
  refDetenerScanner();
  const area = document.getElementById('ref-manual-area');
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
  if (area.style.display === 'block') {
    document.getElementById('ref-ean-input').value = '';
    document.getElementById('ref-ean-input').focus();
  }
}

// ── Comprobar EAN contra el pedido ──
function refCheckEAN(ean) {
  ean = (ean || '').trim();
  if (!ean) return;

  const inp = document.getElementById('ref-ean-input');
  if (inp) inp.value = '';

  const p   = refPedidoActivo;
  const idx = p.refs.findIndex(r =>
    !r.excluida && !r.excluida_manual && r.ean && r.ean.trim() === ean
  );

  const feedback = document.getElementById('ref-scan-feedback');

  if (idx === -1) {
    feedback.style.cssText = 'display:block;background:var(--red-lt);color:var(--red);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:8px;font-size:13px;font-weight:600';
    feedback.textContent   = '✗ EAN ' + ean + ' no encontrado en este pedido';
    const form = document.getElementById('ref-inc-form');
    form.style.display = 'block';
    document.getElementById('ref-inc-texto').value =
      'EAN ' + ean + ' escaneado no coincide con ninguna referencia del pedido.';
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
    setTimeout(() => { feedback.style.display = 'none'; }, 5000);
    return;
  }

  const ref = p.refs[idx];

  if ((ref.estado_ctrl || 'pendiente') === 'ok') {
    feedback.style.cssText = 'display:block;background:#E0F2FE;color:#0369A1;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:8px;font-size:13px;font-weight:600';
    feedback.textContent   = '✓ ' + (ref.desig || ean) + ' — ya OK';
    setTimeout(() => { feedback.style.display = 'none'; }, 1800);
    return;
  }

  // ✓ Marcar OK
  p.refs[idx].estado_ctrl = 'ok';
  feedback.style.cssText = 'display:block;background:var(--green-lt);color:var(--green);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:8px;font-size:13px;font-weight:600';
  feedback.textContent   = '✓ ' + (ref.desig || ean) + (ref.qty > 1 ? '  ×' + ref.qty : '');
  if (navigator.vibrate) navigator.vibrate(60);
  setTimeout(() => { feedback.style.display = 'none'; }, 1800);

  refRenderRevision();
}

function refSetEstado(refIdx, estado) {
  refPedidoActivo.refs[refIdx].estado_ctrl = estado;
  refRenderRevision();
}

function refToggleExcluir(refIdx) {
  const ref = refPedidoActivo.refs[refIdx];
  ref.excluida_manual = !ref.excluida_manual;
  if (ref.excluida_manual) ref.estado_ctrl = 'excluida';
  else ref.estado_ctrl = 'pendiente';
  refRenderRevision();
}

async function refCompletar() {
  const p = refPedidoActivo;
  const obs = document.getElementById('ref-rev-obs').value.trim();
  const hayInc = p.refs.some(r => r.estado_ctrl === 'incidencia' || r.estado_ctrl === 'falta');
  try {
    const { error } = await sb.from('pedidos_control').update({
      refs:    p.refs,
      estado:  'pendiente_bultos',
      obs_refs: obs,
      ts_refs: Date.now()
    }).eq('id', p.id);
    if (error) throw error;
    showToast('✓ Pedido ' + p.num_pedido + ' → Control de Bultos' + (hayInc ? ' · Con incidencias' : ''));
    refVolverLista();
    refCargar();
  } catch(e) { showToast('⚠ Error al guardar: ' + e.message); }
}

function refVolverLista() {
  refDetenerScanner();
  document.getElementById('ref-lista-sec').style.display = 'block';
  document.getElementById('ref-revision-sec').style.display = 'none';
  refCargar();
}

// ── Sección de pedidos ya controlados por referencias ──
async function refRenderCompletados() {
  const lista = document.getElementById('ref-completados-lista');
  const count = document.getElementById('ref-completados-count');
  if (!lista) return;
  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('id,num_pedido,fecha,agencia,estado,refs,obs_refs')
      .in('estado', ['pendiente_bultos', 'completado'])
      .gte('fecha', manana())
      .order('fecha', { ascending: true })
      .limit(30);
    if (error) throw error;
    const peds = data || [];
    if (count) count.textContent = peds.length ? '(' + peds.length + ')' : '';
    if (!peds.length) {
      lista.innerHTML = '<div class="carpeta-empty">No hay pedidos controlados con entrega pendiente.</div>';
      return;
    }
    lista.innerHTML = peds.map(p => {
      const refs = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
      const ok   = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
      const inc  = refs.filter(r => ['incidencia','falta'].includes(r.estado_ctrl || '')).length;
      const enBultos   = p.estado === 'pendiente_bultos';
      const completado = p.estado === 'completado';
      return `<div class="carpeta-row">
        <div class="carpeta-row-info">
          <div class="carpeta-row-title">Pedido ${p.num_pedido}</div>
          <div class="carpeta-row-meta">
            ${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)} · ${ok}/${refs.length} refs
            ${inc?' · <span style="color:var(--red)">'+inc+' incid.</span>':''}
          </div>
        </div>
        <span class="badge ${completado?'badge-ok':'badge-warn'}">${completado?'Completo':'En bultos'}</span>
        ${enBultos?`<button onclick="refDeshacer('${p.id}')"
          style="background:var(--amber-lt);color:var(--amber);border:none;border-radius:var(--radius-sm);padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">
          ↩ Deshacer</button>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('refRenderCompletados:', e); }
}

async function refRenderAnterior() {
  const lista = document.getElementById('ref-anterior-lista');
  const count = document.getElementById('ref-anterior-count');
  if (!lista) return;

  const ids = anteriorGetHoy();
  if (count) count.textContent = ids.length ? '(' + ids.length + ')' : '';

  if (!ids.length) {
    lista.innerHTML = '<div class="carpeta-empty">Sin pedidos en Anterior.</div>';
    return;
  }

  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('id,num_pedido,fecha,agencia,estado,refs')
      .in('id', ids);
    if (error) throw error;
    const peds = data || [];
    if (!peds.length) {
      lista.innerHTML = '<div class="carpeta-empty">Sin pedidos en Anterior.</div>';
      return;
    }
    lista.innerHTML = peds.map(p => {
      const refs = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
      const ok   = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
      return `<div class="carpeta-row">
        <div class="carpeta-row-info">
          <div class="carpeta-row-title">Pedido ${p.num_pedido}</div>
          <div class="carpeta-row-meta">${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)} · ${ok}/${refs.length} refs</div>
        </div>
        <span class="badge badge-warn">Bloqueado</span>
        <div class="carpeta-row-actions">
          <button onclick="refForzarAbierto('${p.id}')"
            style="background:var(--green-lt);color:var(--green);border:none;border-radius:var(--radius-sm);padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">
            Forzar ›
          </button>
        </div>
      </div>`;
    }).join('');
  } catch(e) { console.error('refRenderAnterior:', e); }
}

async function refForzarAbierto(id) {
  const { data, error } = await sb.from('pedidos_control').select('*').eq('id', id).single();
  if (error || !data) { showToast('⚠ Error al cargar pedido'); return; }
  // Quitar del anterior local
  const h = anteriorGetHoy().filter(i => i !== id);
  anteriorGuardar(h);
  // Abrir en revisión
  refAnteriorCached = []; // invalidar cache
  refPedidoActivo = data;
  refRenderRevision();
  document.getElementById('ref-lista-sec').style.display = 'none';
  document.getElementById('ref-revision-sec').style.display = 'block';
}

async function refDeshacer(id) {
  if (!confirm('¿Devolver este pedido a Referencias? Se perderá el progreso de bultos si lo hubiera.')) return;
  try {
    const { error } = await sb.from('pedidos_control')
      .update({ estado: 'pendiente_refs', ts_refs: null })
      .eq('id', id)
      .eq('estado', 'pendiente_bultos');
    if (error) throw error;
    showToast('✓ Pedido devuelto a Referencias');
    refCompletadosCached = []; // invalidar cache
    refCargar();
  } catch(e) { showToast('⚠ Error: ' + e.message); }
}

// ════════════════════════════════════════════════════
// ══ MÓDULO 3: BULTOS ══
// Carga pedidos en estado 'pendiente_bultos'
// Al completar → estado: 'completado'
// ════════════════════════════════════════════════════
const BUL_TIPOS=[
  {key:'bultos',label:'Bulto(s)'},
  {key:'paletSimple',label:'Palet Simple'},
  {key:'paletDoble',label:'Palet Doble'},
  {key:'estaribel',label:'Estaribel'},
  {key:'jaula',label:'Jaula'}
];
let bulPedidoActivo=null, bulConsol={};

async function bulCargar() {
  const agencia  = document.getElementById('bul-filtro-agencia').value;
  // Si no hay fecha seleccionada, poner mañana por defecto
  const inp = document.getElementById('bul-filtro-fecha');
  if (!inp.value) inp.value = manana();
  const fechaSel = inp.value;
  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('*').eq('estado','pendiente_bultos').order('fecha').order('ts');
    if (error) throw error;
    let todos = data || [];
    if (agencia) todos = todos.filter(p => p.agencia === agencia);

    // Filtrar por la fecha seleccionada
    const peds = todos.filter(p => p.fecha === fechaSel);
    const otrosDias = todos.filter(p => p.fecha !== fechaSel);

    document.getElementById('bul-stats').innerHTML =
      statCard(peds.length, 'Para ' + fmtDate(fechaSel), 'var(--green)') +
      statCard(todos.length, 'Total pendientes', 'var(--amber)') +
      statCard(otrosDias.length, 'Otros días', 'var(--slate-lt)');

    if (!peds.length) {
      document.getElementById('bul-empty').style.display = 'block';
      let msg = '';
      if (otrosDias.length) {
        const fechasOtras = [...new Set(otrosDias.map(p=>fmtDate(p.fecha)))].join(', ');
        msg = `<div style="margin-top:10px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);font-size:12px;color:var(--slate-mid)">
          Hay pedidos pendientes en otras fechas: ${fechasOtras}. Cambia el filtro de fecha para verlos.
        </div>`;
      }
      document.getElementById('bul-lista-items').innerHTML = msg;
    } else {
      document.getElementById('bul-empty').style.display = 'none';
      bulPedidosCached = peds;
      document.getElementById('bul-lista-items').innerHTML = bulRenderItems(peds);
    }
    document.getElementById('bul-lista-sec').style.display = 'block';
    document.getElementById('bul-revision-sec').style.display = 'none';
  } catch(e) { showToast('⚠ Error al cargar bultos'); }
}

function bulFechaHoy()    { document.getElementById('bul-filtro-fecha').value = today();   bulCargar(); }
function bulFechaManana() { document.getElementById('bul-filtro-fecha').value = manana(); bulCargar(); }

async function bulAbrirRevision(id) {
  const {data,error}=await sb.from('pedidos_control').select('*').eq('id',id).single();
  if(error||!data) return;
  bulPedidoActivo=data;
  bulConsol=data.consolidacion_bultos||{bultos:0,paletSimple:0,paletDoble:0,estaribel:0,jaula:0};
  bulRenderRevision();
  document.getElementById('bul-lista-sec').style.display='none';
  document.getElementById('bul-revision-sec').style.display='';
}

function bulRenderRevision() {
  const p=bulPedidoActivo;
  document.getElementById('bul-rev-titulo').textContent='Pedido '+p.num_pedido;
  document.getElementById('bul-rev-agencia').textContent=(p.agencia||'—')+' · Refs controladas: '+fmtDate(p.fecha);
  document.getElementById('bul-rev-obs').value=p.obs_bultos||'';

  // Resumen de referencias
  const refs=(p.refs||[]).filter(r=>!r.excluida);
  const ok=refs.filter(r=>r.estado==='ok').length;
  const inc=refs.filter(r=>r.estado==='incidencia').length;
  const falta=refs.filter(r=>r.estado==='falta').length;
  const consolRefs=bulConsolTexto(p.consolidacion_refs);
  document.getElementById('bul-rev-resumen-refs').innerHTML=`
    <div class="card-label">Resumen de referencias (control del día anterior)</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
      ${statCard(ok,'OK','var(--green)')}${statCard(inc,'Incidencias','var(--amber)')}${statCard(falta,'Faltas','var(--red)')}
    </div>
    ${consolRefs!=='—'?'<div style="font-size:12px;color:var(--slate-mid)"><b>Consolidación estimada:</b> '+consolRefs+'</div>':''}
    ${p.obs_refs?'<div style="font-size:12px;color:var(--slate-mid);margin-top:6px;padding:8px;background:var(--amber-lt);border-radius:var(--radius-sm)">⚠ '+p.obs_refs+'</div>':''}`;

  // Campos de consolidación de bultos
  document.getElementById('bul-consol-campos').innerHTML=BUL_TIPOS.map(t=>`
    <div class="scan-consol-row">
      <span class="scan-consol-label">${t.label}</span>
      <div class="scan-consol-ctrl">
        <button class="scan-consol-btn" onclick="bulAjustar('${t.key}',-1)">−</button>
        <span class="scan-consol-num" id="bulv-${t.key}">${bulConsol[t.key]||0}</span>
        <button class="scan-consol-btn" onclick="bulAjustar('${t.key}',1)">+</button>
      </div>
    </div>`).join('');
  bulActResumen();
}

function bulAjustar(key, delta) {
  bulConsol[key]=Math.max(0,(bulConsol[key]||0)+delta);
  const el=document.getElementById('bulv-'+key);
  if(el) el.textContent=bulConsol[key];
  bulActResumen();
}

function bulConsolTexto(c) {
  if(!c) return '—';
  const labels={bultos:'Bulto(s)',paletSimple:'Palet Simple',paletDoble:'Palet Doble',estaribel:'Estaribel',jaula:'Jaula'};
  const res=Object.entries(c).filter(([,v])=>v>0).map(([k,v])=>v+' '+(labels[k]||k)).join(', ');
  return res||'—';
}

function bulActResumen() {
  document.getElementById('bul-consol-resumen').textContent=bulConsolTexto(bulConsol)||'Sin consolidación asignada';
}

async function bulCompletar() {
  const p   = bulPedidoActivo;
  const obs = document.getElementById('bul-rev-obs').value.trim();

  // Si no tiene agencia asignada, preguntar ahora
  let agencia = p.agencia || '';
  if (!agencia) {
    agencia = await bulPreguntarAgencia(p.num_pedido);
    if (!agencia) return; // canceló
  }

  try {
    const { error } = await sb.from('pedidos_control').update({
      consolidacion_bultos: bulConsol,
      obs_bultos:           obs,
      agencia:              agencia,
      estado:               'completado',
      ts_bultos:            Date.now()
    }).eq('id', p.id);
    if (error) throw error;
    showToast('✓ Pedido ' + p.num_pedido + ' · ' + agencia + ' → Hoja Maestra');
    bulVolverLista();
    bulCargar();
  } catch(e) { showToast('⚠ Error al guardar: ' + e.message); }
}

function bulPreguntarAgencia(numPedido) {
  return new Promise(resolve => {
    // Crear modal inline
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px 16px 0 0;padding:24px 20px 36px;width:100%;max-width:480px">
        <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 18px"></div>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px">¿Qué transporte se lleva este pedido?</div>
        <div style="font-size:12px;color:var(--slate-lt);margin-bottom:18px">Pedido ${numPedido} · Obligatorio para completar</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <button id="_ag_geo" style="padding:16px;border-radius:var(--radius);border:2px solid var(--border);background:var(--bg);font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer"
            onclick="this.closest('.overlay-agencia').dataset.val='Geacargo';this.style.background='var(--green-lt)';this.style.borderColor='var(--green)';document.getElementById('_ag_meth').style.background='var(--bg)';document.getElementById('_ag_meth').style.borderColor='var(--border)'">
            Geacargo
          </button>
          <button id="_ag_meth" style="padding:16px;border-radius:var(--radius);border:2px solid var(--border);background:var(--bg);font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer"
            onclick="this.closest('.overlay-agencia').dataset.val='Method';this.style.background='var(--green-lt)';this.style.borderColor='var(--green)';document.getElementById('_ag_geo').style.background='var(--bg)';document.getElementById('_ag_geo').style.borderColor='var(--border)'">
            Method
          </button>
        </div>
        <button onclick="
          const v=this.closest('.overlay-agencia').dataset.val;
          if(!v){return;}
          this.closest('.overlay-agencia').remove();
          window._bulAgenciaResolve(v);"
          style="width:100%;padding:13px;background:var(--green);color:#fff;border:none;border-radius:var(--radius-sm);font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px">
          Confirmar transporte
        </button>
        <button onclick="this.closest('.overlay-agencia').remove();window._bulAgenciaResolve(null);"
          style="width:100%;padding:11px;background:none;color:var(--slate-mid);border:1px solid var(--border);border-radius:var(--radius-sm);font-family:var(--font);font-size:13px;cursor:pointer">
          Cancelar
        </button>
      </div>`;
    overlay.classList.add('overlay-agencia');
    overlay.dataset.val = '';
    document.body.appendChild(overlay);
    window._bulAgenciaResolve = val => { resolve(val); };
  });
}

function bulVolverLista() {
  document.getElementById('bul-lista-sec').style.display = 'block';
  document.getElementById('bul-revision-sec').style.display = 'none';
  bulCargar();
}

// ── Carpetas de Bultos ──
function bulToggleCarpeta(cual) {
  const panel   = document.getElementById('bul-' + cual + '-panel');
  const chevron = document.getElementById('bul-' + cual + '-chevron');
  const open    = panel.style.display !== 'block';
  panel.style.display     = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  if (open) {
    if (cual === 'completados') bulRenderCompletados();
    if (cual === 'otrosdias')   bulRenderOtrosDias();
  }
}

async function bulRenderCompletados() {
  const lista = document.getElementById('bul-completados-lista');
  const count = document.getElementById('bul-completados-count');
  if (!lista) return;
  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('id,num_pedido,fecha,agencia,estado,consolidacion_bultos,obs_bultos')
      .eq('estado', 'completado')
      .order('ts', { ascending: false })
      .limit(40);
    if (error) throw error;
    const peds = data || [];
    if (count) count.textContent = peds.length ? '(' + peds.length + ')' : '';
    if (!peds.length) {
      lista.innerHTML = '<div class="carpeta-empty">No hay pedidos completados aún.</div>';
      return;
    }
    lista.innerHTML = peds.map(p => `
      <div class="carpeta-row">
        <div class="carpeta-row-info">
          <div class="carpeta-row-title">Pedido ${p.num_pedido}</div>
          <div class="carpeta-row-meta">
            ${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)} · ${bulConsolTexto(p.consolidacion_bultos)||'Sin consolidación'}
          </div>
        </div>
        <span class="badge badge-ok">Completo</span>
        <button onclick="bulAbrirRevision('${p.id}')"
          style="background:var(--bg);color:var(--slate-mid);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">
          Ver ›
        </button>
      </div>`).join('');
  } catch(e) { console.error('bulRenderCompletados:', e); }
}

async function bulRenderOtrosDias() {
  const lista    = document.getElementById('bul-otrosdias-lista');
  const count    = document.getElementById('bul-otrosdias-count');
  const fechaSel = document.getElementById('bul-filtro-fecha').value || manana();
  if (!lista) return;
  try {
    const { data, error } = await sb.from('pedidos_control')
      .select('id,num_pedido,fecha,agencia,estado,refs')
      .eq('estado', 'pendiente_bultos')
      .neq('fecha', fechaSel)
      .order('fecha', { ascending: true });
    if (error) throw error;
    const peds = data || [];
    if (count) count.textContent = peds.length ? '(' + peds.length + ')' : '';
    if (!peds.length) {
      lista.innerHTML = '<div class="carpeta-empty">Sin pedidos pendientes en otros días.</div>';
      return;
    }
    lista.innerHTML = peds.map(p => `
      <div class="carpeta-row">
        <div class="carpeta-row-info">
          <div class="carpeta-row-title">Pedido ${p.num_pedido}</div>
          <div class="carpeta-row-meta">${p.agencia||'—'} · Entrega ${fmtDate(p.fecha)}</div>
        </div>
        <span class="badge badge-warn">Pendiente</span>
        <button onclick="bulAbrirRevision('${p.id}')"
          style="background:var(--amber-lt);color:var(--amber);border:none;border-radius:var(--radius-sm);padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">
          Forzar ›
        </button>
      </div>`).join('');
  } catch(e) { console.error('bulRenderOtrosDias:', e); }
}

// ════════════════════════════════════════════════════
// ══ MÓDULO 4: HOJA MAESTRA ══
// Muestra pedidos completados, filtrados por fecha/agencia
// ════════════════════════════════════════════════════
// ── Buscador de pedidos en todas las hojas maestras ──
let mstBuscarTimer = null;

function mstBuscarDebounce() {
  clearTimeout(mstBuscarTimer);
  const q = document.getElementById('mst-buscar').value.trim();
  document.getElementById('mst-buscar-clear').style.display = q ? '' : 'none';
  if (!q) { document.getElementById('mst-buscar-results').style.display = 'none'; return; }
  mstBuscarTimer = setTimeout(() => mstBuscar(q), 350);
}

function mstBuscarLimpiar() {
  document.getElementById('mst-buscar').value = '';
  document.getElementById('mst-buscar-clear').style.display = 'none';
  document.getElementById('mst-buscar-results').style.display = 'none';
}

async function mstBuscar(q) {
  const box = document.getElementById('mst-buscar-results');
  box.style.display = 'block';
  box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--slate-lt)">Buscando…</div>';

  try {
    // Buscar el número de pedido en toda la tabla (parcial o completo)
    const { data, error } = await sb.from('pedidos_control')
      .select('id,num_pedido,fecha,agencia,estado,refs,ts_refs,ts_bultos')
      .ilike('num_pedido', '%' + q + '%')
      .order('fecha', { ascending: false })
      .limit(20);
    if (error) throw error;

    const peds = data || [];
    if (!peds.length) {
      box.innerHTML = `<div class="sr-empty">Sin resultados para "<b>${q}</b>"</div>`;
      return;
    }

    box.innerHTML = peds.map(p => {
      const tieneRefs  = p.estado === 'pendiente_bultos' || p.estado === 'completado';
      const tieneBul   = p.estado === 'completado';
      const refs       = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
      const okRefs     = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;

      const badgeRefs = tieneRefs
        ? `<span style="background:var(--green-lt);color:var(--green);padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">✓ Refs ${okRefs}/${refs.length}</span>`
        : `<span style="background:var(--border);color:var(--slate-lt);padding:2px 7px;border-radius:10px;font-size:10px">○ Sin refs</span>`;

      const badgeBul = tieneBul
        ? `<span style="background:var(--green-lt);color:var(--green);padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">✓ Bultos</span>`
        : `<span style="background:var(--border);color:var(--slate-lt);padding:2px 7px;border-radius:10px;font-size:10px">○ Sin bultos</span>`;

      return `<div class="sr-item" onclick="mstIrAFecha('${p.fecha}')">
        <div class="sr-dot ${tieneBul?'sr-dot-carga':tieneRefs?'sr-dot-pedido':'sr-dot-inc'}"></div>
        <div class="sr-body">
          <div class="sr-title">Pedido ${p.num_pedido}</div>
          <div class="sr-sub" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
            ${badgeRefs} ${badgeBul}
          </div>
        </div>
        <div class="sr-right">
          <div class="sr-fecha">${fmtDate(p.fecha)}</div>
          <div class="sr-tipo">${p.agencia||'—'}</div>
        </div>
      </div>`;
    }).join('');

  } catch(e) {
    box.innerHTML = `<div class="sr-empty">⚠ Error al buscar</div>`;
    console.error('mstBuscar:', e);
  }
}

function mstIrAFecha(fecha) {
  // Navegar a esa fecha en la hoja maestra y cargarla
  document.getElementById('mst-fecha').value = fecha;
  document.getElementById('mst-buscar-results').style.display = 'none';
  document.getElementById('mst-buscar').value = '';
  document.getElementById('mst-buscar-clear').style.display = 'none';
  mstCargar();
}

function mstInit() {
  const inp = document.getElementById('mst-fecha');
  if (!inp.value) inp.value = today();
  mstCargar();
}

async function mstCargar() {
  const fecha   = document.getElementById('mst-fecha').value || today();
  const agencia = document.getElementById('mst-agencia').value;

  // Calcular día anterior a la fecha seleccionada
  const dFecha = new Date(fecha + 'T00:00:00');
  dFecha.setDate(dFecha.getDate() - 1);
  const fechaAyer = dFecha.toISOString().slice(0, 10);

  document.getElementById('mst-titulo').textContent =
    'Hoja Maestra · ' + fmtDate(fecha);
  document.getElementById('mst-subtitulo').textContent =
    (agencia ? 'Agencia: ' + agencia + ' · ' : '') +
    'Refs: ' + fmtDate(fechaAyer) + ' · Bultos: ' + fmtDate(fecha);

  document.getElementById('mst-loading').style.display = 'block';
  document.getElementById('mst-empty').style.display = 'none';
  document.getElementById('mst-bloque-refs').style.display = 'none';
  document.getElementById('mst-bloque-bultos').style.display = 'none';

  try {
    // ── BLOQUE REFS: pedidos cuya fecha de entrega es HOY (fecha sel.)
    //    y que tienen estado pendiente_bultos o completado
    //    (es decir, ya pasaron por control de referencias el día anterior)
    const { data: dataRefs, error: errRefs } = await sb.from('pedidos_control')
      .select('*')
      .eq('fecha', fecha)
      .in('estado', ['pendiente_bultos', 'completado'])
      .order('ts');
    if (errRefs) throw errRefs;

    // ── BLOQUE BULTOS: pedidos completados ese mismo día (fecha sel.)
    //    ts_bultos debe existir y corresponder a ese día
    const { data: dataBul, error: errBul } = await sb.from('pedidos_control')
      .select('*')
      .eq('fecha', fecha)
      .eq('estado', 'completado')
      .order('ts', { ascending: true });
    if (errBul) throw errBul;

    let pedsRefs = dataRefs || [];
    let pedsBul  = dataBul  || [];

    if (agencia) {
      pedsRefs = pedsRefs.filter(p => p.agencia === agencia);
      pedsBul  = pedsBul.filter(p => p.agencia === agencia);
    }

    document.getElementById('mst-loading').style.display = 'none';

    if (!pedsRefs.length && !pedsBul.length) {
      document.getElementById('mst-empty').style.display = 'block';
      return;
    }

    if (pedsRefs.length) {
      mstRenderRefs(pedsRefs);
      document.getElementById('mst-bloque-refs').style.display = 'block';
    }
    if (pedsBul.length) {
      mstRenderBultos(pedsBul);
      document.getElementById('mst-bloque-bultos').style.display = 'block';
    }

  } catch(e) {
    document.getElementById('mst-loading').style.display = 'none';
    showToast('⚠ Error: ' + (e.message || JSON.stringify(e)));
    console.error('mstCargar:', e);
  }
}

// ── Paginación: max 10 filas por página ──
const MST_PG_SIZE = 10;
let mstPageRefs = 0;
let mstPageBul  = 0;
let mstDataRefs = [];
let mstDataBul  = [];

function mstCheckIcon(ok) {
  return ok
    ? '<span class="mst-check ok">✓</span>'
    : '<span class="mst-check pend">○</span>';
}

function mstRenderRefs(peds) {
  mstDataRefs = peds;
  mstPageRefs = 0;
  mstPintarRefs();
}

function mstPintarRefs() {
  const total  = mstDataRefs.length;
  const inicio = mstPageRefs * MST_PG_SIZE;
  const fin    = Math.min(inicio + MST_PG_SIZE, total);
  const pagina = mstDataRefs.slice(inicio, fin);
  const totalPags = Math.ceil(total / MST_PG_SIZE);

  document.getElementById('mst-tbody-refs').innerHTML = pagina.map(p => {
    const refs = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
    const ok   = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
    const inc  = refs.filter(r => ['incidencia','falta'].includes(r.estado_ctrl || '')).length;
    const obsRef = [p.obs_refs, inc ? inc + ' incid.' : ''].filter(Boolean).join(' · ') || '—';
    return `<tr>
      <td class="mst-td-pedido">${p.num_pedido}</td>
      <td>${p.agencia || '—'}</td>
      <td class="mst-td-center">${ok}/${refs.length}</td>
      <td class="mst-td-center">${mstCheckIcon(ok === refs.length && refs.length > 0)}</td>
      <td>${bulConsolTexto(p.consolidacion_refs) || '—'}</td>
      <td class="mst-td-obs">${obsRef}</td>
    </tr>`;
  }).join('');

  mstRenderPager('refs', mstPageRefs, totalPags, true);
}

function mstRenderBultos(peds) {
  mstDataBul = peds;
  mstPageBul = 0;
  mstPintarBultos();
}

function mstPintarBultos() {
  const total  = mstDataBul.length;
  const inicio = mstPageBul * MST_PG_SIZE;
  const fin    = Math.min(inicio + MST_PG_SIZE, total);
  const pagina = mstDataBul.slice(inicio, fin);
  const totalPags = Math.ceil(total / MST_PG_SIZE);

  document.getElementById('mst-tbody-bultos').innerHTML = pagina.map(p => {
    const c      = p.consolidacion_bultos || {};
    const bultos = c.bultos || 0;
    const palets = (c.paletSimple || 0) + (c.paletDoble || 0);
    const otros  = [
      c.estaribel > 0 ? c.estaribel + ' Estaribel' : '',
      c.jaula > 0     ? c.jaula + ' Jaula'          : ''
    ].filter(Boolean).join(', ') || '—';
    const obsBul = p.obs_bultos || '—';
    return `<tr>
      <td class="mst-td-pedido">${p.num_pedido}</td>
      <td>${p.agencia || '—'}</td>
      <td>${bulConsolTexto(c)}</td>
      <td class="mst-td-center">${bultos || '—'}</td>
      <td class="mst-td-center">${palets || '—'}</td>
      <td>${otros}</td>
      <td class="mst-td-center">${mstCheckIcon(true)}</td>
      <td class="mst-td-obs">${obsBul}</td>
    </tr>`;
  }).join('');

  mstRenderPager('bultos', mstPageBul, totalPags, false);
}

function mstPrevRefs()   { if (mstPageRefs > 0) { mstPageRefs--; mstPintarRefs(); } }
function mstNextRefs()   { if (mstPageRefs < Math.ceil(mstDataRefs.length / MST_PG_SIZE) - 1) { mstPageRefs++; mstPintarRefs(); } }
function mstPrevBultos() { if (mstPageBul  > 0) { mstPageBul--;  mstPintarBultos(); } }
function mstNextBultos() { if (mstPageBul  < Math.ceil(mstDataBul.length  / MST_PG_SIZE) - 1) { mstPageBul++;  mstPintarBultos(); } }

function mstRenderPager(bloque, paginaActual, totalPags, esRefs) {
  const pid  = 'mst-pager-' + bloque;
  const prev = esRefs ? 'mstPrevRefs()' : 'mstPrevBultos()';
  const next = esRefs ? 'mstNextRefs()' : 'mstNextBultos()';
  const total = esRefs ? mstDataRefs.length : mstDataBul.length;
  let el = document.getElementById(pid);
  if (!el) {
    el = document.createElement('div');
    el.id = pid;
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 0 4px;font-size:12px;color:var(--slate-lt)';
    const wrap = document.getElementById('mst-bloque-' + bloque);
    if (wrap) wrap.appendChild(el);
  }
  if (totalPags <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button onclick="${prev}" ${paginaActual===0?'disabled':''}
      style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 12px;cursor:pointer;font-family:var(--font);font-size:12px;color:var(--slate-mid)">
      ‹ Anterior</button>
    <span>Pág. ${paginaActual+1} / ${totalPags} · ${total} pedidos</span>
    <button onclick="${next}" ${paginaActual>=totalPags-1?'disabled':''}
      style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 12px;cursor:pointer;font-family:var(--font);font-size:12px;color:var(--slate-mid)">
      Siguiente ›</button>`;
}

function mstExportarPDF() {
  const fecha   = document.getElementById('mst-fecha').value || today();
  const agencia = document.getElementById('mst-agencia').value;

  // Toma TODOS los datos — no solo la página visible
  const refsRows  = mstDataRefs.map(p => {
    const refs = (p.refs || []).filter(r => !r.excluida && !r.excluida_manual);
    const ok   = refs.filter(r => (r.estado_ctrl || '') === 'ok').length;
    const inc  = refs.filter(r => ['incidencia','falta'].includes(r.estado_ctrl || '')).length;
    const obs  = [p.obs_refs, inc ? inc + ' incid.' : ''].filter(Boolean).join(' · ') || '—';
    const check = ok === refs.length && refs.length > 0 ? '<span class="ok">✓</span>' : '<span class="pend">○</span>';
    return `<tr>
      <td>${p.num_pedido}</td><td>${p.agencia||'—'}</td>
      <td style="text-align:center">${ok}/${refs.length}</td>
      <td style="text-align:center">${check}</td>
      <td>${bulConsolTexto(p.consolidacion_refs)||'—'}</td>
      <td>${obs}</td>
    </tr>`;
  }).join('');

  const bultosRows = mstDataBul.map(p => {
    const c      = p.consolidacion_bultos || {};
    const bultos = c.bultos || 0;
    const palets = (c.paletSimple || 0) + (c.paletDoble || 0);
    const otros  = [c.estaribel>0?c.estaribel+' Estaribel':'', c.jaula>0?c.jaula+' Jaula':''].filter(Boolean).join(', ') || '—';
    return `<tr>
      <td>${p.num_pedido}</td><td>${p.agencia||'—'}</td>
      <td>${bulConsolTexto(c)}</td>
      <td style="text-align:center">${bultos||'—'}</td>
      <td style="text-align:center">${palets||'—'}</td>
      <td>${otros}</td>
      <td style="text-align:center"><span class="ok">✓</span></td>
      <td>${p.obs_bultos||'—'}</td>
    </tr>`;
  }).join('');

  const cabecera = (titulo, sub) => `
    <div class="ph">
      <div>
        <div class="pe">Leroy Merlin Las Rozas</div>
        <div class="pm">Contrapoder · ${titulo}${agencia?' · '+agencia:''}</div>
      </div>
      <div class="pf">${fmtDate(fecha)}<br><span style="font-size:9px;color:#94A3B8">${sub}</span></div>
    </div>`;

  const estilos = `<style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;font-size:10px;color:#1E293B;}
    .page{padding:18px;min-height:100vh;}
    .page-break{page-break-after:always;break-after:page;}
    .ph{display:flex;justify-content:space-between;align-items:flex-start;
        margin-bottom:14px;border-bottom:2px solid #006B3C;padding-bottom:10px;}
    .pe{font-size:14px;font-weight:700;color:#006B3C;}
    .pm{font-size:10px;color:#475569;margin-top:3px;}
    .pf{font-size:12px;font-weight:600;text-align:right;}
    .bt{font-size:11px;font-weight:700;color:#006B3C;margin:0 0 8px;
        padding:5px 8px;background:#E8F4EE;border-radius:3px;}
    table{width:100%;border-collapse:collapse;}
    th{background:#006B3C;color:#fff;padding:5px 7px;text-align:left;
       font-size:9px;font-weight:600;white-space:nowrap;}
    td{padding:5px 7px;border-bottom:1px solid #E2E8F0;
       font-size:9px;vertical-align:top;}
    tr:nth-child(even) td{background:#F8FAFC;}
    .ok{color:#006B3C;font-weight:700;}
    .pend{color:#94A3B8;}
    .ft{margin-top:14px;font-size:8px;color:#94A3B8;
        text-align:center;border-top:1px solid #E2E8F0;padding-top:6px;}
    @media print{
      .page-break{page-break-after:always;break-after:page;}
      @page{margin:10mm;}
    }
  </style>`;

  const gen = new Date().toLocaleString('es-ES');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Hoja Maestra ${fmtDate(fecha)}</title>${estilos}</head><body>

    <!-- CARA 1: Control de Referencias -->
    <div class="page page-break">
      ${cabecera('Control de Referencias', 'Cara 1 de 2 · ' + gen)}
      <div class="bt">① Control de Referencias · ${mstDataRefs.length} pedido${mstDataRefs.length!==1?'s':''}</div>
      <table>
        <thead><tr>
          <th>Nº Pedido</th><th>Agencia</th><th>Refs</th>
          <th>Check</th><th>Consolidación</th><th>Observaciones</th>
        </tr></thead>
        <tbody>${refsRows || '<tr><td colspan="6" style="text-align:center;color:#94A3B8">Sin datos de referencias para esta fecha</td></tr>'}</tbody>
      </table>
      <div class="ft">Contrapoder · Leroy Merlin Las Rozas · ${fmtDate(fecha)} · Cara 1/2</div>
    </div>

    <!-- CARA 2: Control de Bultos -->
    <div class="page">
      ${cabecera('Control de Bultos', 'Cara 2 de 2 · ' + gen)}
      <div class="bt">② Control de Bultos · ${mstDataBul.length} pedido${mstDataBul.length!==1?'s':''}</div>
      <table>
        <thead><tr>
          <th>Nº Pedido</th><th>Agencia</th><th>Consolidación</th>
          <th>Bultos</th><th>Palets</th><th>Otros</th><th>Check</th><th>Observaciones</th>
        </tr></thead>
        <tbody>${bultosRows || '<tr><td colspan="8" style="text-align:center;color:#94A3B8">Sin datos de bultos para esta fecha</td></tr>'}</tbody>
      </table>
      <div class="ft">Contrapoder · Leroy Merlin Las Rozas · ${fmtDate(fecha)} · Cara 2/2</div>
    </div>

  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ════════════════════════════════════════════════════
// ══ MÓDULO 5: CALENDARIO (fotos e incidencias) ══
// ════════════════════════════════════════════════════
function fotoUrl(f){if(!f)return '';if(f.dataUrl)return f.dataUrl;if(f.path)return sb.storage.from(BUCKET).getPublicUrl(f.path).data.publicUrl;return '';}
function slotFor(t){const s=(t||'').toLowerCase();if(s==='geacargo')return 'gea';if(s==='method')return 'method';return 'otro';}
function dataUrlToBlob(d){const[h,b]=d.split(',');const m=(h.match(/data:([^;]+)/)||[,'image/jpeg'])[1];const bin=atob(b);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:m});}
async function uploadFotos(fotos,fecha,slot,id){const out=[];for(let i=0;i<fotos.length;i++){const f=fotos[i];if(f.path){out.push({path:f.path,nombre:f.nombre||''});continue;}const blob=dataUrlToBlob(f.dataUrl);const ext=blob.type.includes('png')?'png':'jpg';const path=`${fecha}/${slot}/${id}_${Date.now().toString(36)}_${i}.${ext}`;const{error}=await sb.storage.from(BUCKET).upload(path,blob,{contentType:blob.type,upsert:true});if(error)throw error;out.push({path,nombre:f.nombre||''});}return out;}
async function borrarFotosStorage(paths){const l=(paths||[]).filter(Boolean);if(!l.length)return;try{await sb.storage.from(BUCKET).remove(l);}catch(e){}}

let state={cargas:{},incidencias:{}};
async function loadMonth(y,m){
  try{
    const pref=y+'-'+String(m+1).padStart(2,'0');
    const f1=pref+'-01';const f2=(m===11?(y+1)+'-01':y+'-'+String(m+2).padStart(2,'0'))+'-01';
    const[rC,rI]=await Promise.all([sb.from('cargas').select('*').gte('fecha',f1).lt('fecha',f2),sb.from('incidencias').select('*').gte('fecha',f1).lt('fecha',f2)]);
    if(rC.error)throw rC.error;if(rI.error)throw rI.error;
    Object.keys(state.cargas).forEach(k=>{if(k.startsWith(pref))delete state.cargas[k];});
    Object.keys(state.incidencias).forEach(k=>{if(k.startsWith(pref))delete state.incidencias[k];});
    (rC.data||[]).forEach(r=>{(state.cargas[r.fecha]=state.cargas[r.fecha]||[]).push({id:r.id,transporte:r.transporte,camion:r.camion,titulo:r.titulo,notas:r.notas,fotos:Array.isArray(r.fotos)?r.fotos:[],ts:Number(r.ts)||0});});
    (rI.data||[]).forEach(r=>{(state.incidencias[r.fecha]=state.incidencias[r.fecha]||[]).push({id:r.id,titulo:r.titulo,transporte:r.transporte,ref:r.ref_info,descripcion:r.descripcion,fotos:Array.isArray(r.fotos)?r.fotos:[],ts:Number(r.ts)||0});});
  }catch(e){showToast('⚠ Sin conexión. Modo offline.');}
}

const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS=['L','M','X','J','V','S','D'];
let calY,calM,selDate=null;

async function renderCal(){const now=new Date();if(calY===undefined){calY=now.getFullYear();calM=now.getMonth();}await loadMonth(calY,calM);paintCal();if(selDate)renderDayPanel(selDate);}
async function cambiarMes(dir){calM+=dir;if(calM<0){calM=11;calY--;}if(calM>11){calM=0;calY++;}await loadMonth(calY,calM);paintCal();if(selDate){const[sy,sm]=selDate.split('-').map(Number);if(sy!==calY||sm-1!==calM){selDate=null;document.getElementById('dayPanel').innerHTML=''}}}
function paintCal(){
  document.getElementById('calTitle').textContent=MESES[calM]+' '+calY;
  const first=new Date(calY,calM,1).getDay();const offset=first===0?6:first-1;const days=new Date(calY,calM+1,0).getDate();const ts=today();
  let html=DIAS.map(d=>'<div class="cal-daylabel">'+d+'</div>').join('');
  for(let i=0;i<offset;i++)html+='<div class="cal-cell empty"></div>';
  for(let d=1;d<=days;d++){const ds=calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');const ca=state.cargas[ds]||[];const ic=state.incidencias[ds]||[];const hG=ca.some(c=>c.transporte==='Geacargo');const hM=ca.some(c=>c.transporte==='Method');const hI=ic.length>0;let cls='cal-cell';if(ds===ts)cls+=' today';if(ds===selDate)cls+=' selected';else if(hI)cls+=' has-inc';else if(hG&&hM)cls+=' has-both';else if(hG)cls+=' has-geo';else if(hM)cls+=' has-meth';let dots='';if(hG||hM||hI){dots='<div class="cal-dots">'+(hG?'<div class="cal-dot cal-dot-geo"></div>':'')+(hM?'<div class="cal-dot cal-dot-meth"></div>':'')+(hI?'<div class="cal-dot cal-dot-inc"></div>':'')+'</div>';}html+='<div class="'+cls+'" onclick="selectDay(\''+ds+'\')">'+d+dots+'</div>';}
  document.getElementById('calGrid').innerHTML=html;
}
function selectDay(ds){selDate=ds;paintCal();renderDayPanel(ds);setTimeout(()=>document.getElementById('dayPanel').scrollIntoView({behavior:'smooth',block:'nearest'}),50);}

let activeDayTab='geo';
function renderDayPanel(ds){
  const ca=state.cargas[ds]||[];
  const ic=state.incidencias[ds]||[];
  const geo=ca.filter(c=>c.transporte==='Geacargo');
  const meth=ca.filter(c=>c.transporte==='Method');
  const icCarga    = ic.filter(i=>(i.tipo_inc||'carga')==='carga');
  const icPost     = ic.filter(i=>i.tipo_inc==='postcarga');
  const bCarga     = icCarga.length   ? ` <span class="tab-badge">${icCarga.length}</span>`  : '';
  const bPost      = icPost.length    ? ` <span class="tab-badge tab-badge-purple">${icPost.length}</span>` : '';

  document.getElementById('dayPanel').innerHTML=`<div class="day-panel">
    <div class="day-panel-header">
      <h3>${fmtDate(ds)}</h3>
      <span class="day-panel-date">${ca.length} carga${ca.length!==1?'s':''} · ${ic.length} incid.</span>
    </div>
    <div class="day-actions">
      <button class="day-act-btn day-act-carga" onclick="openCargaModal(null,'${ds}')">+ Subir fotos</button>
      <button class="day-act-btn day-act-inc"   onclick="openIncModal(null,'${ds}')">⚠ Incidencia</button>
    </div>
    <div class="day-tabs">
      <button class="day-tab ${activeDayTab==='geo'?'active':''}"      onclick="switchDayTab('geo','${ds}')">Geacargo${geo.length?' ('+geo.length+')':''}</button>
      <button class="day-tab ${activeDayTab==='meth'?'active':''}"     onclick="switchDayTab('meth','${ds}')">Method${meth.length?' ('+meth.length+')':''}</button>
      <button class="day-tab day-tab-inc ${activeDayTab==='inc-carga'?'active':''}"    onclick="switchDayTab('inc-carga','${ds}')">🚛 En carga${bCarga}</button>
      <button class="day-tab day-tab-inc ${activeDayTab==='inc-post'?'active':''}"     onclick="switchDayTab('inc-post','${ds}')">↩ Post-carga${bPost}</button>
    </div>
    <div class="day-tab-content">
      <div class="day-tab-panel ${activeDayTab==='geo'?'active':''}"       id="panel-geo">${renderTransportTab(geo,'Geacargo',ds)}</div>
      <div class="day-tab-panel ${activeDayTab==='meth'?'active':''}"      id="panel-meth">${renderTransportTab(meth,'Method',ds)}</div>
      <div class="day-tab-panel ${activeDayTab==='inc-carga'?'active':''}" id="panel-inc-carga">${renderIncSubTab(icCarga,'carga',ds)}</div>
      <div class="day-tab-panel ${activeDayTab==='inc-post'?'active':''}"  id="panel-inc-post">${renderIncSubTab(icPost,'postcarga',ds)}</div>
    </div>
  </div>`;
}
function switchDayTab(t,ds){activeDayTab=t;renderDayPanel(ds);}
function renderTransportTab(ca,nom,ds){
  if(!ca.length)return`<div class="empty-transport"><div class="empty-transport-icon">🚛</div><h4>Sin imágenes de ${nom}</h4><p>No se han subido fotos de la carga de ${nom} para este día.</p><button class="btn btn-ghost" style="max-width:200px;padding:9px 14px;font-size:12px" onclick="openCargaModalPre(null,'${ds}','${nom}')">+ Subir fotos de ${nom}</button></div>`;
  return ca.map(c=>{const fo=c.fotos||[];const th=fo.length?'<div class="photo-grid">'+fo.map((f,i)=>`<div class="photo-thumb" onclick="openViewer('${ds}','${c.id}',${i})"><img src="${fotoUrl(f)}" alt="" loading="lazy"><div class="photo-lupa" onclick="event.stopPropagation();openViewer('${ds}','${c.id}',${i})">🔍</div></div>`).join('')+'</div>':'<div style="font-size:12px;color:var(--slate-lt);padding:10px 0">Sin fotos</div>';const no=c.notas?`<div style="font-size:12px;color:var(--slate-mid);padding:8px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:8px;line-height:1.5">${c.notas}</div>`:'';return`<div class="carga-card"><div class="carga-card-header"><div><div class="carga-card-title">${c.camion||nom}${c.titulo?' · '+c.titulo:''}</div><div class="carga-card-sub">${fo.length} foto${fo.length!==1?'s':''}</div></div><div class="carga-card-actions"><button class="btn-sm" style="background:var(--bg);color:var(--slate-mid);border:1px solid var(--border)" onclick="openCargaModal('${c.id}','${ds}')">Editar</button><button class="btn-sm" style="background:var(--red-lt);color:var(--red)" onclick="delCarga('${ds}','${c.id}')">Borrar</button></div></div>${no}${th}</div>`;}).join('');
}
function renderIncSubTab(ic, tipo, ds) {
  const esPost = tipo === 'postcarga';
  const color  = esPost ? '#7C3AED' : 'var(--red)';
  const etiq   = esPost ? '↩ Post-carga · Retorno a tienda' : '🚛 Incidencias en carga';
  const placeholder = esPost ? 'pedido devuelto, entrega fallida…' : 'bulto dañado, falta producto…';

  if (!ic.length) return `<div class="empty-transport">
    <div style="font-size:30px;opacity:0.25;margin-bottom:10px">${esPost ? '↩' : '🚛'}</div>
    <h4>Sin incidencias ${esPost ? 'post-carga' : 'en carga'}</h4>
    <p style="margin-bottom:14px">No hay registros de este tipo para este día.</p>
    <button class="btn btn-ghost" style="max-width:240px;padding:9px 14px;font-size:12px;color:${color};border-color:${color}"
      onclick="openIncModalTipo('${tipo}',null,'${ds}')">+ Registrar ${esPost?'post-carga':'incidencia en carga'}</button>
  </div>`;

  return ic.map(inc => {
    const fo = inc.fotos || [];
    const th = fo.length
      ? '<div class="photo-grid" style="margin-top:8px">'
        + fo.map((f,i) => `<div class="photo-thumb" onclick="openViewerInc('${ds}','${inc.id}',${i})">
            <img src="${fotoUrl(f)}" alt="" loading="lazy">
            <div class="photo-lupa" onclick="event.stopPropagation();openViewerInc('${ds}','${inc.id}',${i})">🔍</div>
          </div>`).join('') + '</div>'
      : '';
    return `<div class="inc-card" style="border-left:3px solid ${color}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1">
          <div class="inc-card-title">${inc.titulo}</div>
          <div class="inc-card-transport">${[inc.transporte,inc.ref].filter(Boolean).join(' · ')}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn-sm" style="background:var(--bg);color:var(--slate-mid);border:1px solid var(--border)"
            onclick="openIncModal('${inc.id}','${ds}')">Editar</button>
          <button class="btn-sm" style="background:var(--red-lt);color:var(--red)"
            onclick="delInc('${ds}','${inc.id}')">Borrar</button>
        </div>
      </div>
      ${inc.descripcion ? '<div class="inc-card-desc">' + inc.descripcion + '</div>' : ''}
      ${th}
    </div>`;
  }).join('')
  + `<button class="btn btn-ghost" style="margin-top:12px;color:${color};border-color:${color};font-size:12px;padding:9px"
      onclick="openIncModalTipo('${tipo}',null,'${ds}')">+ Añadir</button>`;
}

// Abre el modal con tipo preseleccionado
function openIncModalTipo(tipo, id, ds) {
  openIncModal(id, ds);
  setTimeout(() => setIncTipo(tipo), 50);
}

// Modales calendario
let cargaCtx={dateStr:null,id:null,fotos:[]};
function openCargaModal(id,ds,pre){cargaCtx={dateStr:ds,id,fotos:[]};document.getElementById('cargaFotoInput').value='';document.getElementById('cargaModalSub').textContent=fmtDate(ds);if(id){const c=(state.cargas[ds]||[]).find(x=>x.id===id);if(!c)return;document.getElementById('cargaModalTitle').textContent='Editar carga';document.getElementById('cm-transport').value=c.transporte;document.getElementById('cm-camion').value=c.camion||'';document.getElementById('cm-titulo').value=c.titulo||'';document.getElementById('cm-notas').value=c.notas||'';cargaCtx.fotos=c.fotos?[...c.fotos]:[];}else{document.getElementById('cargaModalTitle').textContent='Subir fotos de carga';document.getElementById('cm-transport').value=pre||'Geacargo';document.getElementById('cm-camion').value=document.getElementById('cm-titulo').value=document.getElementById('cm-notas').value='';}renderCargaPreview();document.getElementById('cargaModal').classList.add('open');}
function openCargaModalPre(id,ds,t){openCargaModal(id,ds,t);}
function closeCargaModal(){document.getElementById('cargaModal').classList.remove('open');}
function onCargaFotos(files){Array.from(files).forEach(f=>{const r=new FileReader();r.onload=e=>compressImage(e.target.result,1200,0.75,d=>{cargaCtx.fotos.push({dataUrl:d,nombre:f.name});renderCargaPreview();});r.readAsDataURL(f);});}
function renderCargaPreview(){document.getElementById('cargaPreview').innerHTML=cargaCtx.fotos.map((f,i)=>`<div class="preview-item"><img src="${fotoUrl(f)}" alt=""><button class="preview-remove" onclick="removeCargaFoto(${i})">✕</button></div>`).join('');}
function removeCargaFoto(i){cargaCtx.fotos.splice(i,1);renderCargaPreview();}
async function guardarCarga(){const ds=cargaCtx.dateStr;if(!ds)return;const id=cargaCtx.id||uid();const tr=document.getElementById('cm-transport').value;const ca=document.getElementById('cm-camion').value.trim();const ti=document.getElementById('cm-titulo').value.trim();const no=document.getElementById('cm-notas').value.trim();const prev=(state.cargas[ds]||[]).find(x=>x.id===id);const pp=(prev?.fotos||[]).filter(f=>f.path).map(f=>f.path);const op={id,transporte:tr,camion:ca,titulo:ti,notas:no,fotos:[...cargaCtx.fotos],ts:Date.now()};if(!state.cargas[ds])state.cargas[ds]=[];const ix=state.cargas[ds].findIndex(x=>x.id===id);if(ix>=0)state.cargas[ds][ix]=op;else state.cargas[ds].push(op);closeCargaModal();renderDayPanel(ds);paintCal();showToast('Guardando…');try{const fo=await uploadFotos(cargaCtx.fotos,ds,slotFor(tr),id);const{error}=await sb.from('cargas').upsert({id,fecha:ds,transporte:tr,camion:ca,titulo:ti,notas:no,fotos:fo,ts:op.ts});if(error)throw error;const keep=new Set(fo.map(f=>f.path));await borrarFotosStorage(pp.filter(p=>!keep.has(p)));const sv={id,transporte:tr,camion:ca,titulo:ti,notas:no,fotos:fo,ts:op.ts};const j=state.cargas[ds].findIndex(x=>x.id===id);if(j>=0)state.cargas[ds][j]=sv;renderDayPanel(ds);paintCal();showToast('✓ Carga guardada · '+fo.length+' foto'+(fo.length!==1?'s':''));}catch(e){showToast('⚠ Error al guardar. Reintenta.');}}
async function delCarga(ds,id){if(!confirm('¿Eliminar esta carga y sus fotos?'))return;const en=(state.cargas[ds]||[]).find(x=>x.id===id);state.cargas[ds]=(state.cargas[ds]||[]).filter(x=>x.id!==id);if(!state.cargas[ds].length)delete state.cargas[ds];renderDayPanel(ds);paintCal();try{const{error}=await sb.from('cargas').delete().eq('id',id);if(error)throw error;await borrarFotosStorage((en?.fotos||[]).filter(f=>f.path).map(f=>f.path));showToast('Carga eliminada');}catch(e){showToast('⚠ Error al eliminar');}}

// ── Tipo de incidencia ──
let incTipoActual = 'carga';
function setIncTipo(tipo) {
  incTipoActual = tipo;
  document.getElementById('inc-tipo-carga').classList.toggle('active', tipo === 'carga');
  document.getElementById('inc-tipo-postcarga').classList.toggle('active', tipo === 'postcarga');
}

let incCtx={dateStr:null,id:null,fotos:[]};
function openIncModal(id,ds){
  incCtx={dateStr:ds,id,fotos:[]};
  document.getElementById('incFotoInput').value='';
  document.getElementById('incModalSub').textContent=fmtDate(ds);
  if(id){
    const ic=(state.incidencias[ds]||[]).find(x=>x.id===id);
    if(!ic) return;
    document.getElementById('incModalTitle').textContent='Editar incidencia';
    document.getElementById('im-titulo').value=ic.titulo||'';
    document.getElementById('im-transport').value=ic.transporte||'';
    document.getElementById('im-ref').value=ic.ref||'';
    document.getElementById('im-desc').value=ic.descripcion||'';
    incTipoActual = ic.tipo_inc || 'carga';
    incCtx.fotos=ic.fotos?[...ic.fotos]:[];
  }else{
    document.getElementById('incModalTitle').textContent='Registrar incidencia';
    ['im-titulo','im-ref','im-desc'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('im-transport').value='';
    incTipoActual = 'carga';
  }
  setIncTipo(incTipoActual);
  renderIncPreview();
  document.getElementById('incModal').classList.add('open');
}
function closeIncModal(){document.getElementById('incModal').classList.remove('open');}
function onIncFotos(files){Array.from(files).forEach(f=>{const r=new FileReader();r.onload=e=>compressImage(e.target.result,1200,0.75,d=>{incCtx.fotos.push({dataUrl:d,nombre:f.name});renderIncPreview();});r.readAsDataURL(f);});}
function renderIncPreview(){document.getElementById('incPreview').innerHTML=incCtx.fotos.map((f,i)=>`<div class="preview-item"><img src="${fotoUrl(f)}" alt=""><button class="preview-remove" onclick="removeIncFoto(${i})">✕</button></div>`).join('');}
function removeIncFoto(i){incCtx.fotos.splice(i,1);renderIncPreview();}

async function guardarIncidencia(){
  const ti=document.getElementById('im-titulo').value.trim();
  if(!ti){showToast('⚠ Añade un título');return;}
  const ds=incCtx.dateStr;
  const id=incCtx.id||uid();
  const tr=document.getElementById('im-transport').value;
  const re=document.getElementById('im-ref').value.trim();
  const de=document.getElementById('im-desc').value.trim();
  const tipo_inc = incTipoActual; // 'carga' | 'postcarga'
  const prev=(state.incidencias[ds]||[]).find(x=>x.id===id);
  const pp=(prev?.fotos||[]).filter(f=>f.path).map(f=>f.path);
  const op={id,fecha:ds,titulo:ti,transporte:tr,ref:re,descripcion:de,tipo_inc,fotos:[...incCtx.fotos],ts:Date.now()};
  if(!state.incidencias[ds])state.incidencias[ds]=[];
  const ix=state.incidencias[ds].findIndex(x=>x.id===id);
  if(ix>=0)state.incidencias[ds][ix]=op;else state.incidencias[ds].push(op);
  closeIncModal();renderDayPanel(ds);paintCal();showToast('Guardando…');
  try{
    const fo=await uploadFotos(incCtx.fotos,ds,'incidencias',id);
    const{error}=await sb.from('incidencias').upsert({id,fecha:ds,titulo:ti,transporte:tr,ref_info:re,descripcion:de,tipo_inc,fotos:fo,ts:op.ts});
    if(error)throw error;
    const keep=new Set(fo.map(f=>f.path));
    await borrarFotosStorage(pp.filter(p=>!keep.has(p)));
    const sv={id,titulo:ti,transporte:tr,ref:re,descripcion:de,tipo_inc,fotos:fo,ts:op.ts};
    const j=state.incidencias[ds].findIndex(x=>x.id===id);
    if(j>=0)state.incidencias[ds][j]=sv;
    renderDayPanel(ds);paintCal();
    showToast('✓ Incidencia '+(tipo_inc==='postcarga'?'post-carga':'en carga')+' guardada');
  }catch(e){showToast('⚠ Error al guardar');}
}
async function delInc(ds,id){if(!confirm('¿Eliminar esta incidencia?'))return;const en=(state.incidencias[ds]||[]).find(x=>x.id===id);state.incidencias[ds]=(state.incidencias[ds]||[]).filter(x=>x.id!==id);if(!state.incidencias[ds].length)delete state.incidencias[ds];renderDayPanel(ds);paintCal();try{const{error}=await sb.from('incidencias').delete().eq('id',id);if(error)throw error;await borrarFotosStorage((en?.fotos||[]).filter(f=>f.path).map(f=>f.path));showToast('Incidencia eliminada');}catch(e){showToast('⚠ Error al eliminar');}}

// ── VIEWER CON BARRA DRAGGABLE Y ZOOM + PAN ──
let vFotos = [], vIdx = 0, vZoom = 1;
let vPanX = 0, vPanY = 0;

function openViewer(ds, cId, i) {
  const c = (state.cargas[ds]||[]).find(x => x.id === cId);
  if (!c || !c.fotos.length) return;
  vFotos = c.fotos; vIdx = i; showViewer();
}
function openViewerInc(ds, iId, i) {
  const ic = (state.incidencias[ds]||[]).find(x => x.id === iId);
  if (!ic || !ic.fotos.length) return;
  vFotos = ic.fotos; vIdx = i; showViewer();
}

function showViewer() {
  vZoom = 1; vPanX = 0; vPanY = 0;
  const f   = vFotos[vIdx];
  const img = document.getElementById('viewerImg');
  img.src   = fotoUrl(f);
  viewerApplyTransform();
  document.getElementById('viewerCaption').textContent =
    (vIdx + 1) + ' / ' + vFotos.length + (f.nombre ? '  ·  ' + f.nombre : '');
  document.getElementById('viewer').classList.add('open');
}

function viewerApplyTransform() {
  const img = document.getElementById('viewerImg');
  img.style.transform = `scale(${vZoom}) translate(${vPanX/vZoom}px, ${vPanY/vZoom}px)`;
}

function viewerNav(dir) {
  vIdx = (vIdx + dir + vFotos.length) % vFotos.length;
  showViewer();
}

function viewerZoom(dir) {
  vZoom = Math.min(6, Math.max(0.3, vZoom + dir * 0.5));
  viewerApplyTransform();
}

function viewerAjustar() {
  vZoom = 1; vPanX = 0; vPanY = 0;
  viewerApplyTransform();
}

function viewerDescargar() {
  const f = vFotos[vIdx];
  const a = document.createElement('a');
  a.href     = fotoUrl(f);
  a.download = f.nombre || ('foto-' + (vIdx + 1) + '.jpg');
  a.target   = '_blank';
  a.click();
}

function viewerImprimir() {
  const f   = vFotos[vIdx];
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${f.nombre || 'Foto'}</title>
    <style>
      *{margin:0;padding:0;}
      body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;}
      img{max-width:100%;max-height:100vh;object-fit:contain;}
      @media print{body{display:block;}img{width:100%;height:auto;}}
    </style>
  </head><body><img src="${fotoUrl(f)}" onload="window.print()"></body></html>`);
  win.document.close();
}

function closeViewer() {
  document.getElementById('viewer').classList.remove('open');
  vZoom = 1; vPanX = 0; vPanY = 0;
}

// ── Drag image (pan when zoomed) ──
(function () {
  let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  const getImg = () => document.getElementById('viewerImg');

  // Mouse
  document.addEventListener('mousedown', e => {
    if (!document.getElementById('viewer').classList.contains('open')) return;
    if (e.target.closest('.viewer-toolbar')) return;
    if (vZoom <= 1) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startPanX = vPanX; startPanY = vPanY;
    getImg().style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    vPanX = startPanX + (e.clientX - startX);
    vPanY = startPanY + (e.clientY - startY);
    viewerApplyTransform();
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    const img = getImg();
    if (img) img.style.cursor = vZoom > 1 ? 'grab' : 'default';
  });

  // Touch pan
  let t0x = 0, t0y = 0, t0PanX = 0, t0PanY = 0, tPanning = false;
  let pinchDist0 = 0, pinchZoom0 = 1;

  document.addEventListener('touchstart', e => {
    if (!document.getElementById('viewer').classList.contains('open')) return;
    if (e.target.closest('.viewer-toolbar')) return;
    if (e.touches.length === 2) {
      tPanning = false;
      pinchDist0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchZoom0 = vZoom;
    } else if (e.touches.length === 1) {
      tPanning = true;
      t0x = e.touches[0].clientX; t0y = e.touches[0].clientY;
      t0PanX = vPanX; t0PanY = vPanY;
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!document.getElementById('viewer').classList.contains('open')) return;
    if (e.target.closest('.viewer-toolbar')) return;
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      vZoom = Math.min(6, Math.max(0.3, pinchZoom0 * (d / pinchDist0)));
      viewerApplyTransform();
    } else if (e.touches.length === 1 && tPanning && vZoom > 1) {
      vPanX = t0PanX + (e.touches[0].clientX - t0x);
      vPanY = t0PanY + (e.touches[0].clientY - t0y);
      viewerApplyTransform();
    }
  }, { passive: true });
})();

// ── Drag toolbar ──
(function () {
  const getBar = () => document.getElementById('viewerToolbar');
  let dragging = false, startX = 0, startY = 0, barLeft = 0, barTop = 0;

  document.getElementById('vtbHandle') && (() => {})(); // deferred — handle added at runtime

  document.addEventListener('mousedown', e => {
    const handle = document.getElementById('vtbHandle');
    if (!handle || !handle.contains(e.target)) return;
    dragging = true;
    const bar  = getBar();
    const rect = bar.getBoundingClientRect();
    barLeft = rect.left; barTop = rect.top;
    startX = e.clientX; startY = e.clientY;
    bar.style.transform = 'none';
    bar.style.left = barLeft + 'px';
    bar.style.top  = barTop  + 'px';
    bar.style.bottom = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const bar = getBar();
    bar.style.left = (barLeft + e.clientX - startX) + 'px';
    bar.style.top  = (barTop  + e.clientY - startY) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // Touch drag toolbar
  document.addEventListener('touchstart', e => {
    const handle = document.getElementById('vtbHandle');
    if (!handle || !handle.contains(e.target)) return;
    dragging = true;
    const bar  = getBar();
    const rect = bar.getBoundingClientRect();
    barLeft = rect.left; barTop = rect.top;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    bar.style.transform = 'none';
    bar.style.left = barLeft + 'px';
    bar.style.top  = barTop  + 'px';
    bar.style.bottom = 'auto';
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const bar = getBar();
    bar.style.left = (barLeft + e.touches[0].clientX - startX) + 'px';
    bar.style.top  = (barTop  + e.touches[0].clientY - startY) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', () => { dragging = false; });
})();

['cargaModal','incModal'].forEach(id=>{document.getElementById(id).addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');});});
document.getElementById('viewer').addEventListener('click',function(e){if(e.target===this)closeViewer();});

// ════════════════════════════════════════════════════
// BÚSQUEDA GLOBAL
// ════════════════════════════════════════════════════
let searchTimer = null;

function searchDebounce() {
  clearTimeout(searchTimer);
  const q = document.getElementById('searchInput').value.trim();
  document.getElementById('searchClear').style.display = q ? '' : 'none';
  if (!q) { searchHide(); return; }
  searchTimer = setTimeout(() => buscar(q), 300);
}

function searchClear() {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  searchHide();
}

async function buscar(q) {
  const term = q.toLowerCase().trim();
  if (!term) return;

  const resultados = { cargas: [], incidencias: [], pedidos: [] };

  // ── Buscar en cargas (estado local + Supabase) ──
  try {
    const { data: cargasDB } = await sb.from('cargas')
      .select('id,fecha,transporte,camion,titulo,notas')
      .or(`titulo.ilike.%${term}%,notas.ilike.%${term}%,camion.ilike.%${term}%,transporte.ilike.%${term}%`)
      .order('fecha', { ascending: false })
      .limit(20);
    (cargasDB || []).forEach(c => resultados.cargas.push(c));
  } catch(e) {}

  // ── Buscar en incidencias ──
  try {
    const { data: incsDB } = await sb.from('incidencias')
      .select('id,fecha,titulo,transporte,ref_info,descripcion,tipo_inc')
      .or(`titulo.ilike.%${term}%,descripcion.ilike.%${term}%,ref_info.ilike.%${term}%,transporte.ilike.%${term}%`)
      .order('fecha', { ascending: false })
      .limit(20);
    (incsDB || []).forEach(i => resultados.incidencias.push(i));
  } catch(e) {}

  // ── Buscar en pedidos_control ──
  try {
    const { data: pedsDB } = await sb.from('pedidos_control')
      .select('id,fecha,num_pedido,agencia,estado,obs_refs,obs_bultos')
      .or(`num_pedido.ilike.%${term}%,agencia.ilike.%${term}%,obs_refs.ilike.%${term}%,obs_bultos.ilike.%${term}%`)
      .order('fecha', { ascending: false })
      .limit(20);
    (pedsDB || []).forEach(p => resultados.pedidos.push(p));
  } catch(e) {}

  renderResultados(resultados, term);
}

function hl(text, term) {
  // Resalta el término en el texto
  if (!text || !term) return text || '';
  const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return String(text).replace(re, '<mark>$1</mark>');
}

function renderResultados(res, term) {
  const box = document.getElementById('searchResults');
  const total = res.cargas.length + res.incidencias.length + res.pedidos.length;

  if (!total) {
    box.innerHTML = `<div class="sr-empty">Sin resultados para "<b>${term}</b>"<br><span style="font-size:11px">Prueba con otro término o verifica la ortografía</span></div>`;
    box.style.display = '';
    return;
  }

  let html = '';

  // ── Pedidos ──
  if (res.pedidos.length) {
    html += `<div class="sr-group">
      <div class="sr-group-header"><div class="sr-dot sr-dot-pedido"></div>Pedidos controlados (${res.pedidos.length})</div>`;
    html += res.pedidos.map(p => {
      const estadoLabel = {
        completado: 'Completado ✓',
        pendiente_bultos: 'En control bultos',
        pendiente_refs: 'En control referencias'
      }[p.estado] || p.estado;
      const obs = p.obs_refs || p.obs_bultos || '';
      return `<div class="sr-item" onclick="irADia('${p.fecha}','geo')">
        <div class="sr-dot sr-dot-pedido"></div>
        <div class="sr-body">
          <div class="sr-title">${hl('Pedido ' + p.num_pedido, term)}</div>
          <div class="sr-sub">${hl(p.agencia || '—', term)} · ${estadoLabel}${obs ? ' · ' + hl(obs.slice(0,50), term) : ''}</div>
        </div>
        <div class="sr-right">
          <div class="sr-fecha">${fmtDate(p.fecha)}</div>
          <div class="sr-tipo">Pedido</div>
        </div>
      </div>`;
    }).join('');
    html += '</div>';
  }

  // ── Cargas ──
  if (res.cargas.length) {
    html += `<div class="sr-group" style="margin-top:${res.pedidos.length?'12px':'0'}">
      <div class="sr-group-header"><div class="sr-dot sr-dot-carga"></div>Cargas fotografiadas (${res.cargas.length})</div>`;
    html += res.cargas.map(c => `
      <div class="sr-item" onclick="irADia('${c.fecha}','geo')">
        <div class="sr-dot sr-dot-carga"></div>
        <div class="sr-body">
          <div class="sr-title">${hl(c.titulo || c.camion || 'Sin título', term)}</div>
          <div class="sr-sub">${hl(c.transporte, term)}${c.notas ? ' · ' + hl(c.notas.slice(0,55), term) : ''}</div>
        </div>
        <div class="sr-right">
          <div class="sr-fecha">${fmtDate(c.fecha)}</div>
          <div class="sr-tipo">Carga</div>
        </div>
      </div>`).join('');
    html += '</div>';
  }

  // ── Incidencias ──
  if (res.incidencias.length) {
    html += `<div class="sr-group" style="margin-top:${(res.pedidos.length||res.cargas.length)?'12px':'0'}">
      <div class="sr-group-header"><div class="sr-dot sr-dot-inc"></div>Incidencias (${res.incidencias.length})</div>`;
    html += res.incidencias.map(i => {
      const esPost = i.tipo_inc === 'postcarga';
      const tab = esPost ? 'inc-post' : 'inc-carga';
      const tipoLabel = esPost ? 'Post-carga' : 'En carga';
      const sub = [i.transporte, i.ref_info, i.descripcion ? i.descripcion.slice(0,50) : '']
        .filter(Boolean).join(' · ');
      return `<div class="sr-item" onclick="irADia('${i.fecha}','${tab}')">
        <div class="sr-dot ${esPost ? 'sr-dot-postcarga' : 'sr-dot-inc'}"></div>
        <div class="sr-body">
          <div class="sr-title">${hl(i.titulo, term)}</div>
          <div class="sr-sub">${hl(sub, term)}</div>
        </div>
        <div class="sr-right">
          <div class="sr-fecha">${fmtDate(i.fecha)}</div>
          <div class="sr-tipo">${tipoLabel}</div>
        </div>
      </div>`;
    }).join('');
    html += '</div>';
  }

  box.innerHTML = html;
  box.style.display = '';
}

// Navega al día en el calendario y abre la pestaña correcta
async function irADia(fecha, tab) {
  searchHide();
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';

  // Cambiar a pestaña Calendario
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const calTab = document.querySelector('.nav-tab[data-view="calendario"]');
  calTab.classList.add('active');
  document.getElementById('view-calendario').classList.add('active');

  // Ir al mes correcto
  const [y, m] = fecha.split('-').map(Number);
  calY = y; calM = m - 1;
  await loadMonth(calY, calM);
  paintCal();

  // Seleccionar el día y abrir la pestaña
  activeDayTab = tab || 'geo';
  selDate = fecha;
  paintCal();
  renderDayPanel(fecha);

  // Scroll al panel
  setTimeout(() => {
    const panel = document.getElementById('dayPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
anteriorArchivar(); // archivar carpeta Anterior si es de ayer
scInit();
