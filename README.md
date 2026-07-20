---

## 폴더 지도

```
neo-lab/
├── index.html      화면 뼈대 · 메뉴 · 히어로   (구조를 바꿀 때만)
├── theme.css       색상 · 간격 · 레이아웃       (디자인을 바꿀 때만)
├── site.js         동작 로직                    (거의 손댈 일 없음)
│
├── data/           ← 내용은 전부 여기서 관리
│   ├── members/            멤버 (그룹별 폴더)
│   │   ├── postdoc/        · msphd/ · masters/ · undergraduate/ · alumni/
│   │   │   ├── _index.json     표시 순서(파일명 목록)
│   │   │   └── 조해인.json      한 명 = 파일 하나
│   │   └── interns.json    인턴 명단 (연도별)
│   ├── research/
│   │   ├── areas.json      연구분야 (카드 + 상세 페이지)
│   │   ├── projects.json   연구 과제
│   │   └── facility.json   장비/시설
│   ├── publications/
│   │   ├── ref.bib         저널 논문 (BibTeX)
│   │   ├── patents.json    특허
│   │   └── jcr.json        JCR 랭킹(저널 상위% 강조용)
│   └── news/
│       ├── media/          언론보도 (한 건 = 파일 하나)
│       ├── paper.json      논문 게재 소식 (배열)
│       ├── award.json      수상 (배열)
│       └── grant.json      과제 선정 (배열)
│
├── images/         ← 사진 (경로 없이 파일명만 JSON 에 적음)
│   ├── members/           멤버 사진 (한 폴더에 모음, <이름>.jpg)
│   ├── research/          연구분야 카드/상세 이미지
│   ├── facility/          장비 사진
│   ├── news/              언론보도 대표 사진
│   ├── covers/            논문 커버 이미지
│   ├── partners/          지원기관 로고 (<기관명>.png)
│   └── site/              favicon · gist-logo · hero-banner
│
└── files/          ← 다운로드용 첨부 (PDF 등)
    ├── cv/                CV       (<파일명>.pdf)
    ├── publication/       논문 PDF (<ref.bib 인용키>.pdf)
    └── patent/           특허 증서 (<특허 id>.pdf)
```

---

## 공통 문법 — 강조·색·링크

뉴스 제목/본문, 멤버 `note` 등 일부 텍스트에는 다음 서식을 쓸 수 있습니다.

- `**굵게**` → **굵게**
- `{red|빨강}` `{green|초록}` `{blue|파랑}` `{amber|주황}` `{gray|회색}` — 또는 `{#D42A1A|직접색}`
- `[보이는 글자](https://링크)` → 새 탭 링크

---

## 멤버 — `data/members/<그룹>/<이름>.json`

그룹 폴더는 `postdoc` · `msphd` · `masters` · `undergraduate` · `alumni` 5개입니다. 어느 폴더에 넣느냐로 표시 묶음이 정해집니다. 각 폴더의 `_index.json`(파일명 배열)이 **표시 순서**를 정하므로, 새 멤버는 (1) `<이름>.json` 파일을 만들고 (2) `_index.json` 배열에 그 이름을 한 줄 추가하면 됩니다.

**기본 카드 (학생 등):**

```json
{
  "id": "이준서",
  "ko": "이준서",
  "en": "June Seo Lee",
  "init": "JL",
  "img": "이준서.png",
  "role": "M.S. Student",
  "admit": "2025-03",
  "email": "leejuneseo@gm.gist.ac.kr",
  "note": "Co-advisor: [Prof. Young Min Song](https://www.ymsong.net/)"
}
```

- **`id`** 는 파일명과 같게. **`ko`/`en`** 한글·영문 이름, **`init`** 사진 없을 때 표시할 이니셜.
- **`img`** 는 `images/members/` 안의 파일명(경로 없이). 비우면(`""`) 이니셜이 표시됩니다.
- **`role`** 표시 지위. **`admit`** (`"YYYY-MM"`, 선택)을 적으면 오늘 기준 학기 수가 자동 계산되어 붙습니다.
- **`email`**, **`note`**(선택, 위 서식 사용 가능), **`cv`**(선택, `files/cv/<파일>.pdf`) — CV 버튼이 생깁니다.

**상세 카드 (Postdoc 등) — 추가 필드:**

```json
{
  "education":  ["Ph.D., Korea University (2018 – 2024)"],
  "experience": ["Postdoctoral Researcher, University of Virginia (2025 – 2026)"],
  "pubs": [
    { "y": "2025", "a": "저자 (본인은 <b>...</b>)", "t": "논문 제목", "v": "학술지 정보" }
  ],
  "awards": ["Young Scientist Award, ... (2024)"]
}
```

**졸업생(alumni) — 이력 대신 기간/현재:**

```json
{ "id": "박소은", "ko": "박소은", "en": "Soeun Park", "init": "SP",
  "role": "M.S.", "period": "2023.03 - 2025.02", "now": "한국나노기술원" }
```

**멤버 카드를 누르면** 상세 페이지가 열리며, 위 내용과 함께 아래가 **자동으로** 붙습니다.

- **Patents / Publications** — `ref.bib`·`patents.json`의 저자 이름에서 해당 멤버(한글·영문 모두)를 자동 감지해 목록화합니다.
- **Awards** — 멤버 `awards`에 더해, `award.json`·`grant.json`의 `members` 배열에 이 멤버 `id`가 들어간 항목이 자동으로 붙습니다.

### 인턴 — `data/members/interns.json`

연도별 배열입니다. `note`(선택)에 진학/취업 등을 적습니다.

```json
[ { "year": "2026", "people": [ { "name": "정동현", "note": "군휴학" }, { "name": "최재우" } ] } ]
```

---

## 장비/시설 — `data/research/facility.json`

카테고리별 가로 스크롤 카드입니다.

```json
{
  "cat": "G-NICS Clean Room",
  "cards": [
    { "img": "EBL.png", "name": "E-beam Lithography", "desc": "설명(선택)" }
  ]
}
```
