
(function () {
  'use strict';

  /* ---------- 짧은 헬퍼 ---------- */
  const byId = id => document.getElementById(id);
  const qsa = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
  const u = encodeURIComponent;

  /* ==========================================================================
     URL 라우팅 — 탭마다 주소가 바뀌도록 (History API)
      - 지금 페이지가 놓인 폴더(예: /neo-gist/)를 자동으로 감지해서 BASE 로 사용
     - 각 화면(view)을 짧은 주소(slug)와 짝지음
     ========================================================================== */
  var APP_BASE = (function () {
    var cs = document.currentScript;
    var src = (cs && cs.src) ? cs.src : location.pathname;
    var p = new URL(src, location.href).pathname;  // .../site.js
    return p.replace(/[^/]*$/, '');                // 파일명 제거 → .../  (끝에 / 유지)
  })();

  /* 화면 id ↔ 주소 slug */
  var ROUTES = {
    'view-home': '',
    'view-research': 'research',
    'view-members': 'members',
    'view-pubs': 'publications',
    'view-facility': 'facility',
    'view-news': 'news'
  };
  /* 상세 화면은 부모 탭의 주소를 사용 (새로고침 시 목록으로 복원) */
  var VIEW_PARENT = {
    'view-bio': 'view-members',
    'view-entry': 'view-news',
    'view-research-detail': 'view-research'
  };
  var suppressHistory = false;   // popstate/초기 복원 중에는 주소를 다시 쌓지 않음
  var pendingScroll = null;      // 뒤로/앞으로 이동 시 복원할 스크롤 위치

  function viewToPath(viewId) {
    var slug = ROUTES[viewId];
    if (slug === undefined) slug = ROUTES[VIEW_PARENT[viewId]] || '';
    return APP_BASE + slug;      // 단일 세그먼트라 이미지·CSS 상대경로가 그대로 유지됨
  }
  function pathToView() {
    var rel = location.pathname;
    if (rel.indexOf(APP_BASE) === 0) rel = rel.slice(APP_BASE.length);
    rel = rel.replace(/^\/+|\/+$/g, '');
    for (var v in ROUTES) { if (ROUTES[v] === rel) return v; }
    return 'view-home';
  }

  /* 아바타(사진 없을 때) 배경 그라디언트 — 로드 순서대로 순환 배정 */
  const AVATAR_BG = [
    'linear-gradient(140deg,#2a2b28,#D42A1A)',
    'linear-gradient(140deg,#1c1c1a,#444B47)',
    'linear-gradient(140deg,#3a1512,#D42A1A)',
    'linear-gradient(140deg,#3a3f3c,#8A8C8A)'
  ];

  /* 로드된 컬렉션 보관소 */
  const store = { members: [], news: [] };
  const memberById = {};
  /* 논문 저자 볼드용 — 연구실 구성원 영문이름(정규화) 집합 */
  const memberNames = {};
  function normName(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, ''); }

  /* 영문 이름 → 사진 파일명(성+이름, 소문자·영숫자). "Haein Cho" → "chohaein" */
  function enToFile(en) {
    const parts = (en || '').replace(/[.,]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const surname = parts[parts.length - 1];
    const given = parts.slice(0, -1).join('');
    return (surname + given).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  /* 멤버 사진 img 태그 — img 에 확장자가 있으면 그대로, 없거나 비면 영문이름(성+이름)으로
     추정한 파일명에 확장자(.jpg→.png→…)를 자동 탐색. 다 없으면 제거되어 이니셜 표시. */
  function memberFaceImg(m) {
    const alt = (m.en || m.ko || '');
    if (m.img && /\.[a-z0-9]+$/i.test(m.img)) {
      return '<img loading="lazy" src="images/members/' + u(m.img) + '" alt="' + alt + '" onerror="this.remove()">';
    }
    const base = m.img || enToFile(m.en);
    if (!base) return '';
    const path = 'images/members/' + u(base);
    return '<img loading="lazy" src="' + path + '.jpg" data-base="' + path + '" data-i="0" data-fb="remove" alt="' + alt + '" onerror="neoImg(this)">';
  }

  /* JCR 랭킹 — data/jcr.json (연도 → 저널 → {field,pct,if}). 논문 연도-1 로 조회 */
  const JCR = {};   // JCR[year][정규화 저널명] = {field, pct, if}
  function normJournal(s) { return (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
  /* 퍼센티지 → 색상 티어: 상위 5/10/30/이외 */
  function jcrTier(pct) { const p = +pct; if (p <= 5) return 't1'; if (p <= 10) return 't2'; if (p <= 30) return 't3'; return 't4'; }
  function jcrInfo(journal, year) {
    const yr = String(parseInt(year, 10) - 1);   // 게재연도 -1 년 JCR
    const tbl = JCR[yr]; if (!tbl) return null;
    return tbl[normJournal(journal)] || null;
  }

  /* 그룹(학위 구분) → 화면 라벨 */
  const GROUP_TITLE = {
    postdoc: 'Postdoctoral Researcher',
    msphd: 'M.S./Ph.D. Student',
    masters: 'M.S. Student',
    undergraduate: 'Undergraduate Student',
    alumni: 'Alumni'
  };

  /* 상세 화면 섹션 등록부 (현재 News 만 사용) */
  const CATALOG = {
    news:       { pool: () => store.news,    folder: 'news',        label: 'News',        anchor: 'to-news' }
  };

  /* 뉴스 카테고리 — 언론보도(media)는 상단 포토카드, 나머지는 하단 게시판 */
  const NEWS_CATS = { media: 'In the Media', paper: 'Paper Accepted', award: 'Award', grant: 'Grant' };
  const NEWS_BOARDS = [
    { cat: 'paper', title: 'Paper Acceptances' },
    { cat: 'award', title: 'Awards' },
    { cat: 'grant', title: 'Grants' }
  ];
  function newsCat(n) {
    if (n.cat) return n.cat;
    const t = n.tag || '';                                  // 구 데이터(한글 tag) 호환
    if (/언론|media|press/i.test(t)) return 'media';
    if (/논문|paper/i.test(t)) return 'paper';
    if (/수상|award/i.test(t)) return 'award';
    if (/과제|grant|fund|선정/i.test(t)) return 'grant';
    return 'paper';
  }
  function catLabel(n) { return NEWS_CATS[newsCat(n)] || ''; }

  /* ---------- 문자열/날짜 헬퍼 ---------- */

  /* "2026-06-26" → "2026.06.26" (형식이 아니면 원문 그대로: 예 "상시 모집") */
  function prettyDate(v) {
    if (!v) return '';
    const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
    return hit ? hit[1] + '.' + hit[2] + '.' + hit[3] : v;
  }

  /* 답변/본문은 문자열 또는 문자열 배열 → 공백으로 이어 한 문단으로 */
  function joinLines(v) {
    if (Array.isArray(v)) return v.filter(s => String(s == null ? '' : s).trim()).join(' ').trim();
    return (v || '').trim();
  }

  /* 반학기 인덱스: 봄(3~8월)=2Y, 가을(9~12월)=2Y+1, 1~2월=직전 가을(2Y-1) */
  function halfIndex(year, month) {
    if (month >= 9) return year * 2 + 1;
    if (month >= 3) return year * 2;
    return year * 2 - 1;
  }

  /* 영어 서수: 1→1st, 2→2nd, 3→3rd, 4→4th, 11→11th … */
  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  /* 입학 시점 기준 현재 학기 자동 계산.
     admit 형식: "YYYY-MM"(예 "2022-03","2025-09") 또는 "YYYY-spring|fall".
     반환: "7th semester" (아직 입학 전이면 빈 문자열 → 표시 안 함) */
  function academicTerm(m) {
    if (!m || !m.admit) return (m && m.degree) || '';
    const parts = String(m.admit).split('-');
    const year = +parts[0];
    const p1 = (parts[1] || '').toLowerCase();
    let enrolled;
    if (p1 === 'fall') enrolled = year * 2 + 1;
    else if (p1 === 'spring') enrolled = year * 2;
    else enrolled = halfIndex(year, +parts[1]); // 월 기반(03=봄, 09=가을)
    const today = new Date();
    const nth = halfIndex(today.getFullYear(), today.getMonth() + 1) - enrolled + 1;
    if (nth < 1) return '';
    return ordinal(nth) + ' semester';
  }

  /* 특이사항(note) — 마크다운 링크 [텍스트](url) 를 <a> 로 변환 */
  /* 인라인 서식 — **굵게**, {색|텍스트} (색: red/green/blue/amber/gray 또는 #hex/색이름) */
  const RICH_COLORS = { red: 'var(--accent-strong)', green: '#1E7A44', blue: '#1f6feb', amber: '#95660A', gray: 'var(--gray)' };
  function richInline(v) {
    return joinLines(v)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\{([#\w-]+)\|([^{}]+)\}/g, function (_, c, t) {
        return '<span style="color:' + (RICH_COLORS[c.toLowerCase()] || c) + '">' + t + '</span>';
      });
  }
  /* 위 서식 + [텍스트](링크) — 본문/노트용 */
  function noteHTML(v) {
    return richInline(v).replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, href) {
      return '<a href="' + href + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + t + '</a>';
    });
  }

  /* 표시 지위: role 우선, 없으면 그룹 라벨. 학기가 계산되면 " · Nth semester" 결합 */
  function displayRole(m) {
    return m.role || GROUP_TITLE[m.group] || '';
  }
  function roleLine(m) {
    const base = displayRole(m);
    const term = academicTerm(m);
    return term ? base + ' · ' + term : base;
  }

  /* 역할 태그(예: Lab leader, Fab. PIC) — 배열 tags 를 알약 배지로 */
  function tagsHTML(m, cls) {
    if (!m.tags || !m.tags.length) return '';
    const pills = m.tags.filter(Boolean).map(t => '<span class="mtag">' + t + '</span>').join('');
    return '<div class="' + cls + '">' + pills + '</div>';
  }

  /* ==========================================================================
     데이터 적재
     ========================================================================== */
  function fetchJSON(name) {
    return fetch('data/' + name, { cache: 'no-cache' }).then(res => {
      if (!res.ok) throw new Error('불러오기 실패: ' + name);
      return res.json();
    });
  }
  function fetchText(name) {
    return fetch('data/' + name, { cache: 'no-cache' }).then(res => {
      if (!res.ok) throw new Error('불러오기 실패: ' + name);
      return res.text();
    });
  }
  /* 폴더형 컬렉션: _index.json 의 id 목록을 읽어 각 파일을 병렬로 가져옴.
     개별 파일이 깨져도 그 항목만 건너뛰고 나머지는 정상 표시. */
  /* 폴더별 컬렉션 로더 — data/<base>/<sub>/ 각각의 _index.json + 파일을 읽고 tagKey 를 폴더명으로 세팅 */
  async function fetchGrouped(base, subs, tagKey) {
    const groups = await Promise.all(subs.map(async sub => {
      const ids = await fetchJSON(base + '/' + sub + '/_index.json').catch(() => []);
      const items = await Promise.all((ids || []).map(id =>
        fetchJSON(base + '/' + sub + '/' + encodeURIComponent(id) + '.json')
          .then(o => { o[tagKey] = sub; return o; })      // 폴더명이 정본
          .catch(err => { console.warn('건너뜀:', base + '/' + sub + '/' + id, err.message); return null; })
      ));
      return items.filter(Boolean);
    }));
    return groups.flat();
  }

  /* Members: data/members/<group>/ 폴더별로 관리 (폴더가 group 을 결정) */
  function fetchMembers() {
    return fetchGrouped('members', ['postdoc', 'msphd', 'masters', 'undergraduate', 'alumni'], 'group');
  }

  /* News: data/news/<카테고리>/ 폴더별로 관리 (폴더가 카테고리를 결정) */
  /* 언론보도(media)는 상세 페이지가 있어 개별 파일 폴더로, 나머지는 카테고리별 배열 파일 하나로 관리 */
  async function fetchNews() {
    const media = await fetchGrouped('news', ['media'], 'cat');
    const boards = await Promise.all(['paper', 'award', 'grant'].map(async cat => {
      const arr = await fetchJSON('news/' + cat + '.json').catch(() => []);
      return (arr || []).map(n => { n.cat = cat; return n; });
    }));
    return media.concat(boards.flat());
  }

  /* ==========================================================================
     멤버
     ========================================================================== */
  function indexMembers(list) {
    list.forEach((m, i) => {
      m._bg = AVATAR_BG[i % AVATAR_BG.length];
      memberById[m.id] = m;
    });
  }

  /* CV 버튼 — cv(파일명)가 있으면 files/cv/ 경로로 새 탭 열기 */
  function cvButton(p) {
    return p.cv
      ? '<a class="cv-btn" href="files/cv/' + u(p.cv) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">CV <span class="cv-btn__ar" aria-hidden="true">↗</span></a>'
      : '';
  }

  function personCard(p) {
    const interests = (p.ri || []).filter(Boolean).join(', ');
    const edu = (p.education || []).filter(Boolean);
    const face = (p.init || '') + memberFaceImg(p);
    const nameLine = p.en
      ? p.en + ' <span class="card-person__ko">(' + p.ko + ')</span>'
      : p.ko;
    const isAlum = p.group === 'alumni';
    const photo = isAlum ? '' : '<div class="card-person__photo" style="background:' + p._bg + '">' + face + '</div>';
    const now = p.now ? '<div class="card-person__now"><span>Current Affiliation</span>' + p.now + '</div>' : '';
    const blocks =
      (interests ? '<div class="card-person__block"><h5>Research Interests</h5><p>' + interests + '</p></div>' : '') +
      (edu.length ? '<div class="card-person__block"><h5>Education</h5><p>' + edu.join('<br>') + '</p></div>' : '') +
      (p.email ? '<div class="card-person__block card-person__mail"><h5>Email</h5><a href="mailto:' + p.email + '" onclick="event.stopPropagation()">' + p.email + '</a></div>' : '') +
      (p.cv ? '<div class="card-person__block">' + cvButton(p) + '</div>' : '');
    const rule = blocks ? '<div class="card-person__rule"></div>' : '';
    const roleHtml = isAlum
      ? '<div class="card-person__meta"><span class="k">Position</span><span class="v">' + displayRole(p) + '</span></div>' +
        (p.period ? '<div class="card-person__meta"><span class="k">Period</span><span class="v">' + p.period + '</span></div>' : '') +
        tagsHTML(p, 'card-person__tags')
      : '<div class="card-person__role">' + roleLine(p) + '</div>' +
        tagsHTML(p, 'card-person__tags') +
        (p.note ? '<div class="card-person__note">' + noteHTML(p.note) + '</div>' : '');
    return '<article id="mcard-' + p.id + '" class="card-person' + (isAlum ? ' card-person--alum' : '') + ' rise" data-entry="member/' + p.id + '">' +
      photo +
      '<h4 class="card-person__name">' + nameLine + '</h4>' +
      roleHtml +
      now +
      rule +
      blocks +
      '</article>';
  }

  /* Postdoc 카드: 교수 카드의 약 절반 크기 — 사진(좌) + 정보(우) 가로형 */
  function postdocCard(p) {
    const interests = (p.ri || []).filter(Boolean).join(', ');
    const edu = (p.education || []).filter(Boolean);
    const face = (p.init || '') + memberFaceImg(p);
    const nameLine = p.en
      ? p.en + ' <span class="card-postdoc__ko">(' + p.ko + ')</span>'
      : p.ko;
    const blocks =
      (interests ? '<div class="card-postdoc__block"><h5>Research Interests</h5><p>' + interests + '</p></div>' : '') +
      (edu.length ? '<div class="card-postdoc__block"><h5>Education</h5><p>' + edu.join('<br>') + '</p></div>' : '') +
      (p.email ? '<div class="card-postdoc__block"><h5>Email</h5><a href="mailto:' + p.email + '" onclick="event.stopPropagation()">' + p.email + '</a></div>' : '');
    return '<article id="mcard-' + p.id + '" class="card-postdoc rise" data-entry="member/' + p.id + '">' +
      '<div class="card-postdoc__photo" style="background:' + p._bg + '">' + face + '</div>' +
      '<div class="card-postdoc__body">' +
        '<h4 class="card-postdoc__name">' + nameLine + '</h4>' +
        '<div class="card-postdoc__role">' + roleLine(p) + '</div>' +
        tagsHTML(p, 'card-postdoc__tags') +
        (p.note ? '<div class="card-postdoc__note">' + noteHTML(p.note) + '</div>' : '') +
        blocks +
      '</div>' +
      '</article>';
  }

  function paintMembers() {
    qsa('.roster').forEach(grid => {
      const g = grid.dataset.group;
      const render = g === 'postdoc' ? postdocCard : personCard;
      const people = store.members.filter(m => m.group === g);
      grid.innerHTML = people.map(render).join('');
      /* 인원이 없는 그룹은 소제목까지 통째로 숨김 */
      const wrap = grid.closest('.roster-group');
      if (wrap) wrap.style.display = people.length ? '' : 'none';
    });
  }

  /* ==========================================================================
     상세 — 멤버 페이지
     ========================================================================== */
  /* 멤버 직접 입력 논문(pubs) 한 줄 — a 저자, t 제목, v 게재정보, y 연도, d(선택) DOI */
  function memberPubRow(p) {
    const doiUrl = p.d ? (/^https?:/i.test(p.d) ? p.d : 'https://doi.org/' + p.d) : '';
    const title = doiUrl
      ? '<a class="paper__title paper__title--link" href="' + doiUrl + '" target="_blank" rel="noopener">' + p.t + '</a>'
      : '<span class="paper__title">' + p.t + '</span>';
    return '<div class="paper rise"><div class="paper__meta">' + (p.y || '') + '</div>' +
      '<div class="paper__main">' + title +
      '<div class="paper__authors">' + p.a + '</div>' +
      (p.v ? '<div class="paper__venue">' + p.v + '</div>' : '') + '</div></div>';
  }
  function bioList(title, items) {
    return (items && items.length)
      ? '<div class="bio-sec"><h3>' + title + '</h3><ul class="bio-edu">' + items.map(e => '<li>' + e + '</li>').join('') + '</ul></div>'
      : '';
  }

  /* 특허 저자 매칭 — 한글 이름 정확 일치 또는 영문 '이니셜+성' 일치 */
  /* 특허 저자 매칭 — 논문과 동일하게 전체 이름(영문/한글) 정확 일치로 판정 */
  function matchPatents(m) {
    const ko = (m.ko || '').replace(/\s/g, '');
    const enNorm = normName(m.en || '');                                  // 전체 영문 이름 정규화
    return patentsData.filter(p => (p.a || '').split(',').some(raw => {
      const a = raw.trim().replace(/\*/g, '');
      if (ko && a.replace(/\s/g, '') === ko) return true;                 // 한글 전체 이름 일치
      if (enNorm && normName(a) === enNorm) return true;                  // 영문 전체 이름 일치
      return false;
    }));
  }

  function openMember(id) {
    const m = memberById[id];
    if (!m) return;
    const face = '<div class="bio-photo" style="background:' + m._bg + '">' +
      (m.init || '') + memberFaceImg(m) + '</div>';
    const tags = (m.ri || []).filter(Boolean).map(t => '<span class="tag">' + t + '</span>').join('');
    const lines = [];
    if (m.email) lines.push('<div class="bio-line"><span class="bio-line__k">Email</span><a class="bio-line__v" href="mailto:' + m.email + '">' + m.email + '</a></div>');
    if (m.cv) lines.push('<div class="bio-line bio-line--cv">' + cvButton(m) + '</div>');
    const edu = bioList('Education', m.education);
    const exp = bioList('Experience', m.experience);
    /* 특허 — 저자명 자동 감지 */
    const patHits = matchPatents(m);
    const patSec = patHits.length
      ? '<div class="bio-sec bio-pubs"><h3>Patents</h3>' + patHits.map(patentRow).join('') + '</div>'
      : '';
    /* 수상·과제 — 수동 m.awards + award/grant.json 중 이 멤버 지정분 */
    const newsAwards = store.news
      .filter(n => (n.cat === 'award' || n.cat === 'grant') && Array.isArray(n.members) && n.members.indexOf(m.id) >= 0)
      .sort((a, b) => String(b.posted || '').localeCompare(String(a.posted || '')))
      .map(n => n.title + (n.posted ? ' (' + n.posted.slice(0, 4) + ')' : ''));
    const awardsSec = bioList('Awards', [].concat(m.awards || [], newsAwards));
    const selPubs = (m.pubs && m.pubs.length)
      ? '<div class="bio-sec bio-pubs"><h3>Selected Publications</h3>' + m.pubs.map(memberPubRow).join('') + '</div>'
      : '';

    /* 이 멤버의 논문 — 1저자(공동1저자 포함) / 공저자 */
    const myNorm = normName(m.en || '');
    const isLead = p => p.leadNorms && p.leadNorms.indexOf(myNorm) >= 0;
    const isAuthor = p => p.allNorms && p.allNorms.indexOf(myNorm) >= 0;
    const rowsOf = pred => myNorm
      ? progData.filter(pred).map(progRow).join('') + journalsData.filter(pred).map(journalRow).join('')
      : '';
    const leadRows = rowsOf(isLead);
    const contribRows = rowsOf(p => isAuthor(p) && !isLead(p));
    const pubs =
      (leadRows ? '<div class="bio-sec bio-pubs"><h3>First-Author Publications</h3>' + leadRows + '</div>' : '') +
      (contribRows ? '<div class="bio-sec bio-pubs"><h3>Contributed Publications</h3>' + contribRows + '</div>' : '');

    byId('bio-mount').innerHTML =
      '<div class="bio-top">' +
        '<div class="trail"><a data-view="view-members" data-jump="mcard-' + m.id + '">Members</a> › <span>' + m.ko + '</span></div>' +
        '<button class="return bio-return" data-view="view-members" data-jump="mcard-' + m.id + '">← Members 목록으로</button>' +
      '</div>' +
      '<div class="bio-head">' + face +
        '<div class="bio-id">' +
          '<div class="bio-kicker">' + roleLine(m) + '</div>' +
          '<h1>' + m.ko + '</h1>' +
          (m.en ? '<div class="bio-en">' + m.en + '</div>' : '') +
          tagsHTML(m, 'card-person__tags bio-mtags') +
          (m.note ? '<div class="bio-note">' + noteHTML(m.note) + '</div>' : '') +
          (tags ? '<div class="tags bio-tags">' + tags + '</div>' : '') +
          lines.join('') +
        '</div>' +
      '</div>' +
      edu + exp + selPubs + pubs + patSec + awardsSec;
    navigate('view-bio', null, null, { detail: 'member', id: id });
    checkPdfs();
  }

  /* ==========================================================================
     상세 — Activity 공용 기사
     ========================================================================== */
  function entryMeta(type, n) {
    const bits = [];
    bits.push('<span class="chip">' + catLabel(n) + '</span>');
    if (n.posted) bits.push('<span class="entry__date">Posted ' + prettyDate(n.posted) + '</span>');
    return bits.join('');
  }

  function openArticle(type, id) {
    const sec = CATALOG[type];
    if (!sec) return;
    const n = sec.pool().find(x => x.id === id);
    if (!n) return;
    const folder = sec.folder;
    const mediaBase = 'images/' + folder + '/';

    const body = (n.blocks || []).map(b => {
      if (b.p) return '<p>' + noteHTML(b.p) + '</p>';
      if (b.img) return '<figure><div class="frame"><img loading="lazy" src="' + mediaBase + u(b.img) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()"></div><figcaption>' + (b.cap || '') + '</figcaption></figure>';
      return '';
    }).join('');

    const hero = n.hero
      ? '<div class="frame"><img loading="lazy" src="' + mediaBase + u(n.hero) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()"></div>'
      : '';
    const external = n.link && n.link.indexOf('mailto:') !== 0;
    const cta = n.link
      ? '<p style="margin-top:28px"><a class="button button--accent" href="' + n.link + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + (n.linkText || '바로가기 →') + '</a></p>'
      : '';
    const files = (n.attachments && n.attachments.length)
      ? '<div class="files"><div class="files__h">첨부파일</div>' + n.attachments.map(a => {
          const file = typeof a === 'string' ? a : a.file;
          const label = (typeof a === 'object' && a.label) || file;
          return '<a class="file-link" href="files/' + folder + '/' + u(n.id) + '/' + u(file) + '" download><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg><span>' + label + '</span></a>';
        }).join('') + '</div>'
      : '';

    byId('entry-mount').innerHTML =
      '<div class="trail"><a data-view="view-news" data-jump="' + sec.anchor + '">' + sec.label + '</a> › <span>' + richInline(n.title) + '</span></div>' +
      '<h1>' + richInline(n.title) + '</h1>' +
      '<div class="entry__meta">' + entryMeta(type, n) + '</div>' +
      hero + body + files + cta +
      '<button class="return" data-view="view-news" data-jump="' + sec.anchor + '">← Back to ' + sec.label + '</button>';
    navigate('view-entry', null, null, { detail: 'article', atype: type, id: id });
  }

  /* ==========================================================================
     리스트/그리드 렌더러
     ========================================================================== */
  function thumb(folder, hero) {
    const icon = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/></svg>';
    if (!hero) return '<div class="media-card__thumb">' + icon + '</div>';
    const style = 'width:100%;height:100%;object-fit:cover';
    /* 확장자가 있으면 그대로, 없으면 파일명만으로 확장자(.jpg→.png→…) 자동 탐색 */
    if (/\.[a-z0-9]+$/i.test(hero)) {
      return '<div class="media-card__thumb"><img loading="lazy" src="images/' + folder + '/' + u(hero) + '" alt="" style="' + style + '" onerror="this.parentElement.innerHTML=\'' + icon.replace(/'/g, '&#39;').replace(/"/g, '&quot;') + '\'"></div>';
    }
    const base = 'images/' + folder + '/' + u(hero);
    return '<div class="media-card__thumb"><img loading="lazy" src="' + base + '.jpg" data-base="' + base + '" data-i="0" data-fb="icon" data-icon="' + encodeURIComponent(icon) + '" alt="" style="' + style + '" onerror="neoImg(this)"></div>';
  }

  /* Facility — 카테고리별 가로 스크롤 카드(In the Media 스타일, 클릭·태그·날짜 없음) */
  function paintFacility(cats) {
    const mount = byId('facility-cats');
    if (!mount) return;
    const list = (cats || []).filter(c => c && (c.cards || []).length);
    if (!list.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = list.map(c => {
      const cards = (c.cards || []).map(card =>
        '<div class="media-card media-card--static">' +
          thumb('facility', card.img) +
          '<div class="media-card__body"><h4>' + richInline(card.name || '') + '</h4>' +
            (card.desc ? '<p class="media-card__desc">' + richInline(card.desc) + '</p>' : '') +
          '</div>' +
        '</div>').join('');
      return '<div class="media-sec facility-cat rise">' +
        '<div class="media-head"><h3 class="subhead">' + richInline(c.cat || '') + '</h3>' +
          '<div class="media-nav">' +
            '<button class="media-nav__btn" data-mscroll="-1" aria-label="이전">‹</button>' +
            '<button class="media-nav__btn" data-mscroll="1" aria-label="다음">›</button>' +
          '</div>' +
        '</div>' +
        '<div class="media-grid">' + cards + '</div>' +
      '</div>';
    }).join('');
  }

  const byDateDesc = (a, b) => String(b.posted || '').localeCompare(String(a.posted || ''));

  /* 언론 보도 — 상단 전체폭 포토카드 그리드 */
  function paintNewsMedia() {
    const sec = byId('news-media-sec');
    const mount = byId('news-media');
    if (!mount) return;
    const items = store.news.filter(n => newsCat(n) === 'media').sort(byDateDesc);
    if (sec) sec.style.display = items.length ? '' : 'none';
    mount.innerHTML = items.map(c =>
      '<div class="media-card" data-entry="news/' + c.id + '">' +
        thumb('news', c.hero) +
        '<div class="media-card__body">' +
          '<div class="media-card__term">' + (c.term || prettyDate(c.posted)) + '</div>' +
          '<h4>' + richInline(c.title) + '</h4>' +
          '<div class="media-card__foot"><span class="media-card__tag">' + NEWS_CATS.media + '</span><span class="board__date">' + prettyDate(c.posted) + '</span></div>' +
        '</div>' +
      '</div>').join('');
  }

  /* 논문/수상/과제 — 하단 3열 게시판(카테고리별, 페이지당 5개, 번호매김, 페이지 넘김) */
  const NEWS_PAGE_SIZE = 5;
  const newsPage = { paper: 0, award: 0, grant: 0 };
  function paintNewsBoards() {
    NEWS_BOARDS.forEach(bd => {
      const mount = byId('news-' + bd.cat);
      if (!mount) return;
      const all = store.news.filter(n => newsCat(n) === bd.cat).sort(byDateDesc);
      const pages = Math.max(1, Math.ceil(all.length / NEWS_PAGE_SIZE));
      let pg = Math.max(0, Math.min(newsPage[bd.cat] || 0, pages - 1));
      newsPage[bd.cat] = pg;
      const start = pg * NEWS_PAGE_SIZE;
      mount.innerHTML = all.slice(start, start + NEWS_PAGE_SIZE).map((n, i) =>
        '<div class="post">' +
          '<span class="post__num">' + (start + i + 1) + '</span>' +
          '<div class="post__main"><div class="post__title">' + richInline(n.title) + '</div>' +
          '<div class="post__date">' + prettyDate(n.posted) + '</div></div>' +
        '</div>').join('') || '<div class="post-empty">No posts yet.</div>';
      const pager = byId('pager-' + bd.cat);
      if (pager) {
        pager.innerHTML = all.length > NEWS_PAGE_SIZE
          ? '<button class="post-pager__btn" data-news-page="' + bd.cat + ':prev"' + (pg === 0 ? ' disabled' : '') + ' aria-label="이전">‹</button>' +
            '<span class="post-pager__ind">' + (pg + 1) + ' / ' + pages + '</span>' +
            '<button class="post-pager__btn" data-news-page="' + bd.cat + ':next"' + (pg >= pages - 1 ? ' disabled' : '') + ' aria-label="다음">›</button>'
          : '';
      }
    });
  }
  function turnNewsPage(cat, dir) {
    newsPage[cat] = (newsPage[cat] || 0) + dir;
    paintNewsBoards();
  }

  /* 홈 'Lab News' — 최신 소식 10건 */
  function paintFeed() {
    const merged = store.news
      .map(n => ({ n: n, t: 'news' }))
      .sort((a, b) => String(b.n.posted || '').localeCompare(String(a.n.posted || '')))
      .slice(0, 10);
    byId('home-feed').innerHTML = merged.map(row =>
      '<div class="feed__row rise">' +
        '<span class="feed__tagwrap"><span class="feed__tag">' + catLabel(row.n) + '</span></span>' +
        '<span class="feed__title">' + richInline(row.n.title) + '</span>' +
        '<span class="feed__date">' + prettyDate(row.n.posted) + '</span>' +
      '</div>').join('');
  }

  /* ---------- 논문 ---------- */
  function journalRow(p) {
    const doiUrl = p.d ? (/^https?:/i.test(p.d) ? p.d : 'https://doi.org/' + p.d) : '';
    const titleEl = doiUrl
      ? '<a class="paper__title paper__title--link" href="' + doiUrl + '" target="_blank" rel="noopener">' + p.t + '</a>'
      : '<span class="paper__title">' + p.t + '</span>';
    const revTag = p.review ? ' <span class="rev-tag">Review</span>' : '';
    const jc = jcrInfo(p.j, p.y);
    const top10 = jc && +jc.pct <= 10;
    const jName = p.j ? '<span class="pv-j' + (top10 ? ' pv-j--top' : '') + '">' + p.j + '</span>' : '';
    /* PDF 버튼 — files/publication/<인용키>.pdf 가 실제로 있으면 자동 표시 (checkPdfs가 확인) */
    const pdfHref = p.key ? 'files/publication/' + encodeURIComponent(p.key) + '.pdf' : '';
    const pdfBtn = pdfHref
      ? ' <a class="pdf-btn" data-pdf="' + p.key + '" href="' + pdfHref + '" target="_blank" rel="noopener"' + (pdfState[p.key] ? '' : ' hidden') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>PDF</a>'
      : '';
    const cite = p.cite ? ' <span class="pv-c">' + p.cite + '</span>' : '';
    /* 커버: cover 값에 확장자가 있으면 그대로, 없으면 파일명만으로 확장자(.jpg→.png→…) 자동 탐색 */
    let cover = '';
    if (p.cover) {
      if (/\.[a-z0-9]+$/i.test(p.cover)) {
        cover = '<div class="paper__cover"><img loading="lazy" src="images/covers/' + u(p.cover) + '" alt="Cover" onerror="this.remove()"></div>';
      } else {
        const cb = 'images/covers/' + u(p.cover);
        cover = '<div class="paper__cover"><img loading="lazy" src="' + cb + '.jpg" data-base="' + cb + '" data-i="0" data-fb="remove" alt="Cover" onerror="neoImg(this)"></div>';
      }
    }
    return '<div class="paper rise' + (cover ? ' paper--cover' : '') + '"><div class="paper__meta">' + p.y + stateBadge(p.state) + '</div>' +
      '<div class="paper__main"><div class="paper__titleline">' + titleEl + revTag + '</div>' +
      '<div class="paper__authors">' + p.a + '</div>' +
      '<div class="paper__venue">' + jName + cite + pdfBtn + '</div></div>' + cover + '</div>';
  }

  /* ==========================================================================
     BibTeX 파싱 — 저널 논문은 data/ref.bib 로 관리
     author+an 주석: N=jointfirst → 이름 끝 †,  N=corresponding → 이름 끝 *
     ========================================================================== */
  function bibClean(s) {
    return (s || '')
      .replace(/\{\\'e\}/g, 'é').replace(/\{\\`e\}/g, 'è').replace(/\{\\"o\}/g, 'ö')
      .replace(/\\'e/g, 'é').replace(/\$\\alpha\$/g, 'α').replace(/\$([^$]*)\$/g, '$1')
      .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }
  function bibFields(entry) {
    const f = {}, s = entry; let i = 0;
    while (i < s.length) {
      const m = /([A-Za-z][A-Za-z0-9\+\-_]*)\s*=\s*/.exec(s.slice(i));
      if (!m) break;
      const key = m[1].toLowerCase();
      let j = i + m.index + m[0].length, val = '';
      if (s[j] === '{') { let d = 0; for (; j < s.length; j++) { const c = s[j];
          if (c === '{') { d++; if (d === 1) continue; } else if (c === '}') { d--; if (d === 0) { j++; break; } } val += c; } }
      else if (s[j] === '"') { j++; for (; j < s.length && s[j] !== '"'; j++) val += s[j]; j++; }
      else { for (; j < s.length && s[j] !== ',' && s[j] !== '\n'; j++) val += s[j]; }
      f[key] = val.trim();
      const rest = s.slice(j), c = rest.indexOf(','); i = c === -1 ? s.length : j + c + 1;
    }
    return f;
  }
  function parseBib(text) {
    const blocks = []; let cur = null;
    text.split('\n').forEach(line => {
      if (/^\s*@\w+\s*\{/.test(line)) { if (cur) blocks.push(cur); cur = line + '\n'; }
      else if (cur !== null) { cur += line + '\n'; if (/^\s*\}\s*$/.test(line)) { blocks.push(cur); cur = null; } }
    });
    if (cur) blocks.push(cur);
    return blocks.map((e, idx) => {
      const f = bibFields(e);
      const keyM = /@\w+\s*\{\s*([^,\s]+)/.exec(e);
      const bibKey = keyM ? keyM[1].trim() : '';
      const ann = f['author+an'] || '';
      const jf = {}, co = {};
      ann.split(';').forEach(t => { const m = /(\d+)\s*[=\-]\s*([A-Za-z]+)/.exec(t);
        if (m) { const n = +m[1], r = m[2].toLowerCase(); if (r.indexOf('joint') === 0) jf[n] = 1; if (r.indexOf('correspond') === 0) co[n] = 1; } });
      /* 볼드 예외(동명이인·인턴 등): bold={i} 강제 볼드, nobold={i} 강제 해제 */
      const forceBold = {}, forceNo = {};
      (f.bold || '').split(/[;,\s]+/).forEach(x => { const n = parseInt(x, 10); if (n) forceBold[n] = 1; });
      (f.nobold || '').split(/[;,\s]+/).forEach(x => { const n = parseInt(x, 10); if (n) forceNo[n] = 1; });
      const authors = (f.author || '').split(/\s+and\s+/).map(a => a.trim()).filter(Boolean);
      const fa = [], leadNorms = [], allNorms = [];   // leadNorms: 1저자+공동1저자(†), allNorms: 전체 저자
      authors.forEach((a, i2) => {
        const n = i2 + 1;
        let name = a.indexOf(',') >= 0 ? (a.split(',').slice(1).join(',').trim() + ' ' + a.split(',')[0].trim()) : a;
        name = bibClean(name);
        const nn = normName(name);
        allNorms.push(nn);
        if (n === 1 || jf[n]) leadNorms.push(nn);
        let mk = ''; if (jf[n]) mk += '†'; if (co[n]) mk += '*';
        const disp = name + mk;
        let isLab = /^\s*Kang,\s*Dong/i.test(a) || !!memberNames[nn];
        if (forceNo[n]) isLab = false; else if (forceBold[n]) isLab = true;
        fa.push(isLab ? '<b>' + disp + '</b>' : disp);
      });
      const journal = bibClean(f.journal || ''); const bits = [];
      if (f.volume) bits.push(f.volume); if (f.number) bits.push(f.number);
      if (f.pages) bits.push(f.pages.replace(/--/g, '-'));
      let cite = bits.join(', ');
      if (f.note) cite += (cite ? ' · ' : '') + bibClean(f.note);
      const venue = journal + (cite ? ' ' + cite : '');
      const y = f.year || '';
      return { _i: idx, y: y, prog: /in\s*progress/i.test(y), state: bibClean(f.state || ''),
        a: fa.join(', '), t: bibClean(f.title || ''), v: venue, cite: cite, d: f.doi || '', j: journal,
        review: /review/i.test(f.type || ''), cover: bibClean(f.cover || ''),
        key: bibKey, pdf: bibClean(f.pdf || ''), keyword: bibClean(f.keyword || ''),
        leadNorms: leadNorms, allNorms: allNorms };
    }).filter(p => p.a || p.t);
  }

  /* 상태 배지 — state(Under Review / In Revision / Accepted) → 색상 구분 */
  function stateBadge(state) {
    if (!state) return '';
    const s = state.toLowerCase();
    let cls = 'chip--review';
    if (s.indexOf('revision') >= 0) cls = 'chip--inrev';
    else if (s.indexOf('accept') >= 0) cls = 'chip--accepted';
    return '<span class="chip ' + cls + '">' + state + '</span>';
  }
  /* In Progress 논문 한 줄 */
  function progRow(p) {
    return '<div class="paper rise"><div class="paper__meta">' + (stateBadge(p.state) || '<span class="chip chip--submitted">In Progress</span>') + '</div>' +
      '<div class="paper__main"><div class="paper__title">' + p.t + '</div><div class="paper__authors">' + p.a + '</div>' +
      (p.v ? '<div class="paper__venue">' + p.v + '</div>' : '') + '</div></div>';
  }
  /* 특허: v = 국가/출원·등록 정보, s(선택) = 상태 배지 문구. 연도와 태그는 각각 다른 줄 */
  /* 특허 PDF 버튼 — files/patent/<id>.pdf 가 있으면 자동 표시 (checkPdfs). 라벨은 호출부에서 결정 */
  function certBtn(id, label) {
    if (!id || !label) return '';
    const href = 'files/patent/' + encodeURIComponent(id) + '.pdf';
    return ' <a class="pdf-btn" data-pdf="pat-' + id + '" href="' + href + '" target="_blank" rel="noopener" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' + label + '</a>';
  }
  function patentRow(p) {
    const meta = '<span class="pat-y">' + (p.y || '') + '</span>' + (p.s ? '<span class="chip chip--journal pat-chip">' + p.s + '</span>' : '');
    const grp = (label, val) => val
      ? '<span class="pat-grp"><span class="pat-line__k">' + label + '</span><span class="pat-line__v">' + val + '</span></span>'
      : '';
    const parts = grp('등록', p.reg) + grp('출원', p.app);   // 등록이 앞
    /* 출원·등록 모두 → 등록정보 / 출원만 → 출원정보 / 그 외 → 버튼 없음 */
    const certLabel = p.app ? (p.reg ? '등록정보' : '출원정보') : '';
    const line = parts ? '<div class="pat-line">' + parts + certBtn(p.id, certLabel) + '</div>' : '';
    return '<div class="paper rise"><div class="paper__meta">' + meta + '</div>' +
      '<div class="paper__main"><div class="paper__title">' + p.t + '</div><div class="paper__authors">' + p.a + '</div>' +
      line + '</div></div>';
  }
  /* 해외/국내 구분 — region 우선, 없으면 한글 포함 여부로 자동 판정 */
  function patRegion(p) { return p.region || (/[가-힣]/.test((p.app || '') + (p.reg || '') + (p.a || '')) ? 'domestic' : 'intl'); }

  /* ==========================================================================
     라우팅
     ========================================================================== */
  const screens = qsa('.screen');
  const menuLinks = qsa('.menu__link');

  function applyFilter(key) {
    qsa('.paper-tab').forEach(t => t.classList.toggle('is-active', t.dataset.filter === key));
    qsa('.paper-set').forEach(s => s.classList.remove('is-shown'));
    const set = byId('pset-' + key);
    if (set) set.classList.add('is-shown');
  }

  function navigate(viewId, jumpId, filter, extraState) {
    screens.forEach(s => s.classList.toggle('is-active', s.id === viewId));
    const key = viewId === 'view-entry' ? 'view-activity'
      : viewId === 'view-bio' ? 'view-members'
      : viewId === 'view-research-detail' ? 'view-research' : viewId;
    menuLinks.forEach(l => l.classList.toggle('is-current', l.dataset.view === key));
    if (viewId === 'view-pubs' && filter) applyFilter(filter);
    if (!suppressHistory) {
      /* 지금 화면을 떠나기 전에, 현재 스크롤 위치를 현재 기록에 저장 → 뒤로가기 때 복원 */
      try { history.replaceState(Object.assign({}, history.state || {}, { scroll: window.scrollY }), ''); } catch (e) {}
      var st = Object.assign({ v: viewId, j: jumpId, f: filter }, extraState || {});
      try { history.pushState(st, '', viewToPath(viewId)); } catch (e) {}
    }
    closeSheet();
    setTimeout(() => {
      if (pendingScroll != null) {
        /* 뒤로/앞으로 이동 — 저장해 둔 위치로 즉시 복원(부드러운 스크롤 잠시 끔).
           이미지 디코딩 등으로 레이아웃이 살짝 밀릴 수 있어 다음 프레임에 한 번 더 맞춤 */
        var de = document.documentElement, prevSB = de.style.scrollBehavior, target = pendingScroll;
        pendingScroll = null;
        de.style.scrollBehavior = 'auto';
        window.scrollTo(0, target);
        requestAnimationFrame(function () {
          window.scrollTo(0, target);
          de.style.scrollBehavior = prevSB;
        });
      } else if (jumpId) {
        const el = byId(jumpId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      revealPass();
    }, 50);
  }

  /* ==========================================================================
     이벤트 (위임 하나로 모든 클릭 처리)
     ========================================================================== */
  document.addEventListener('click', e => {
    const ychip = e.target.closest('.ychip');
    if (ychip) {
      if (ychip.dataset.bucket) toggleBucket(ychip.dataset.bucket);
      else toggleYear(ychip.dataset.year);
      return;
    }
    const mscroll = e.target.closest('[data-mscroll]');
    if (mscroll) {
      const wrap = mscroll.closest('.news-media-sec, .media-sec');
      const grid = (wrap && wrap.querySelector('.media-grid')) || byId('news-media');
      if (grid) {
        const card = grid.querySelector('.media-card');
        const step = (card ? card.getBoundingClientRect().width : 320) + 22;   // 카드폭 + gap
        grid.scrollBy({ left: (+mscroll.dataset.mscroll) * 3 * step, behavior: 'smooth' });
      }
      return;
    }
    const npage = e.target.closest('[data-news-page]');
    if (npage) {
      if (npage.disabled) return;
      const parts = npage.dataset.newsPage.split(':');
      turnNewsPage(parts[0], parts[1] === 'next' ? 1 : -1);
      return;
    }
    const ppage = e.target.closest('[data-proj-page]');
    if (ppage) {
      if (ppage.disabled) return;
      turnProjPage(ppage.dataset.projPage === 'next' ? 1 : -1);
      return;
    }
    const relBtn = e.target.closest('[data-rel]');
    if (relBtn) {
      if (relBtn.disabled) return;
      const parts = relBtn.dataset.rel.split(':');
      const d = parts[1] === 'next' ? 1 : -1;
      if (parts[0] === 'pubs') { relState.pubsPage += d; renderRelPubs(); }
      else { relState.projsPage += d; renderRelProjs(); }
      setTimeout(revealPass, 30);
      return;
    }
    const rcard = e.target.closest('[data-research]');
    if (rcard) {
      e.preventDefault();
      openResearch(rcard.dataset.research);
      return;
    }
    const scrollTo = e.target.closest('[data-scrollto]');
    if (scrollTo) {
      const el = byId(scrollTo.dataset.scrollto);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const week = fold.parentElement;
      const wasOpen = week.classList.contains('is-open');
      week.parentElement.querySelectorAll('.week.is-open').forEach(x => x.classList.remove('is-open'));
      if (!wasOpen) week.classList.add('is-open');
      return;
    }
    const entry = e.target.closest('[data-entry]');
    if (entry) {
      e.preventDefault();
      const raw = entry.dataset.entry;
      const cut = raw.indexOf('/');
      const type = raw.slice(0, cut);
      const id = raw.slice(cut + 1);
      if (type === 'member') openMember(id);
      else openArticle(type, id);
      return;
    }
    const nav = e.target.closest('[data-view]');
    if (nav) {
      e.preventDefault();
      navigate(nav.dataset.view, nav.dataset.jump, nav.dataset.filter);
    }
  });

  /* 논문 탭 (data-view 가 없는 페이지 내 탭 버튼) */
  qsa('.paper-tab').forEach(tab => tab.addEventListener('click', () => {
    applyFilter(tab.dataset.filter);
    setTimeout(revealPass, 40);
  }));

  /* ---------- 모바일 슬라이드 메뉴 ---------- */
  const sheet = byId('sheet');
  function closeSheet() { sheet.classList.remove('is-open'); }
  byId('burger').addEventListener('click', () => sheet.classList.add('is-open'));
  byId('sheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  qsa('.sheet-group__toggle').forEach(btn => btn.addEventListener('click', () => {
    const group = btn.parentElement;
    group.classList.toggle('is-open');
    btn.querySelector('span').textContent = group.classList.contains('is-open') ? '-' : '+';
  }));

  /* ---------- 스크롤 등장 애니메이션 ---------- */
  let observer;
  function revealPass() {
    const targets = qsa('.screen.is-active .rise:not(.is-in)');
    if (!observer) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (en.isIntersecting) { en.target.classList.add('is-in'); observer.unobserve(en.target); }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    }
    targets.forEach(t => observer.observe(t));
  }

  /* 인턴 명단 — 연도별 한 줄, 이름(비고) 컴팩트 표기 */
  function paintInterns(rows) {
    const mount = byId('intern-list');
    if (!mount) return;
    const block = byId('intern-block');
    if (!Array.isArray(rows) || !rows.length) { if (block) block.style.display = 'none'; return; }
    mount.innerHTML = rows.map(r => {
      const names = (r.people || []).map(p => {
        const nm = typeof p === 'string' ? p : (p.name || '');
        const note = (p && typeof p === 'object' && p.note) ? ' <span class="intern-note">(' + p.note + ')</span>' : '';
        return '<span class="intern-name">' + nm + note + '</span>';
      }).join('<span class="intern-sep">·</span>');
      return '<div class="intern-row"><div class="intern-year">' + r.year + '</div><div class="intern-names">' + names + '</div></div>';
    }).join('');
  }

  /* ---------- 논문 필터 (In Progress + 연도, 다중 선택) ---------- */
  const pdfState = {};     // 인용키 → true(PDF 있음)/false(없음). 1회 확인 후 캐시
  /* files/publication/<key>.pdf 존재 여부를 확인해 있으면 버튼 표시 */
  function checkPdfs() {
    qsa('.pdf-btn').forEach(a => {
      const k = a.dataset.pdf;
      if (pdfState[k] === true) { a.hidden = false; return; }
      if (pdfState[k] === false) { a.hidden = true; return; }
      fetch(a.getAttribute('href'), { method: 'HEAD' })
        .then(r => { pdfState[k] = r.ok; a.hidden = !r.ok; })
        .catch(() => { pdfState[k] = false; a.hidden = true; });
    });
  }
  let journalsData = [];   // 연도 있는 저널 (연도 내림차순)
  let patentsData = [];    // 특허 (멤버 페이지 저자 매칭용)
  let progData = [];       // year=In Progress
  const activeYears = {};  // 'inprogress' 또는 연도값 → true
  const expandedBk = {};   // 펼쳐진 옛 구간(bucketStart) → true
  /* 연도를 5년 단위 구간으로 묶기 (최소연도 기준 정렬, 최신 구간은 항상 펼침) */
  function yearBuckets() {
    const years = [];
    journalsData.forEach(p => { const y = +p.y; if (p.y && years.indexOf(y) === -1) years.push(y); });
    if (!years.length) return [];
    years.sort((a, b) => b - a);
    const minY = years[years.length - 1], maxY = years[0];
    const map = {};
    years.forEach(y => { const b = minY + 5 * Math.floor((y - minY) / 5); (map[b] = map[b] || []).push(y); });
    const maxBucket = minY + 5 * Math.floor((maxY - minY) / 5);
    return Object.keys(map).map(Number).sort((a, b) => b - a).map(b => {
      const ys = map[b].sort((x, y) => y - x);
      return { start: b, years: ys, hi: ys[0], lo: ys[ys.length - 1], current: b === maxBucket };
    });
  }
  function yearChip(y) {
    return '<button class="ychip' + (activeYears[y] ? ' is-on' : '') + '" data-year="' + y + '">' + y + '</button>';
  }
  function paintYearFilter() {
    const bar = byId('year-filter');
    if (!bar) return;
    let html = '';
    if (progData.length) {
      html += '<button class="ychip ychip--prog' + (activeYears['inprogress'] ? ' is-on' : '') + '" data-year="inprogress">In Progress</button>';
      html += '<span class="ychip-div"></span>';
    }
    yearBuckets().forEach(bk => {
      const expanded = bk.current || bk.years.length === 1 || expandedBk[bk.start];
      if (!expanded) {
        html += '<button class="ychip ychip--range" data-bucket="' + bk.start + '">' + bk.hi + '-' + bk.lo + '<span class="ychip__car">▸</span></button>';
        return;
      }
      if (!bk.current && bk.years.length > 1) {
        html += '<button class="ychip ychip--collapse" data-bucket="' + bk.start + '" title="접기" aria-label="' + bk.hi + '-' + bk.lo + ' 접기">‹</button>';
      }
      html += bk.years.map(yearChip).join('');
    });
    bar.innerHTML = html;
  }
  function toggleBucket(b) {
    expandedBk[b] = !expandedBk[b];
    paintYearFilter();
  }
  function paintJournals() {
    const mount = byId('journal-list');
    if (!mount) return;
    const on = Object.keys(activeYears).filter(k => activeYears[k]);
    let list;
    if (!on.length) list = progData.concat(journalsData);                    // 전체: In Progress 맨 위
    else list = (activeYears['inprogress'] ? progData : []).concat(journalsData.filter(p => activeYears[p.y]));
    mount.innerHTML = list.map(p => p.prog ? progRow(p) : journalRow(p)).join('') || '<div class="board__empty">해당 조건의 논문이 없습니다.</div>';
    revealPass();
    checkPdfs();
  }
  function toggleYear(y) {
    activeYears[y] = !activeYears[y];
    paintYearFilter();
    paintJournals();
  }

  /* 과제 상태 — 연구기간(YYYY.MM - YYYY.MM)과 오늘 비교:
     시작 전 = Awarded, 진행 중 = On-going, 종료 후 = Terminated (월 단위, 종료월까지 진행중) */
  function projectStatus(period) {
    const m = String(period || '').match(/(\d{4})\D+(\d{1,2}).*?(\d{4})\D+(\d{1,2})/);
    if (!m) return null;
    const s = (+m[1]) * 12 + (+m[2]);
    const e = (+m[3]) * 12 + (+m[4]);
    const now = new Date();
    const n = now.getFullYear() * 12 + (now.getMonth() + 1);
    if (n < s) return { k: 'awarded', t: 'Awarded' };
    if (n > e) return { k: 'terminated', t: 'Terminated' };
    return { k: 'ongoing', t: 'On-going' };
  }

  /* 연구기간 시작월(정렬용): "2025.01 - ..." → 2025*12+1 */
  function projStart(period) {
    const m = String(period || '').match(/(\d{4})\D+(\d{1,2})/);
    return m ? (+m[1]) * 12 + (+m[2]) : 0;
  }

  /* ---------- Research Areas ---------- */
  let researchData = [];
  function paintResearchAreas(areas) {
    researchData = areas || [];
    const mount = byId('research-cards');
    if (!mount) return;
    mount.innerHTML = researchData.map(a =>
      '<article class="rcard rise" data-research="' + u(a.id) + '">' +
        '<div class="rcard__media">' +
          (a.img ? '<img loading="lazy" src="images/research/' + u(a.img) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()">' : '') +
        '</div>' +
        '<h3 class="rcard__title">' + richInline(a.title || '') + '</h3>' +
        '<span class="rcard__more">See More</span>' +
      '</article>').join('');
    if (!researchData.length) mount.innerHTML = '';
    paintHomeResearch();
  }

  /* HOME 'OUR RESEARCH' — 정사각 카드(모서리 컷 + 링크 아이콘), 클릭 시 상세 */
  const RES_LINK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  function paintHomeResearch() {
    const mount = byId('home-research-tiles');
    if (!mount) return;
    mount.innerHTML = researchData.map(a =>
      '<article class="rcard rcard--home rise" data-research="' + u(a.id) + '">' +
        '<div class="rcard__media">' +
          (a.img ? '<img fetchpriority="high" src="images/research/' + u(a.img) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()">' : '') +
          '<span class="rcard__link">' + RES_LINK_ICON + '</span>' +
        '</div>' +
        '<h3 class="rcard__title">' + richInline(a.title || '') + '</h3>' +
      '</article>').join('');
  }

  /* Research 상세 — 카드 클릭 시. 왼쪽 이미지(절반) + 오른쪽 본문, 하단 키워드 매칭 Related 섹션 */
  function openResearch(id) {
    const a = researchData.find(x => x.id === id);
    if (!a) return;
    const base = 'images/research/';
    const img = a.img
      ? '<div class="rdetail__media"><img loading="lazy" src="' + base + u(a.img) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()"></div>'
      : '<div class="rdetail__media is-empty"></div>';
    const body = (a.blocks || []).map(b => {
      if (b.h) return '<h2 class="entry__h">' + richInline(b.h) + '</h2>';
      if (b.p) return '<p>' + noteHTML(b.p) + '</p>';
      if (b.img) return '<figure><div class="frame"><img loading="lazy" src="' + base + u(b.img) + '" alt="" onerror="this.parentElement.classList.add(\'is-empty\');this.remove()"></div><figcaption>' + (b.cap || '') + '</figcaption></figure>';
      return '';
    }).join('');

    /* 키워드 매칭 — 논문/프로젝트의 keyword 가 이 연구분야의 keywords 목록에 있으면 자동 노출 */
    const kws = (a.keywords || (a.keyword ? [a.keyword] : [])).map(k => String(k).trim()).filter(Boolean);
    const hit = k => kws.length && k && kws.indexOf(String(k).trim()) >= 0;
    relState.pubs = (progData || []).filter(p => hit(p.keyword)).concat((journalsData || []).filter(p => hit(p.keyword)));
    relState.projs = (projectsData || []).filter(pr => hit(pr.keyword));
    relState.pubsPage = 0;
    relState.projsPage = 0;
    const pubsSec = relState.pubs.length
      ? '<div class="rel-head rdetail__sec"><h2 class="entry__h">Related Publications</h2><div class="rel-pager" id="rel-pubs-pager"></div></div><div id="rel-pubs"></div>'
      : '';
    const projSec = relState.projs.length
      ? '<div class="rel-head rdetail__sec"><h2 class="entry__h">Related Projects</h2><div class="rel-pager" id="rel-projs-pager"></div></div><div class="project-list" id="rel-projs"></div>'
      : '';

    byId('research-mount').innerHTML =
      '<div class="trail"><a data-view="view-research" data-jump="to-areas">Research</a> › <span>' + richInline(a.title) + '</span></div>' +
      '<h1>' + richInline(a.title) + '</h1>' +
      '<div class="rdetail">' + img + '<div class="rdetail__body">' + body + '</div></div>' +
      pubsSec + projSec +
      '<button class="return" data-view="view-research" data-jump="to-areas">← Back to Research</button>';
    navigate('view-research-detail', null, null, { detail: 'research', id: id });
    renderRelPubs();
    renderRelProjs();
    checkPdfs();
  }

  /* Related Publications(5개)/Projects(3개) — 각 섹션 우상단 페이지 버튼 */
  const REL_PUB_SIZE = 5;
  const REL_PROJ_SIZE = 3;
  const relState = { pubs: [], projs: [], pubsPage: 0, projsPage: 0 };
  function relPagerHTML(kind, page, pages) {
    if (pages <= 1) return '';
    return '<button class="proj-pager__btn" data-rel="' + kind + ':prev"' + (page === 0 ? ' disabled' : '') + ' aria-label="이전">‹</button>' +
      '<span class="proj-pager__info">' + (page + 1) + ' / ' + pages + '</span>' +
      '<button class="proj-pager__btn" data-rel="' + kind + ':next"' + (page >= pages - 1 ? ' disabled' : '') + ' aria-label="다음">›</button>';
  }
  function renderRelPubs() {
    const mount = byId('rel-pubs'); if (!mount) return;
    const all = relState.pubs;
    const pages = Math.max(1, Math.ceil(all.length / REL_PUB_SIZE));
    relState.pubsPage = Math.max(0, Math.min(relState.pubsPage, pages - 1));
    const s = relState.pubsPage * REL_PUB_SIZE;
    mount.innerHTML = all.slice(s, s + REL_PUB_SIZE).map(p => p.prog ? progRow(p) : journalRow(p)).join('');
    const pg = byId('rel-pubs-pager'); if (pg) pg.innerHTML = relPagerHTML('pubs', relState.pubsPage, pages);
    checkPdfs();
  }
  function renderRelProjs() {
    const mount = byId('rel-projs'); if (!mount) return;
    const all = relState.projs;
    const pages = Math.max(1, Math.ceil(all.length / REL_PROJ_SIZE));
    relState.projsPage = Math.max(0, Math.min(relState.projsPage, pages - 1));
    const s = relState.projsPage * REL_PROJ_SIZE;
    mount.innerHTML = all.slice(s, s + REL_PROJ_SIZE).map(projectRowHTML).join('');
    const pg = byId('rel-projs-pager'); if (pg) pg.innerHTML = relPagerHTML('projs', relState.projsPage, pages);
  }

  /* ---------- Research Projects (5개씩 페이지 넘김) ---------- */
  /* 지원기관 로고 파일명 매핑 — data/research/partners.json { "한글명": "영문파일명" }.
     매핑에 있으면 그 파일명(영문)을, 없으면 f 값(한글) 그대로 파일명으로 사용. */
  let partnerLogos = {};
  function fundLogoImg(pr) {
    if (!pr.f) return '';
    const name = partnerLogos[pr.f] || pr.f;
    const b = 'images/partners/' + encodeURIComponent(name);
    return '<img class="fund-logo" loading="lazy" src="' + b + '.png" data-base="' + b + '" alt="' + pr.f + '" onerror="neoFundErr(this)">';
  }
  function projectRowHTML(pr) {
    const st = projectStatus(pr.p);
    const stChip = st ? '<span class="proj-status proj-status--' + st.k + '">' + st.t + '</span>' : '';
    return '<div class="project-row rise"><div class="project-row__main">' + fundLogoImg(pr) +
      '<div><div class="project-row__title">' + pr.t + '</div><div class="fund-name">' + pr.f + '</div></div>' +
    '</div><div class="project-row__end">' + stChip + '<span class="project-row__span">' + pr.p + '</span></div></div>';
  }
  const PROJ_PAGE_SIZE = 5;
  let projectsData = [];
  let projPage = 0;
  function paintProjects() {
    const mount = byId('project-list');
    if (!mount) return;
    const all = projectsData;
    const pages = Math.max(1, Math.ceil(all.length / PROJ_PAGE_SIZE));
    projPage = Math.max(0, Math.min(projPage, pages - 1));
    const start = projPage * PROJ_PAGE_SIZE;
    mount.innerHTML = all.slice(start, start + PROJ_PAGE_SIZE).map(projectRowHTML).join('');
    const pager = byId('proj-pager');
    if (pager) {
      pager.innerHTML = pages > 1
        ? '<button class="proj-pager__btn" data-proj-page="prev"' + (projPage === 0 ? ' disabled' : '') + ' aria-label="이전">‹</button>' +
          '<span class="proj-pager__info">' + (projPage + 1) + ' / ' + pages + '</span>' +
          '<button class="proj-pager__btn" data-proj-page="next"' + (projPage >= pages - 1 ? ' disabled' : '') + ' aria-label="다음">›</button>'
        : '';
    }
  }
  function turnProjPage(dir) { projPage += dir; paintProjects(); setTimeout(revealPass, 30); }

  /* 지원기관 로고 로드 실패 시 확장자 순차 시도(png→jpg→svg→...) 후 없으면 숨김 */
  window.neoFundErr = function (img) {
    const exts = ['jpg', 'svg', 'jpeg', 'webp'];
    const i = +img.dataset.i || 0;
    if (i < exts.length) { img.dataset.i = i + 1; img.src = img.dataset.base + '.' + exts[i]; }
    else { img.remove(); }
  };

  /* 확장자 자동 탐색(첫 시도 .jpg 이후 순차) 후 실패 시 폴백.
     data-fb="icon" → 부모를 아이콘으로 교체(Facility), 그 외 → 제거(멤버 사진 → 이니셜) */
  window.neoImg = function (img) {
    const exts = ['jpg', 'png', 'jpeg', 'webp'];
    const i = (+img.dataset.i || 0) + 1;
    if (i < exts.length) { img.dataset.i = i; img.src = img.dataset.base + '.' + exts[i]; return; }
    if (img.dataset.fb === 'icon' && img.dataset.icon) img.parentElement.innerHTML = decodeURIComponent(img.dataset.icon);
    else img.remove();
  };

  /* ==========================================================================
     부트스트랩
     ========================================================================== */
  async function boot() {
    let members, projects, papers, news, bibText, jcrRaw, facility, areas, partners;
    try {
      [members, projects, papers, news, bibText, jcrRaw, facility, areas, partners] = await Promise.all([
        fetchMembers(),
        fetchJSON('research/projects.json'),
        fetchJSON('publications/patents.json'),
        fetchNews(),
        fetchText('publications/ref.bib').catch(() => ''),
        fetchJSON('publications/jcr.json').catch(() => ({})),
        fetchJSON('research/facility.json').catch(() => []),
        fetchJSON('research/areas.json').catch(() => []),
        fetchJSON('research/partners.json').catch(() => ({}))
      ]);
    } catch (err) {
      console.error(err);
      return;
    }
    partnerLogos = partners || {};
    /* JCR: 저널명을 정규화한 조회표로 변환 */
    Object.keys(jcrRaw || {}).forEach(yr => {
      JCR[yr] = {};
      Object.keys(jcrRaw[yr]).forEach(j => { JCR[yr][normJournal(j)] = jcrRaw[yr][j]; });
    });
    store.members = members;
    store.news = news;

    /* 멤버 */
    indexMembers(members);
    members.forEach(m => { if (m.en) memberNames[normName(m.en)] = 1; });
    paintMembers();

    /* 인턴(있으면 표시, 없으면 섹션 숨김) */
    fetchJSON('members/interns.json')
      .then(paintInterns)
      .catch(() => { const b = byId('intern-block'); if (b) b.style.display = 'none'; });

    /* Research Areas (이미지 카드 + See More 상세) */
    paintResearchAreas(areas);

    /* 프로젝트 — 최신순 5개씩 페이지 넘김 */
    projectsData = (projects || []).slice().sort((a, b) => projStart(b.p) - projStart(a.p));
    projPage = 0;
    paintProjects();

    /* Facility */
    paintFacility(facility);

    /* News */
    paintNewsMedia();
    paintNewsBoards();
    paintFeed();

    /* 논문 — BibTeX(data/ref.bib): year=In Progress 는 목록 맨 위, 나머지는 연도별 저널.  특허 — publications.json */
    const allBib = parseBib(bibText || '');
    journalsData = allBib.filter(p => !p.prog).sort((a, b) => (b.y - a.y) || (b._i - a._i));
    progData = allBib.filter(p => p.prog);
    paintYearFilter();
    paintJournals();
    const pats = papers.patents || [];
    patentsData = pats;
    const intlPat = pats.filter(p => patRegion(p) === 'intl');
    const domPat = pats.filter(p => patRegion(p) === 'domestic');
    byId('pset-patent').innerHTML =
      (intlPat.length ? '<h3 class="pat-head">International</h3>' + intlPat.map(patentRow).join('') : '') +
      (domPat.length ? '<h3 class="pat-head">Domestic (Korea)</h3>' + domPat.map(patentRow).join('') : '');
    checkPdfs();

    revealPass();

    /* HOME 이미지가 끝난 뒤, 나머지 화면 이미지를 정해진 순서로 백그라운드 예열
       (Members → Facility → Research → News → Publications). 방문 시 캐시에서 즉시 표시됨. */
    if (document.readyState === 'complete') setTimeout(warmImages, 400);
    else window.addEventListener('load', () => setTimeout(warmImages, 400), { once: true });
  }

  /* 이미지 URL 목록을 한 번에 미리 받아옴(다 끝나면 resolve) */
  function preloadUrls(urls) {
    return Promise.all(urls.map(src => new Promise(res => {
      const im = new Image(); im.onload = im.onerror = () => res(); im.src = src;
    })));
  }
  /* 화면(스크린) 순서대로 그 안의 지연 이미지들을 그룹 단위로 순차 예열 */
  async function warmImages() {
    const order = ['view-members', 'view-facility', 'view-research', 'view-news', 'view-pubs'];
    for (const id of order) {
      const scr = byId(id);
      if (!scr) continue;
      const urls = Array.from(new Set(
        Array.prototype.slice.call(scr.querySelectorAll('img[loading="lazy"]'))
          .map(i => i.getAttribute('src')).filter(Boolean)
      ));
      if (urls.length) await preloadUrls(urls);   // 이 화면이 다 받아진 뒤 다음 화면으로
    }
  }

  /* ==========================================================================
     라우팅 초기화 — 주소 복원 · 뒤로/앞으로 처리
     ========================================================================== */
  /* 스크롤 위치는 우리가 직접 관리(브라우저 자동복원 끔) */
  if ('scrollRestoration' in history) { try { history.scrollRestoration = 'manual'; } catch (e) {} }

  /* 뒤로/앞으로 — 기록에 저장된 화면(그리고 상세 카드)과 스크롤 위치를 복원 */
  window.addEventListener('popstate', function (e) {
    var st = e.state || {};
    suppressHistory = true;
    pendingScroll = (typeof st.scroll === 'number') ? st.scroll : 0;
    if (st.detail === 'member') openMember(st.id);
    else if (st.detail === 'article') openArticle(st.atype, st.id);
    else if (st.detail === 'research') openResearch(st.id);
    else navigate(st.v || pathToView(), st.j, st.f);
    suppressHistory = false;
  });

  /* 첫 진입/새로고침 — 주소(예: /research)에 맞는 화면을 표시 */
  (function initRoute() {
    var viewId = pathToView();
    suppressHistory = true;
    navigate(viewId);
    suppressHistory = false;
    try { history.replaceState({ v: viewId, scroll: 0 }, '', viewToPath(viewId)); } catch (e) {}
  })();

  /* 데이터 로딩과 무관하게, 정적 콘텐츠(히어로·섹션 제목)를 즉시 표시 */
  revealPass();
  boot();
})();
