// server/migrate-firebase.mjs
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import oracledb from 'oracledb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== ENV =====
const ORA_USER    = process.env.ORA_USER    || process.env.ORACLE_USER || 'EC_APP';
const ORA_PASSWORD= process.env.ORA_PASSWORD|| process.env.ORACLE_PASSWORD;
const ORA_CONNECT = process.env.ORA_CONNECT || process.env.ORACLE_CONNECT || '//localhost:1521/xepdb1';

const FIREBASE_SA_PATH   = process.env.FIREBASE_SA_PATH; // ex: D:/firebase/key.json ou ./creds/key.json
const FIREBASE_PROJECT_ID= process.env.FIREBASE_PROJECT_ID;
const FIREBASE_COLLECTION= process.env.FIREBASE_COLLECTION || 'projects';

const USE_COLLECTION_GROUP = String(process.env.FIREBASE_USE_COLLECTION_GROUP || 'true').toLowerCase() === 'true';
// Quando USE_COLLECTION_GROUP=false, usa db.collection(FIREBASE_COLLECTION)
// (Opcional) Caminho completo se quiser apontar uma subpasta específica (não usado com collectionGroup)
const FIREBASE_COLLECTION_PATH = process.env.FIREBASE_COLLECTION_PATH || null;

const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

// ===== Firebase init =====
function resolveSaPath(p) {
  if (!p) throw new Error('FIREBASE_SA_PATH não definido no .env');
  return path.isAbsolute(p) ? p : path.resolve(__dirname, p);
}
function initFirebase() {
  const saAbs = resolveSaPath(FIREBASE_SA_PATH).replace(/\\/g, '/');
  const json = JSON.parse(fs.readFileSync(saAbs, 'utf-8'));
  admin.initializeApp({
    credential: admin.credential.cert(json),
    projectId: FIREBASE_PROJECT_ID || json.project_id,
  });
  return admin.firestore();
}

// ===== Helpers =====
const toStr = (v) => (v === null || v === undefined ? null : String(v));

function toNumBR(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = typeof v === 'string' ? v.trim() : String(v);
  if (!s) return null;

  // remove moedas e espaços
  s = s.replace(/[Rr]\$|USD|\s/g, '');

  // normaliza separadores (1.234,56 | 1,234.56 | 1_234,56)
  let t = s
    .replace(/[._](?=\d{3}\b)/g, '') // remove separador de milhar "._" antes de grupo 3 dígitos no final
    .replace(/\./g, '')              // remove pontos restantes
    .replace(/,/g, '.');             // vírgula decimal -> ponto

  // mantém apenas dígitos, sinal e ponto
  t = t.replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const toInt = (v) => {
  const n = toNumBR(v);
  return n === null ? null : Math.trunc(n);
};

const isTimestamp = (v) => v && typeof v.toDate === 'function';
function toDateOrNull(v) {
  if (!v) return null;
  if (isTimestamp(v)) return v.toDate();
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/\//g, '-').slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ===== SQL =====
const INSERT_PROJECT_SQL = `
  INSERT INTO EC_APP.PROJECTS
    (TITLE, DESCRIPTION, STATUS, OWNER_USER_ID,
     START_DATE, DUE_DATE, DATA_FIM_PREV, CHEGADA,
     ORIGEM, COMITE, IT, REGISTRO_INT,
     VINCULO_PROJ, CODIGO_ILEAN, AREA_GRUPO,
     IMPACTO_COMITE, CATEGORIA_KAIZEN,
     GOE_AWARD_Q, GOE_AWARD_YEAR,
     PREMIO_KAIZEN_Q, PREMIO_KAIZEN_YEAR,
     GANHO_ESTIMADO, GANHO_REALIZADO,
     RELEVANT_KPI, LEADING_KPI,
     BASELINE, TARGET, ACTUAL_YTD,
     RE_NO, EMPLOYEE_NAME, VALIDADOR, CHAMPION,
     DATA_INICIO_GANHO, ANO_CONSIDERADO)
  VALUES
    (:TITLE, :DESCRIPTION, :STATUS, :OWNER_USER_ID,
     :START_DATE, :DUE_DATE, :DATA_FIM_PREV, :CHEGADA,
     :ORIGEM, :COMITE, :IT, :REGISTRO_INT,
     :VINCULO_PROJ, :CODIGO_ILEAN, :AREA_GRUPO,
     :IMPACTO_COMITE, :CATEGORIA_KAIZEN,
     :GOE_AWARD_Q, :GOE_AWARD_YEAR,
     :PREMIO_KAIZEN_Q, :PREMIO_KAIZEN_YEAR,
     :GANHO_ESTIMADO, :GANHO_REALIZADO,
     :RELEVANT_KPI, :LEADING_KPI,
     :BASELINE, :TARGET, :ACTUAL_YTD,
     :RE_NO, :EMPLOYEE_NAME, :VALIDADOR, :CHAMPION,
     :DATA_INICIO_GANHO, :ANO_CONSIDERADO)
  RETURNING ID INTO :OUT_ID
`;

const INSERT_EARNING_SQL = `
  INSERT INTO EC_APP.PROJECT_EARNINGS (PROJECT_ID, ANO, MES, VALOR)
  VALUES (:PROJECT_ID, :ANO, :MES, :VALOR)
`;

const EXISTS_PROJECT_SQL = `
  SELECT 1
  FROM EC_APP.PROJECTS
  WHERE TITLE = :t
    AND NVL(START_DATE, DATE '1900-01-01') = NVL(:sd, DATE '1900-01-01')
`;

// ===== Firestore readers =====
async function getSnapshot(db) {
  if (USE_COLLECTION_GROUP) {
    return await db.collectionGroup(FIREBASE_COLLECTION).get();
  }
  if (FIREBASE_COLLECTION_PATH) {
    // caminho profundo: a/b/c/d -> alterna doc/collection
    const parts = FIREBASE_COLLECTION_PATH.split('/').filter(Boolean);
    let ref = db;
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) ref = ref.collection(parts[i]);
      else ref = ref.doc(parts[i]);
    }
    // se terminou em doc, pega subcoleção final FIREBASE_COLLECTION
    if (typeof ref.get !== 'function') {
      // terminou em DocumentReference, precisa de uma collection no fim
      ref = ref.collection(FIREBASE_COLLECTION);
    }
    return await ref.get();
  }
  return await db.collection(FIREBASE_COLLECTION).get();
}

