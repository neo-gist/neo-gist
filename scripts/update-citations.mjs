#!/usr/bin/env node
/*
 * update-citations.mjs
 * ------------------------------------------------------------------
 * data/publications/ref.bib 안의 모든 doi 를 읽어 OpenAlex 에서
 * 논문별 인용수(총합 + 연도별 받은 인용수)를 가져와
 * data/publications/citations.json 으로 저장한다.
 *
 * - ref.bib 와는 완전히 분리(이 스크립트는 ref.bib 를 읽기만 함)
 * - GitHub Actions 가 매일 실행 → 결과 json 만 커밋
 * - 로컬 테스트:  node scripts/update-citations.mjs
 *
 * 필요 환경: Node 18+ (내장 fetch 사용, 외부 패키지 없음)
 * 선택 환경변수: OPENALEX_MAILTO (OpenAlex polite pool 연락 이메일)
 * ------------------------------------------------------------------ */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIB = resolve(ROOT, 'data/publications/ref.bib');
const OUT = resolve(ROOT, 'data/publications/citations.json');
const MAILTO = process.env.OPENALEX_MAILTO || 'zzzrkd32@gmail.com';

/* ref.bib 에서 doi 값만 추출 → 소문자 bare DOI 로 정규화 */
function normDoi(d) {
  return String(d || '')
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
}

async function readDois() {
  const text = await readFile(BIB, 'utf8');
  const set = new Set();
  const re = /doi\s*=\s*[{"]\s*([^}"]+?)\s*[}"]/gi;
  let m;
  while ((m = re.exec(text))) {
    const d = normDoi(m[1]);
    if (d) set.add(d);
  }
  return [...set];
}

/* OpenAlex 호출(재시도 포함) */
async function fetchJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `neo-gist-citations (mailto:${MAILTO})` } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (attempt === 4) throw err;
      const wait = attempt * 2000;
      console.warn(`  재시도 ${attempt}/3 (${err.message}) — ${wait}ms 대기`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/* DOI 목록을 50개씩 묶어 OpenAlex 조회 */
async function fetchWorks(dois) {
  const works = [];
  const BATCH = 50;
  for (let i = 0; i < dois.length; i += BATCH) {
    const chunk = dois.slice(i, i + BATCH);
    const filter = 'doi:' + chunk.map(d => encodeURIComponent(d)).join('|');
    const url = `https://api.openalex.org/works?filter=${filter}` +
      `&per-page=${BATCH}&select=doi,cited_by_count,counts_by_year&mailto=${encodeURIComponent(MAILTO)}`;
    console.log(`OpenAlex 조회 ${i + 1}–${Math.min(i + BATCH, dois.length)} / ${dois.length}`);
    const data = await fetchJson(url);
    (data.results || []).forEach(w => works.push(w));
    await new Promise(r => setTimeout(r, 300)); // polite pool 간격
  }
  return works;
}

async function main() {
  const dois = await readDois();
  console.log(`ref.bib 에서 DOI ${dois.length}개 추출`);
  if (!dois.length) throw new Error('DOI 를 하나도 찾지 못했습니다.');

  const works = await fetchWorks(dois);
  console.log(`OpenAlex 응답 ${works.length}건`);

  const papers = {};
  const byYear = {};
  let total = 0;

  works.forEach(w => {
    const d = normDoi(w.doi);
    if (!d) return;
    const py = {};
    (w.counts_by_year || []).forEach(({ year, cited_by_count }) => {
      py[year] = cited_by_count;
      byYear[year] = (byYear[year] || 0) + cited_by_count; // 전체 논문 연도별 합계
    });
    papers[d] = { total: w.cited_by_count || 0, by_year: py };
    total += w.cited_by_count || 0;
  });

  const missing = dois.filter(d => !papers[d]);
  if (missing.length) console.warn(`OpenAlex 미확인 DOI ${missing.length}개: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);

  const out = {
    updated: new Date().toISOString().slice(0, 10),
    total,               // 전체 누적 인용수
    matched: Object.keys(papers).length,
    by_year: byYear,     // 전체 논문의 "연도별 받은 인용수" 합계 → 막대그래프
    papers               // DOI별 { total, by_year }
  };

  // 연도 키를 정렬해서 저장(가독성)
  out.by_year = Object.fromEntries(Object.keys(byYear).map(Number).sort((a, b) => a - b).map(y => [y, byYear[y]]));

  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`저장 완료 → ${OUT}\n총 인용수 ${total.toLocaleString()}, 매칭 ${out.matched}/${dois.length}편`);
}

main().catch(err => { console.error('실패:', err); process.exit(1); });
