(function (global) {
  "use strict";

  /*
   * 이 파일의 수치는 대학이 발표한 입시 결과가 아니다.
   * 사용자가 목표 대학/전공을 고를 때 공부 목표를 자동으로 제안하기 위한
   * 로컬 추정 모델이며, 합격선·합격 확률·지원 가능 여부로 사용하면 안 된다.
   */

  const MODEL_VERSION = "2.1.0";
  const ESTIMATE_SOURCE = "앱 내부 추정 모델(공식 입결 자료 미사용)";
  const DISCLAIMER =
    "이 값은 공식 정시 입결이나 합격 예측이 아닌 앱 내부 학습목표 추정치입니다. " +
    "실제 지원 전에는 해당 연도 대학 입학처 모집요강과 공식 결과를 반드시 확인하세요.";
  const COMMON_LIMITATIONS = [
    "대학별 환산점수·영역별 반영비율을 반영하지 않음",
    "모집군·모집인원·가산점·탐구 변환점수를 반영하지 않음",
    "연도별 난이도와 경쟁률 변화를 반영하지 않음",
    "표준점수·백분위를 단순 평균등급으로 정확히 환산할 수 없음",
    "표시된 전공명은 선택을 돕는 대표 전공 분야이며 실제 개설 여부를 보장하지 않음"
  ];

  const CONFIDENCE_LEVELS = Object.freeze({
    veryLow: Object.freeze({ level: "very-low", label: "매우 낮음", score: 0.14 }),
    low: Object.freeze({ level: "low", label: "낮음", score: 0.24 }),
    lowPlus: Object.freeze({ level: "low", label: "낮음", score: 0.3 })
  });

  const UNIVERSITY_GROUPS = [
    {
      id: "seoul-core-a",
      name: "서울 주요 A군",
      commonLabel: "최상위권 학습목표군",
      description: "앱 내부에서 가장 높은 학습 목표 구간으로 묶은 비교용 대학군",
      rangeWidth: 0.65,
      confidenceKey: "lowPlus",
      sortOrder: 10
    },
    {
      id: "seoul-core-b",
      name: "서울 주요 B군",
      commonLabel: "상위권 학습목표군",
      description: "서울 소재 주요 대학 가운데 높은 학습 목표 구간으로 묶은 앱 내부 분류",
      rangeWidth: 0.72,
      confidenceKey: "lowPlus",
      sortOrder: 20
    },
    {
      id: "seoul-major",
      name: "서울 주요 C군",
      commonLabel: "서울 주요 대학 학습목표군",
      description: "서로 다른 전형 구조를 단순한 학습 목표 구간으로만 묶은 앱 내부 분류",
      rangeWidth: 0.78,
      confidenceKey: "low",
      sortOrder: 30
    },
    {
      id: "seoul-mid-high",
      name: "서울 주요 D군",
      commonLabel: "서울 중상위 학습목표군",
      description: "공식 서열이 아닌 앱 화면 탐색과 목표 설정을 위한 임의 분류",
      rangeWidth: 0.84,
      confidenceKey: "low",
      sortOrder: 40
    },
    {
      id: "capital-major",
      name: "수도권 주요 대학군",
      commonLabel: "수도권 중상위 학습목표군",
      description: "서울·인천·경기 소재 대학을 앱 내부 목표 구간으로 묶은 분류",
      rangeWidth: 0.9,
      confidenceKey: "low",
      sortOrder: 50
    },
    {
      id: "capital-broad",
      name: "수도권 폭넓은 대학군",
      commonLabel: "수도권 목표 탐색군",
      description: "다양한 전공을 폭넓게 탐색하기 위한 앱 내부 분류",
      rangeWidth: 1,
      confidenceKey: "low",
      sortOrder: 60
    },
    {
      id: "regional-flagship",
      name: "지역거점 국립대학군",
      commonLabel: "지역거점 학습목표군",
      description: "지역별 선택지를 탐색하기 위한 묶음이며 대학 간 공식 순위를 뜻하지 않음",
      rangeWidth: 1.05,
      confidenceKey: "low",
      sortOrder: 70
    }
  ];

  const MAJOR_GROUPS = [
    { id: "humanities", name: "인문·언어", icon: "📚", description: "언어, 문학, 역사, 철학 중심" },
    { id: "social", name: "사회과학", icon: "🏛️", description: "행정, 정치, 사회, 심리, 미디어 중심" },
    { id: "business", name: "경영·경제", icon: "📈", description: "경영, 경제, 회계, 국제통상 중심" },
    { id: "natural", name: "자연과학", icon: "🔬", description: "수학, 물리, 화학, 생명, 통계 중심" },
    { id: "engineering", name: "공학", icon: "⚙️", description: "컴퓨터, 전자, 기계, 화공, 건축 중심" },
    { id: "health", name: "의약·보건", icon: "🩺", description: "의학, 약학, 간호, 보건 분야(별도 확인 필수)" },
    { id: "education", name: "교육", icon: "🧑‍🏫", description: "교과교육, 교육학 중심" },
    { id: "arts", name: "예체능", icon: "🎨", description: "디자인, 체육, 공연·영상 분야(실기 반영 미포함)" },
    { id: "convergence", name: "융합·자율", icon: "🧩", description: "데이터, AI융합, 국제, 자유전공 분야" }
  ];

  // adjustment는 대학 기준값에 더하는 앱 내부 보정치다. 등급은 숫자가 작을수록 높은 목표다.
  const DEPARTMENT_ROWS = [
    ["korean-language", "국어국문학", "humanities", 0.16, 0.18, ["국문", "한국어문"]],
    ["english-language", "영어영문학", "humanities", 0.12, 0.18, ["영문", "영어학"]],
    ["history", "사학", "humanities", 0.18, 0.2, ["역사학"]],
    ["philosophy", "철학", "humanities", 0.2, 0.2, []],
    ["language-culture", "언어·문화학", "humanities", 0.15, 0.2, ["어문계열", "외국어"]],

    ["public-administration", "행정학", "social", -0.02, 0.16, ["행정"]],
    ["political-science", "정치외교학", "social", 0.02, 0.18, ["정외", "정치학"]],
    ["sociology", "사회학", "social", 0.1, 0.18, []],
    ["psychology", "심리학", "social", -0.14, 0.2, ["심리"]],
    ["media-communication", "미디어커뮤니케이션", "social", -0.13, 0.2, ["신문방송", "언론정보", "미디어"]],
    ["social-welfare", "사회복지학", "social", 0.13, 0.2, ["사회복지"]],

    ["business-administration", "경영학", "business", -0.12, 0.18, ["경영"]],
    ["economics", "경제학", "business", -0.08, 0.18, ["경제"]],
    ["accounting", "회계·세무학", "business", -0.01, 0.2, ["회계학", "세무학"]],
    ["international-trade", "국제통상학", "business", 0.04, 0.2, ["무역학", "글로벌통상"]],

    ["mathematics", "수학", "natural", 0.08, 0.18, ["수학과"]],
    ["physics", "물리학", "natural", 0.14, 0.2, ["물리"]],
    ["chemistry", "화학", "natural", 0.1, 0.2, ["화학과"]],
    ["life-science", "생명과학", "natural", -0.01, 0.22, ["생물학", "생명"]],
    ["statistics", "통계학", "natural", -0.1, 0.2, ["응용통계"]],
    ["environmental-science", "환경과학", "natural", 0.12, 0.22, ["환경학"]],

    ["computer-ai", "컴퓨터·인공지능", "engineering", -0.28, 0.24, ["컴퓨터공학", "AI", "인공지능학"]],
    ["software", "소프트웨어", "engineering", -0.24, 0.22, ["소프트웨어학", "SW"]],
    ["electrical-electronics", "전기·전자공학", "engineering", -0.18, 0.2, ["전자공학", "전기공학"]],
    ["semiconductor", "반도체공학", "engineering", -0.27, 0.28, ["반도체시스템", "반도체"]],
    ["mechanical", "기계공학", "engineering", -0.03, 0.2, ["기계"]],
    ["industrial", "산업공학", "engineering", -0.08, 0.2, ["산업시스템"]],
    ["chemical-engineering", "화학공학", "engineering", -0.1, 0.22, ["화공"]],
    ["materials", "신소재공학", "engineering", -0.05, 0.22, ["재료공학", "신소재"]],
    ["architecture", "건축·도시공학", "engineering", 0.02, 0.24, ["건축학", "도시공학"]],
    ["civil-environment", "건설·환경공학", "engineering", 0.11, 0.24, ["토목공학", "환경공학"]],
    ["bio-engineering", "바이오공학", "engineering", -0.12, 0.24, ["생명공학", "의생명공학"]],

    ["medicine", "의예·의학", "health", -0.78, 0.42, ["의예과", "의학과"], "의약학 계열은 대학별 선발 방식 차이가 특히 커 공식 자료 확인이 필수입니다."],
    ["pharmacy", "약학", "health", -0.55, 0.38, ["약학과"], "약학 계열은 과목 제한과 대학별 환산 방식을 별도로 확인해야 합니다."],
    ["nursing", "간호학", "health", -0.18, 0.3, ["간호"]],
    ["public-health", "보건·의료관리", "health", 0.04, 0.28, ["보건학", "의료경영"]],

    ["korean-education", "국어교육", "education", -0.05, 0.24, ["국어교육과"]],
    ["english-education", "영어교육", "education", -0.05, 0.24, ["영어교육과"]],
    ["math-education", "수학교육", "education", -0.1, 0.24, ["수학교육과"]],
    ["education-studies", "교육학", "education", 0, 0.24, ["교육학과"]],

    ["visual-design", "시각·산업디자인", "arts", 0.02, 0.55, ["디자인", "시각디자인", "산업디자인"], "실기·포트폴리오를 반영하지 않은 수능 학습목표 참고값입니다."],
    ["sports", "체육·스포츠", "arts", 0.14, 0.58, ["체육학", "스포츠과학"], "실기와 종목별 전형 차이를 반영하지 않습니다."],
    ["film-performance", "영상·공연예술", "arts", 0.08, 0.62, ["영화", "연극", "공연"], "실기·면접 비중을 반영하지 않은 수능 학습목표 참고값입니다."],

    ["data-science", "데이터사이언스", "convergence", -0.22, 0.25, ["데이터과학", "빅데이터"]],
    ["ai-convergence", "AI융합", "convergence", -0.25, 0.28, ["인공지능융합", "AI융합학부"]],
    ["international-studies", "국제학", "convergence", -0.1, 0.25, ["국제학부", "글로벌학"]],
    ["liberal-studies", "자유전공·자율전공", "convergence", 0.02, 0.3, ["자유전공", "자율전공"]],
    ["climate-energy", "기후·에너지융합", "convergence", 0.03, 0.28, ["에너지학", "기후환경"]]
  ];

  const DEPARTMENTS = DEPARTMENT_ROWS.map(function (row) {
    return {
      id: row[0],
      name: row[1],
      groupId: row[2],
      estimateAdjustment: row[3],
      uncertainty: row[4],
      aliases: row[5],
      caution: row[6] || "",
      selectionType: "representative-major-area",
      isVerifiedOffering: false,
      offeringNote: "대표 전공 분야이며 선택한 대학의 실제 개설 학과명은 입학처에서 확인해야 합니다."
    };
  });

  const DEFAULT_MAJOR_GROUP_IDS = MAJOR_GROUPS.map(function (group) { return group.id; });

  /*
   * row: id, 이름, 약칭, 지역, 대학군, 앱 기준값, 캠퍼스 목록, 별칭
   * 캠퍼스는 선택 UI 세분화를 위한 정보이며, 보정치 0은 캠퍼스별 입결을 추정하지 않는다는 뜻이다.
   */
  const UNIVERSITY_ROWS = [
    ["seoul-national", "서울대학교", "서울대", "서울", "seoul-core-a", 1.2, [["gwanak", "관악캠퍼스", "서울", 0]], ["SNU"]],
    ["yonsei", "연세대학교", "연세대", "서울", "seoul-core-a", 1.3, [["sinchon", "신촌캠퍼스", "서울", 0]], ["연대"]],
    ["korea", "고려대학교", "고려대", "서울", "seoul-core-a", 1.35, [["seoul", "서울캠퍼스", "서울", 0]], ["고대"]],

    ["sogang", "서강대학교", "서강대", "서울", "seoul-core-b", 1.55, [["sinchon", "신촌캠퍼스", "서울", 0]], []],
    ["sungkyunkwan", "성균관대학교", "성균관대", "서울·경기", "seoul-core-b", 1.58, [["humanities-social", "인문사회과학캠퍼스", "서울", 0], ["natural-sciences", "자연과학캠퍼스", "경기", 0]], ["성대", "SKKU"]],
    ["hanyang", "한양대학교", "한양대", "서울·경기", "seoul-core-b", 1.65, [["seoul", "서울캠퍼스", "서울", 0], ["erica", "ERICA캠퍼스", "경기", 0]], []],

    ["chung-ang", "중앙대학교", "중앙대", "서울·경기", "seoul-major", 1.85, [["seoul", "서울캠퍼스", "서울", 0], ["da-vinci", "다빈치캠퍼스", "경기", 0]], []],
    ["kyung-hee", "경희대학교", "경희대", "서울·경기", "seoul-major", 1.9, [["seoul", "서울캠퍼스", "서울", 0], ["global", "국제캠퍼스", "경기", 0]], []],
    ["hufs", "한국외국어대학교", "한국외대", "서울·경기", "seoul-major", 2.0, [["seoul", "서울캠퍼스", "서울", 0], ["global", "글로벌캠퍼스", "경기", 0]], ["외대", "HUFS"]],
    ["uos", "서울시립대학교", "서울시립대", "서울", "seoul-major", 1.88, [["seoul", "서울캠퍼스", "서울", 0]], ["시립대", "UOS"]],
    ["ewha", "이화여자대학교", "이화여대", "서울", "seoul-major", 1.92, [["seoul", "서울캠퍼스", "서울", 0]], ["이대"]],

    ["konkuk", "건국대학교", "건국대", "서울", "seoul-mid-high", 2.15, [["seoul", "서울캠퍼스", "서울", 0]], []],
    ["dongguk", "동국대학교", "동국대", "서울", "seoul-mid-high", 2.2, [["seoul", "서울캠퍼스", "서울", 0]], []],
    ["hongik", "홍익대학교", "홍익대", "서울·세종", "seoul-mid-high", 2.25, [["seoul", "서울캠퍼스", "서울", 0], ["sejong", "세종캠퍼스", "세종", 0]], []],

    ["inha", "인하대학교", "인하대", "인천", "capital-major", 2.3, [["incheon", "인천캠퍼스", "인천", 0]], []],
    ["ajou", "아주대학교", "아주대", "경기", "capital-major", 2.25, [["suwon", "수원캠퍼스", "경기", 0]], []],
    ["kookmin", "국민대학교", "국민대", "서울", "capital-major", 2.55, [["seoul", "서울캠퍼스", "서울", 0]], []],
    ["soongsil", "숭실대학교", "숭실대", "서울", "capital-major", 2.45, [["seoul", "서울캠퍼스", "서울", 0]], []],
    ["sejong", "세종대학교", "세종대", "서울", "capital-major", 2.5, [["seoul", "서울캠퍼스", "서울", 0]], []],
    ["dankook", "단국대학교", "단국대", "경기·충남", "capital-major", 2.7, [["jukjeon", "죽전캠퍼스", "경기", 0], ["cheonan", "천안캠퍼스", "충남", 0]], []],
    ["kwangwoon", "광운대학교", "광운대", "서울", "capital-major", 2.65, [["seoul", "서울캠퍼스", "서울", 0]], []],

    ["gachon", "가천대학교", "가천대", "경기", "capital-broad", 2.85, [["global", "글로벌캠퍼스", "경기", 0]], []],
    ["catholic", "가톨릭대학교", "가톨릭대", "경기", "capital-broad", 2.95, [["songsim", "성심교정", "경기", 0]], []],
    ["myongji", "명지대학교", "명지대", "서울·경기", "capital-broad", 3.15, [["humanities", "인문캠퍼스", "서울", 0], ["natural", "자연캠퍼스", "경기", 0]], []],
    ["sangmyung", "상명대학교", "상명대", "서울·충남", "capital-broad", 3.1, [["seoul", "서울캠퍼스", "서울", 0], ["cheonan", "천안캠퍼스", "충남", 0]], []],
    ["kyonggi", "경기대학교", "경기대", "경기·서울", "capital-broad", 3.35, [["suwon", "수원캠퍼스", "경기", 0], ["seoul", "서울캠퍼스", "서울", 0]], []],

    ["pusan-national", "부산대학교", "부산대", "부산", "regional-flagship", 2.5, [["busan", "부산캠퍼스", "부산", 0]], ["PNU"]],
    ["kyungpook-national", "경북대학교", "경북대", "대구", "regional-flagship", 2.55, [["daegu", "대구캠퍼스", "대구", 0]], ["KNU"]],
    ["chungnam-national", "충남대학교", "충남대", "대전", "regional-flagship", 2.75, [["daejeon", "대전캠퍼스", "대전", 0]], ["CNU"]],
    ["chonnam-national", "전남대학교", "전남대", "광주", "regional-flagship", 2.85, [["gwangju", "광주캠퍼스", "광주", 0]], []],
    ["jeonbuk-national", "전북대학교", "전북대", "전북", "regional-flagship", 3.0, [["jeonju", "전주캠퍼스", "전북", 0]], ["JBNU"]],
    ["chungbuk-national", "충북대학교", "충북대", "충북", "regional-flagship", 2.95, [["cheongju", "청주캠퍼스", "충북", 0]], ["CBNU"]],
    ["kangwon-national", "강원대학교", "강원대", "강원", "regional-flagship", 3.3, [["chuncheon", "춘천캠퍼스", "강원", 0]], []],
    ["gyeongsang-national", "경상국립대학교", "경상국립대", "경남", "regional-flagship", 3.25, [["jinju", "진주캠퍼스", "경남", 0]], ["GNU"]],
    ["jeju-national", "제주대학교", "제주대", "제주", "regional-flagship", 3.6, [["jeju", "아라캠퍼스", "제주", 0]], []]
  ];

  function clampGrade(value) {
    return Math.min(9, Math.max(1, value));
  }

  function roundGrade(value) {
    return Number(clampGrade(value).toFixed(1));
  }

  function normalizeText(value) {
    let text = String(value || "");
    // 영문 전각 문자와 호환 자모처럼 사용자가 휴대폰에서 입력할 수 있는 표기를 통일한다.
    if (typeof text.normalize === "function") text = text.normalize("NFKC");
    return text
      .toLowerCase()
      .replace(/대학교/g, "대")
      .replace(/[\s._·,/\\()\[\]{}'"’“”:+\-&]/g, "");
  }

  function normalizeMajorText(value) {
    return normalizeText(value)
      .replace(/(학부|전공|계열|과정)$/g, "")
      .replace(/과$/g, "")
      .replace(/^(학과|학부|전공|계열)/g, "");
  }

  /*
   * 실제 학과명은 대학마다 다르므로 아래 단어는 48개 대표 분야를 찾기 위한 검색어일 뿐이다.
   * 이 별칭으로 해당 대학에 학과가 개설되어 있다고 판단하지 않는다.
   */
  const DEPARTMENT_SEARCH_ALIASES = {
    "korean-language": ["국문과", "국문학", "한국어문학"],
    "english-language": ["영문과", "영문학"],
    history: ["역사", "국사", "한국사"],
    "language-culture": ["외국어문", "일어일문", "중어중문", "불어불문", "독어독문"],
    "public-administration": ["행정과"],
    "political-science": ["정치외교", "정외과"],
    psychology: ["심리상담", "상담심리"],
    "media-communication": ["미디어학", "커뮤니케이션", "신문방송학", "언론홍보", "미디어콘텐츠"],
    "social-welfare": ["사복", "사회복지학과"],
    "business-administration": ["경영과", "경영학부", "호텔경영"],
    economics: ["경제금융", "경제학과"],
    accounting: ["회계", "세무", "회계세무"],
    "international-trade": ["무역", "국제무역", "통상"],
    mathematics: ["수학과"],
    physics: ["물리과", "물리학과"],
    chemistry: ["화학과"],
    "life-science": ["생명과학과", "생물", "생물과학"],
    statistics: ["통계", "통계학과", "응용통계학"],
    "environmental-science": ["지구환경과학", "환경과학과"],
    "computer-ai": ["컴공", "컴퓨터", "컴퓨터과학", "컴퓨터과학부", "컴퓨터정보", "인공지능", "인공지능공학", "정보보호", "정보보안", "사이버보안"],
    software: ["소프트웨어공학", "소프트웨어융합", "소프트웨어학부", "소프트웨어학과"],
    "electrical-electronics": ["전전", "전기전자", "전자전기", "전기전자공학부", "전자정보"],
    semiconductor: ["반도체", "반도체시스템공학", "시스템반도체"],
    mechanical: ["기계", "기계공학과", "기계시스템"],
    industrial: ["산업공학과", "산업경영공학", "산업시스템공학"],
    "chemical-engineering": ["화공", "화학공학과", "화공생명공학"],
    materials: ["신소재", "재료", "재료공학과"],
    architecture: ["건축", "건축학과", "도시공학과"],
    "civil-environment": ["토목", "토목공학과", "건설환경", "사회기반시스템"],
    "bio-engineering": ["생명공학과", "바이오", "의생명", "생명시스템"],
    medicine: ["의대", "의예", "의예과", "의학과"],
    pharmacy: ["약대", "약학과"],
    nursing: ["간호", "간호학과"],
    "public-health": ["보건", "보건행정", "의료경영", "의료관리"],
    "korean-education": ["국교", "국어교육과"],
    "english-education": ["영교", "영어교육과"],
    "math-education": ["수교", "수학교육과"],
    "education-studies": ["교육학과"],
    "visual-design": ["시디", "시각디자인학과", "산업디자인학과", "디자인학부"],
    sports: ["체대", "체육학과", "스포츠학", "스포츠과학과"],
    "film-performance": ["영화과", "연극영화", "공연예술", "방송영상"],
    "data-science": ["데이터", "데사", "데이터과학", "빅데이터", "데이터분석"],
    "ai-convergence": ["인공지능융합", "AI융합학부", "에이아이융합"],
    "international-studies": ["국제학부", "글로벌학부", "국제지역학"],
    "liberal-studies": ["자전", "자유전공학부", "자율전공학부", "무전공"],
    "climate-energy": ["에너지", "에너지공학", "기후환경", "환경에너지"]
  };

  function levenshteinDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, function (_, index) { return index; });
    for (let i = 1; i <= left.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= right.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  function bigrams(value) {
    if (value.length < 2) return value ? [value] : [];
    const result = [];
    for (let index = 0; index < value.length - 1; index += 1) result.push(value.slice(index, index + 2));
    return result;
  }

  function diceSimilarity(left, right) {
    if (left === right) return 1;
    const leftPairs = bigrams(left);
    const rightPairs = bigrams(right);
    if (!leftPairs.length || !rightPairs.length) return 0;
    const remaining = rightPairs.slice();
    let overlap = 0;
    leftPairs.forEach(function (pair) {
      const index = remaining.indexOf(pair);
      if (index !== -1) {
        overlap += 1;
        remaining.splice(index, 1);
      }
    });
    return (2 * overlap) / (leftPairs.length + rightPairs.length);
  }

  function compareSearchText(query, candidate) {
    if (!query || !candidate) return { score: 0, matchType: "none" };
    if (query === candidate) return { score: 1, matchType: "exact" };

    const lengthGap = Math.abs(query.length - candidate.length);
    if (candidate.indexOf(query) === 0) {
      return { score: Math.max(0.74, 0.94 - lengthGap * 0.018), matchType: "prefix" };
    }
    if (query.indexOf(candidate) === 0) {
      return { score: Math.max(0.7, 0.9 - lengthGap * 0.018), matchType: "expanded" };
    }
    if (candidate.indexOf(query) !== -1 || query.indexOf(candidate) !== -1) {
      return { score: Math.max(0.66, 0.84 - lengthGap * 0.015), matchType: "contains" };
    }

    // 한 글자 입력은 오타 유사도로 자동 연결하지 않아 엉뚱한 대학·전공 선택을 막는다.
    if (query.length < 2 || candidate.length < 2) return { score: 0, matchType: "none" };
    const editSimilarity = 1 - levenshteinDistance(query, candidate) / Math.max(query.length, candidate.length);
    const dice = diceSimilarity(query, candidate);
    return {
      score: Math.max(0, editSimilarity * 0.42 + dice * 0.58),
      matchType: "related"
    };
  }

  function bestSearchMatch(query, candidates, normalizer) {
    const normalizedQuery = normalizer(query);
    let best = { score: 0, matchType: "none", matchedText: "" };
    candidates.forEach(function (candidate) {
      const compared = compareSearchText(normalizedQuery, normalizer(candidate));
      if (compared.score > best.score) {
        best = {
          score: compared.score,
          matchType: compared.matchType,
          matchedText: candidate
        };
      }
    });
    return best;
  }

  function searchUniversities(query, options) {
    options = options || {};
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    return UNIVERSITIES.map(function (university) {
      const candidates = [university.name, university.shortName].concat(university.aliases || []);
      const match = bestSearchMatch(query, candidates, normalizeText);
      return {
        id: university.id,
        name: university.name,
        shortName: university.shortName,
        region: university.region,
        university: university,
        score: Number(match.score.toFixed(3)),
        matchType: match.matchType,
        matchedText: match.matchedText,
        exact: match.matchType === "exact"
      };
    }).filter(function (result) {
      if (options.region && result.university.region.indexOf(options.region) === -1) return false;
      return result.score >= Number(options.minimumScore || 0.26);
    }).sort(function (left, right) {
      return right.score - left.score || left.name.localeCompare(right.name, "ko");
    }).slice(0, Math.max(1, Number(options.limit || 6)));
  }

  function searchDepartments(query, options) {
    options = options || {};
    const normalizedQuery = normalizeMajorText(query);
    if (!normalizedQuery) return [];
    const university = options.university ? getUniversity(options.university) : null;
    return DEPARTMENTS.filter(function (department) {
      if (options.groupId && department.groupId !== options.groupId) return false;
      if (university && university.availableMajorGroupIds.indexOf(department.groupId) === -1) return false;
      return true;
    }).map(function (department) {
      const candidates = [department.name]
        .concat(department.aliases || [])
        .concat(DEPARTMENT_SEARCH_ALIASES[department.id] || []);
      const match = bestSearchMatch(query, candidates, normalizeMajorText);
      const group = MAJOR_GROUPS.find(function (item) { return item.id === department.groupId; });
      return {
        id: department.id,
        name: department.name,
        groupId: department.groupId,
        groupName: group ? group.name : "",
        department: department,
        score: Number(match.score.toFixed(3)),
        matchType: match.matchType,
        matchedText: match.matchedText,
        exact: match.matchType === "exact"
      };
    }).filter(function (result) {
      return result.score >= Number(options.minimumScore || 0.24);
    }).sort(function (left, right) {
      return right.score - left.score || left.name.localeCompare(right.name, "ko");
    }).slice(0, Math.max(1, Number(options.limit || 6)));
  }

  function confidenceFor(score) {
    const safeScore = Math.max(0.05, Math.min(0.35, Number(score)));
    return {
      level: safeScore < 0.18 ? "very-low" : "low",
      label: safeScore < 0.18 ? "매우 낮음" : "낮음",
      score: Number(safeScore.toFixed(2)),
      reason: "공식 입결 자료가 아닌 앱 내부 규칙 기반 추정이므로 신뢰도를 낮게 설정했습니다."
    };
  }

  function makeRange(estimate, width) {
    const min = roundGrade(estimate - width);
    const max = roundGrade(estimate + width);
    return {
      min: min,
      max: max,
      label: min.toFixed(1) + "~" + max.toFixed(1) + "등급",
      unit: "수능 평균등급",
      interpretation: "숫자가 작을수록 더 높은 학습 목표이며, 합격구간을 뜻하지 않습니다."
    };
  }

  function groupById(groupId) {
    return UNIVERSITY_GROUPS.find(function (group) { return group.id === groupId; }) || null;
  }

  const UNIVERSITIES = UNIVERSITY_ROWS.map(function (row) {
    const group = groupById(row[4]);
    const confidenceTemplate = CONFIDENCE_LEVELS[group.confidenceKey];
    const estimate = roundGrade(row[5]);
    const campuses = row[6].map(function (campus) {
      return {
        id: campus[0],
        name: campus[1],
        region: campus[2],
        estimateAdjustment: campus[3],
        adjustmentNote: "공식 캠퍼스별 입결 자료가 없어 현재 모델에서는 캠퍼스 보정을 적용하지 않습니다."
      };
    });

    return {
      id: row[0],
      name: row[1],
      shortName: row[2],
      region: row[3],
      groupId: row[4],
      aliases: row[7],
      campuses: campuses,
      availableMajorGroupIds: DEFAULT_MAJOR_GROUP_IDS.slice(),
      selectionNote: "전공 목록은 실제 학과 편제가 아닌 대표 전공 분야입니다.",
      estimate: estimate,
      targetGrade: estimate,
      range: makeRange(estimate, group.rangeWidth),
      confidence: confidenceFor(confidenceTemplate.score),
      basis: {
        kind: "app-internal-estimate",
        official: false,
        source: ESTIMATE_SOURCE,
        summary: group.name + "의 앱 내부 기준값을 대학 단위 학습목표로 사용했습니다.",
        factors: [
          { id: "university-group", label: "대학군 기준", value: group.name },
          { id: "university-anchor", label: "앱 기준 등급", value: estimate }
        ],
        limitations: COMMON_LIMITATIONS.slice(),
        disclaimer: DISCLAIMER
      }
    };
  });

  function getUniversity(reference) {
    if (!reference) return null;
    if (typeof reference === "object") {
      reference = reference.id || reference.universityId || reference.name || reference.university;
    }
    const normalized = normalizeText(reference);
    return UNIVERSITIES.find(function (university) {
      const candidates = [university.id, university.name, university.shortName].concat(university.aliases || []);
      return candidates.some(function (candidate) { return normalizeText(candidate) === normalized; });
    }) || null;
  }

  function getDepartment(reference) {
    if (!reference) return null;
    if (typeof reference === "object") {
      reference = reference.id || reference.departmentId || reference.majorId || reference.name || reference.major;
    }
    const normalized = normalizeMajorText(reference);
    return DEPARTMENTS.find(function (department) {
      const candidates = [department.id, department.name]
        .concat(department.aliases || [])
        .concat(DEPARTMENT_SEARCH_ALIASES[department.id] || []);
      return candidates.some(function (candidate) { return normalizeMajorText(candidate) === normalized; });
    }) || null;
  }

  function getCampus(university, reference) {
    if (!university || !university.campuses.length) return null;
    if (!reference) return university.campuses.length === 1 ? university.campuses[0] : null;
    if (typeof reference === "object") reference = reference.id || reference.campusId || reference.name;
    const normalized = normalizeText(reference);
    return university.campuses.find(function (campus) {
      return normalizeText(campus.id) === normalized || normalizeText(campus.name) === normalized;
    }) || null;
  }

  function parseEstimateArguments(universityReference, departmentReference, options) {
    if (universityReference && typeof universityReference === "object") {
      const selection = universityReference;
      return {
        universityReference: selection.universityId || selection.university || selection.universityName,
        departmentReference: selection.departmentId || selection.majorId || selection.department || selection.major,
        options: selection
      };
    }
    return {
      universityReference: universityReference,
      departmentReference: departmentReference,
      options: options || {}
    };
  }

  function estimateAdmission(universityReference, departmentReference, options) {
    const parsed = parseEstimateArguments(universityReference, departmentReference, options);
    const university = getUniversity(parsed.universityReference);
    const department = getDepartment(parsed.departmentReference);
    if (!university || !department) return null;

    const campus = getCampus(university, parsed.options.campusId || parsed.options.campus);
    const group = groupById(university.groupId);
    const campusAdjustment = campus ? Number(campus.estimateAdjustment || 0) : 0;
    const rawEstimate = university.estimate + department.estimateAdjustment + campusAdjustment;
    const estimate = roundGrade(rawEstimate);
    const uncertainty = group.rangeWidth + department.uncertainty;
    const isSpecialRoute = department.groupId === "health" || department.groupId === "arts";
    const confidenceScore = university.confidence.score - (isSpecialRoute ? 0.1 : 0.03);
    const factors = [
      {
        id: "university-anchor",
        label: "대학 학습목표 기준",
        value: university.estimate,
        impact: university.estimate
      },
      {
        id: "major-adjustment",
        label: "대표 전공 분야 보정",
        value: department.name,
        impact: department.estimateAdjustment
      }
    ];

    if (campus) {
      factors.push({
        id: "campus-adjustment",
        label: "캠퍼스 보정",
        value: campus.name,
        impact: campusAdjustment,
        note: campus.adjustmentNote
      });
    }

    const specialLimitations = [];
    if (department.caution) specialLimitations.push(department.caution);
    if (!campus && university.campuses.length > 1) {
      specialLimitations.push("복수 캠퍼스 대학이지만 캠퍼스를 선택하지 않아 대학 공통 기준만 사용했습니다.");
    }

    return {
      estimate: estimate,
      targetGrade: estimate,
      estimateLabel: "약 " + estimate.toFixed(1) + "등급 (학습목표용)",
      metric: "synthetic-csat-average-grade",
      range: makeRange(estimate, uncertainty),
      confidence: confidenceFor(confidenceScore),
      basis: {
        kind: "app-internal-estimate",
        official: false,
        modelVersion: MODEL_VERSION,
        source: ESTIMATE_SOURCE,
        summary:
          university.name + "의 앱 내부 기준값에 " + department.name +
          " 전공 분야 보정을 적용한 공부 목표 제안입니다.",
        factors: factors,
        limitations: COMMON_LIMITATIONS.concat(specialLimitations),
        disclaimer: DISCLAIMER
      },
      university: {
        id: university.id,
        name: university.name,
        shortName: university.shortName,
        groupId: university.groupId,
        region: university.region
      },
      campus: campus ? { id: campus.id, name: campus.name, region: campus.region } : null,
      department: {
        id: department.id,
        name: department.name,
        groupId: department.groupId,
        selectionType: department.selectionType,
        isVerifiedOffering: false,
        offeringNote: department.offeringNote
      },
      official: false,
      disclaimer: DISCLAIMER
    };
  }

  function listUniversities(filters) {
    filters = filters || {};
    const query = normalizeText(filters.query || "");
    return UNIVERSITIES.filter(function (university) {
      if (filters.groupId && university.groupId !== filters.groupId) return false;
      if (filters.region && university.region.indexOf(filters.region) === -1) return false;
      if (!query) return true;
      const searchable = [university.id, university.name, university.shortName, university.region]
        .concat(university.aliases || [])
        .map(normalizeText);
      return searchable.some(function (value) { return value.indexOf(query) !== -1; });
    });
  }

  function listCampuses(universityReference) {
    const university = getUniversity(universityReference);
    return university ? university.campuses.slice() : [];
  }

  function listDepartments(universityReference, filters) {
    filters = filters || {};
    const university = getUniversity(universityReference);
    if (!university) return [];
    const query = normalizeMajorText(filters.query || "");
    return DEPARTMENTS.filter(function (department) {
      if (filters.groupId && department.groupId !== filters.groupId) return false;
      if (university.availableMajorGroupIds.indexOf(department.groupId) === -1) return false;
      if (!query) return true;
      const searchable = [department.id, department.name]
        .concat(department.aliases || [])
        .concat(DEPARTMENT_SEARCH_ALIASES[department.id] || [])
        .map(normalizeMajorText);
      return searchable.some(function (value) { return value.indexOf(query) !== -1; });
    }).map(function (department) {
      const result = estimateAdmission({
        universityId: university.id,
        departmentId: department.id,
        campusId: filters.campusId
      });
      return Object.assign({}, department, {
        estimate: result.estimate,
        targetGrade: result.targetGrade,
        range: result.range,
        confidence: result.confidence,
        basis: result.basis
      });
    });
  }

  function listMajorGroups(universityReference) {
    const university = universityReference ? getUniversity(universityReference) : null;
    if (universityReference && !university) return [];
    const allowedIds = university ? university.availableMajorGroupIds : DEFAULT_MAJOR_GROUP_IDS;
    return MAJOR_GROUPS.filter(function (group) { return allowedIds.indexOf(group.id) !== -1; }).map(function (group) {
      return Object.assign({}, group, {
        departmentCount: DEPARTMENTS.filter(function (department) { return department.groupId === group.id; }).length
      });
    });
  }

  function getSelectionTree() {
    return UNIVERSITY_GROUPS.slice()
      .sort(function (a, b) { return a.sortOrder - b.sortOrder; })
      .map(function (group) {
        return Object.assign({}, group, {
          universities: listUniversities({ groupId: group.id }).map(function (university) {
            return {
              id: university.id,
              name: university.name,
              shortName: university.shortName,
              region: university.region,
              campuses: university.campuses.slice(),
              estimate: university.estimate,
              range: university.range,
              confidence: university.confidence
            };
          })
        });
      });
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  const UNIVERSITY_ADMISSIONS = {
    meta: {
      modelVersion: MODEL_VERSION,
      title: "대학·전공별 정시 학습목표 로컬 추정 모델",
      dataKind: "synthetic-local-estimate",
      official: false,
      unit: "수능 평균등급(1등급이 가장 높음)",
      source: ESTIMATE_SOURCE,
      disclaimer: DISCLAIMER,
      limitations: COMMON_LIMITATIONS.slice()
    },
    universityGroups: UNIVERSITY_GROUPS,
    majorGroups: MAJOR_GROUPS,
    universities: UNIVERSITIES,
    departments: DEPARTMENTS,
    listUniversities: listUniversities,
    getUniversity: getUniversity,
    searchUniversities: searchUniversities,
    listCampuses: listCampuses,
    listMajorGroups: listMajorGroups,
    getDepartment: getDepartment,
    searchDepartments: searchDepartments,
    listDepartments: listDepartments,
    estimateAdmission: estimateAdmission,
    estimateTargetGrade: estimateAdmission,
    getSelectionTree: getSelectionTree
  };

  // 기존 코드가 UNIVERSITY_PRESETS.default.targetGrade를 읽는 경우를 계속 지원한다.
  const legacyPresets = {
    default: {
      targetGrade: 2,
      estimate: 2,
      range: makeRange(2, 1),
      confidence: confidenceFor(CONFIDENCE_LEVELS.veryLow.score),
      basis: {
        kind: "app-internal-estimate",
        official: false,
        source: ESTIMATE_SOURCE,
        summary: "대학과 전공을 아직 선택하지 않았을 때 사용하는 기본 학습목표입니다.",
        limitations: COMMON_LIMITATIONS.slice(),
        disclaimer: DISCLAIMER
      },
      note: DISCLAIMER
    }
  };

  UNIVERSITIES.forEach(function (university) {
    const preset = {
      universityId: university.id,
      universityName: university.name,
      targetGrade: university.targetGrade,
      estimate: university.estimate,
      range: university.range,
      confidence: university.confidence,
      basis: university.basis,
      note: DISCLAIMER
    };
    legacyPresets[university.id] = preset;
    legacyPresets[university.name] = preset;
    legacyPresets[university.shortName] = preset;
  });

  global.UniversityAdmissions = deepFreeze(UNIVERSITY_ADMISSIONS);
  global.UNIVERSITY_PRESETS = deepFreeze(legacyPresets);
})(typeof window !== "undefined" ? window : globalThis);