// ===== Main =====
async function run() {
  console.log('>> Iniciando migração Firestore -> Oracle');
  console.log(`   USE_COLLECTION_GROUP: ${USE_COLLECTION_GROUP}`);
  console.log(`   COLLECTION: ${FIREBASE_COLLECTION}`);
  console.log(`   COLLECTION_PATH: ${FIREBASE_COLLECTION_PATH || '(n/d)'}`);
  console.log(`   DRY_RUN: ${DRY_RUN}`);

  const db = initFirebase();

  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  const pool = await oracledb.createPool({
    user: ORA_USER,
    password: ORA_PASSWORD,
    connectString: ORA_CONNECT,
    poolMin: 1, poolMax: 5, poolIncrement: 1,
  });

  let conn;
  const stats = { projectsTotal: 0, projectsInserted: 0, earningsInserted: 0, skipped: 0, dups: 0 };

  try {
    conn = await pool.getConnection();
    await conn.execute(`ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'`);

    const snap = await getSnapshot(db);
    stats.projectsTotal = snap.size;
    console.log(`>> Documentos encontrados: ${stats.projectsTotal}`);
    if (stats.projectsTotal === 0) {
      console.log('>> Nada para migrar.');
      return;
    }

    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data() || {};

      const bind = {
        TITLE: toStr(d.title) || toStr(d.TITLE),
        DESCRIPTION: toStr(d.description) || toStr(d.DESCRIPTION),
        STATUS: toStr(d.status) || toStr(d.STATUS),
        OWNER_USER_ID: null,

        START_DATE: toDateOrNull(d.startDate || d.START_DATE),
        DUE_DATE: toDateOrNull(d.dueDate || d.DUE_DATE),
        DATA_FIM_PREV: toDateOrNull(d.dataFimPrev || d.DATA_FIM_PREV),
        CHEGADA: toDateOrNull(d.chegada || d.CHEGADA),

        ORIGEM: toStr(d.origem || d.ORIGEM),
        COMITE: toStr(d.comite || d.COMITE),
        IT: toStr(d.it || d.IT),
        REGISTRO_INT: toStr(d.registroInt || d.REGISTRO_INT),

        VINCULO_PROJ: toStr(d.vinculoProj || d.VINCULO_PROJ),
        CODIGO_ILEAN: toStr(d.codigoILean || d.CODIGO_ILEAN),
        AREA_GRUPO: toStr(d.areaGrupo || d.AREA_GRUPO),

        IMPACTO_COMITE: toStr(d.impactoComite || d.IMPACTO_COMITE),
        CATEGORIA_KAIZEN: toStr(d.categoriaKaizen || d.CATEGORIA_KAIZEN),

        GOE_AWARD_Q: toStr(d.goeAwardQ || d.GOE_AWARD_Q),
        GOE_AWARD_YEAR: toInt(d.goeAwardYear || d.GOE_AWARD_YEAR),

        PREMIO_KAIZEN_Q: toStr(d.premioKaizenQ || d.PREMIO_KAIZEN_Q),
        PREMIO_KAIZEN_YEAR: toInt(d.premioKaizenYear || d.PREMIO_KAIZEN_YEAR),

        GANHO_ESTIMADO: toNumBR(d.ganhoEstimado || d.GANHO_ESTIMADO),
        GANHO_REALIZADO: toNumBR(d.ganhoRealizado || d.GANHO_REALIZADO),

        RELEVANT_KPI: toStr(d.relevantKpi || d.RELEVANT_KPI),
        LEADING_KPI: toStr(d.leadingKpi || d.LEADING_KPI),

        BASELINE: toStr(d.baseline || d.BASELINE),
        TARGET: toStr(d.target || d.TARGET),
        ACTUAL_YTD: toStr(d.actualYtd || d.ACTUAL_YTD),

        RE_NO: toStr(d.reNo || d.RE_NO),
        EMPLOYEE_NAME: toStr(d.employeeName || d.EMPLOYEE_NAME),
        VALIDADOR: toStr(d.validador || d.VALIDADOR),
        CHAMPION: toStr(d.champion || d.CHAMPION),

        DATA_INICIO_GANHO: toDateOrNull(d.dataInicioGanho || d.DATA_INICIO_GANHO),
        ANO_CONSIDERADO: toInt(d.anoConsiderado || d.ANO_CONSIDERADO),

        OUT_ID: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      };

      if (!bind.TITLE) {
        console.warn(`- [skip] ${doc.id}: sem 'title'`);
        stats.skipped++;
        continue;
      }

      try {
        // evitar duplicados (TITLE + START_DATE)
        const dup = await conn.execute(EXISTS_PROJECT_SQL, { t: bind.TITLE, sd: bind.START_DATE });
        if (dup.rows.length) {
          console.log(`- [dup] ${bind.TITLE} (já existe)`);
          stats.dups++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`- [dry] Inseriria: ${bind.TITLE}`);
        } else {
          const r = await conn.execute(INSERT_PROJECT_SQL, bind, { autoCommit: false });
          const newId = r.outBinds.OUT_ID[0];
          stats.projectsInserted++;

          // earnings (subcoleção opcional)
          try {
            const earningsSnap = await doc.ref.collection('earnings').get();
            for (const edoc of earningsSnap.docs) {
              const ev = edoc.data() || {};
              const b = {
                PROJECT_ID: newId,
                ANO: toInt(ev.ano || ev.ANO),
                MES: toInt(ev.mes || ev.MES),
                VALOR: toNumBR(ev.valor || ev.VALOR),
              };
              if (b.ANO && b.MES && b.VALOR !== null) {
                await conn.execute(INSERT_EARNING_SQL, b, { autoCommit: false });
                stats.earningsInserted++;
              }
            }
          } catch {
            // ok se não houver subcoleção
          }
        }
      } catch (e) {
        console.error(`- [skip] doc ${doc.id} (${bind.TITLE}) -> ${e.message}`);
        stats.skipped++;
        continue;
      }

      count++;
      if (!DRY_RUN && count % 50 === 0) {
        await conn.commit();
        console.log(`>> commit parcial (${count})`);
      }
    }

    if (!DRY_RUN) await conn.commit();

    console.log('===== RESUMO =====');
    console.log(`Projetos encontrados: ${stats.projectsTotal}`);
    console.log(`Projetos inseridos : ${stats.projectsInserted}`);
    console.log(`Ganhos inseridos   : ${stats.earningsInserted}`);
    console.log(`Duplicados pulados : ${stats.dups}`);
    console.log(`Skips (erro/dado)  : ${stats.skipped}`);
    console.log('==================');

  } catch (err) {
    console.error('ERRO:', err.message);
    try { await conn?.rollback(); } catch {}
    process.exitCode = 1;
  } finally {
    try { await conn?.close(); } catch {}
    try { await oracledb.getPool()?.close(0); } catch {}
  }
}

run();
