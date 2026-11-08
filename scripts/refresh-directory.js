#!/usr/bin/env node
// 회사 디렉터리 스냅샷을 갱신한다. 사람이 가끔 실행한다.
// 사용법: node scripts/refresh-directory.js [us|kr|all]
//   us: SEC company_tickers.json (키 불필요, RESEARCH_CONTACT_EMAIL 권장)
//   kr: OpenDART corpCode.xml (OPENDART_API_KEY 필요)
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const target = process.argv[2] ?? 'all';

const write = (file, source, rows) => {
  writeFileSync(join(DATA_DIR, file), `${JSON.stringify({ source, fetchedAt: new Date().toISOString(), rows })}\n`, 'utf8');
  console.log(`${file}: ${rows.length}개`);
};

async function refreshUs() {
  const source = 'https://www.sec.gov/files/company_tickers.json';
  const contact = process.env.RESEARCH_CONTACT_EMAIL || 'contact-not-set';
  // SEC는 연락처가 담긴 User-Agent를 요구한다.
  const res = await fetch(source, { headers: { 'User-Agent': `eco-si-news-analyze/1.0 (${contact})` } });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  const body = await res.json();
  const rows = Object.values(body).map((e) => [String(e.ticker), String(e.cik_str).padStart(10, '0'), String(e.title)]);
  write('us-tickers.json', source, rows);
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? '';

async function refreshKr() {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    console.log('kr: OPENDART_API_KEY가 없어 건너뜀');
    return;
  }
  const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`OpenDART HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntries().find((e) => e.entryName.toUpperCase().endsWith('.XML'));
  if (!entry) throw new Error('OpenDART 응답에 XML이 없다(키 오류면 ZIP 대신 오류 XML이 온다)');
  const xml = entry.getData().toString('utf8');
  const rows = [];
  for (const [, block] of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const stockCode = tag(block, 'stock_code');
    if (!/^\d{6}$/.test(stockCode)) continue;   // 비상장사 제외
    rows.push([tag(block, 'corp_name'), stockCode, tag(block, 'corp_code')]);
  }
  write('kr-listed.json', 'https://opendart.fss.or.kr/api/corpCode.xml', rows);
}

if (target === 'us' || target === 'all') await refreshUs();
if (target === 'kr' || target === 'all') await refreshKr();
