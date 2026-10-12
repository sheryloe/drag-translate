/* 설정 — 기본값·검증·저장. 확장 프로그램의 모든 화면과 서비스 워커가 함께 쓴다.
 * 브라우저에서는 globalThis.DT.config, 노드 시험에서는 module.exports로 쓴다. */
(function (root) {
  "use strict";

  /** 번역할 언어 — 파파고와 구글이 모두 지원하는 언어만 둔다. */
  const LANGUAGES = Object.freeze([
    { code: "ko", name: "한국어" },
    { code: "en", name: "영어" },
    { code: "ja", name: "일본어" },
    { code: "zh-CN", name: "중국어(간체)" },
    { code: "zh-TW", name: "중국어(번체)" },
    { code: "vi", name: "베트남어" },
    { code: "th", name: "태국어" },
    { code: "id", name: "인도네시아어" },
    { code: "fr", name: "프랑스어" },
    { code: "es", name: "스페인어" },
    { code: "ru", name: "러시아어" },
    { code: "de", name: "독일어" },
    { code: "it", name: "이탈리아어" },
  ]);

  const ENGINES = Object.freeze(["google", "papago", "local"]);
  const LOCAL_MODES = Object.freeze(["ollama", "openai"]);

  /** 방식마다 처음 쓰는 서버 주소 — Ollama는 11434, LM Studio는 1234. */
  const LOCAL_SERVERS = Object.freeze({ ollama: "http://localhost:11434", openai: "http://localhost:1234" });

  /** 내 PC 번역 서버로 허용하는 이름 — 보안 문서가 PC 밖으로 나가지 않게 이 셋만 받는다. */
  const LOCAL_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);
  const TRIGGERS = Object.freeze(["instant", "icon"]);

  /** 한 번에 번역하는 최대 글자 수(파파고 웹·구글 모두 이 안에서 안정적이다). */
  const MAX_TEXT = 5000;

  const DEFAULTS = Object.freeze({
    enabled: true, // 드래그 번역 켜기
    engine: "google", // google: 그 자리에서 번역 · papago: 파파고 웹사이트를 새 탭으로
    targetLang: "ko", // 번역할 언어
    trigger: "instant", // instant: 드래그 즉시 · icon: 작은 아이콘을 눌러야 번역
    minLength: 2, // 이보다 짧은 선택은 무시
    ignoreEditable: true, // 입력칸·편집 영역 안의 선택은 무시
    pdfAutoOpen: true, // PDF 주소를 열면 번역 뷰어로 연다
    localMode: "ollama", // 내 PC 번역 서버 방식 — ollama: Ollama · openai: LM Studio·llama.cpp 같은 OpenAI 호환 서버
    localServer: LOCAL_SERVERS.ollama, // 내 PC 번역 서버 주소(localhost·127.0.0.1·[::1]만)
    localModel: "qwen2.5:7b", // 번역에 쓸 모델 이름
    localTimeout: 120, // 내 PC 번역 서버의 답을 기다리는 시간(초)
  });

  /** 사람이 적은 주소를 「http://이름:포트」 꼴로 다듬는다. 내 PC 주소가 아니면 null. */
  function normalizeServerUrl(raw) {
    let value = String(raw ?? "").trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!LOCAL_HOSTS.includes(url.hostname.toLowerCase())) return null;
    return url.origin;
  }

  function isLocalServerUrl(raw) {
    return normalizeServerUrl(raw) !== null;
  }

  function languageName(code) {
    const hit = LANGUAGES.find((lang) => lang.code === code);
    return hit ? hit.name : code;
  }

  /** 저장된 값이 깨졌거나 예전 판이어도 늘 쓸 수 있는 설정을 돌려준다. */
  function normalize(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const out = { ...DEFAULTS };
    if (typeof value.enabled === "boolean") out.enabled = value.enabled;
    if (ENGINES.includes(value.engine)) out.engine = value.engine;
    if (LANGUAGES.some((lang) => lang.code === value.targetLang)) out.targetLang = value.targetLang;
    if (TRIGGERS.includes(value.trigger)) out.trigger = value.trigger;
    if (Number.isInteger(value.minLength) && value.minLength >= 1 && value.minLength <= 50) out.minLength = value.minLength;
    if (typeof value.ignoreEditable === "boolean") out.ignoreEditable = value.ignoreEditable;
    if (typeof value.pdfAutoOpen === "boolean") out.pdfAutoOpen = value.pdfAutoOpen;
    if (LOCAL_MODES.includes(value.localMode)) out.localMode = value.localMode;
    const server = normalizeServerUrl(value.localServer);
    out.localServer = server || LOCAL_SERVERS[out.localMode];
    if (typeof value.localModel === "string" && value.localModel.trim() && value.localModel.trim().length <= 200) out.localModel = value.localModel.trim();
    if (Number.isInteger(value.localTimeout) && value.localTimeout >= 10 && value.localTimeout <= 600) out.localTimeout = value.localTimeout;
    return out;
  }

  /** 저장소를 쓸 수 없는 곳(확장 밖에서 화면을 시험할 때 등)에서는 기본값으로 돈다. */
  const storage = () => (typeof chrome !== "undefined" && chrome.storage ? chrome.storage : null);

  async function load() {
    const area = storage();
    if (!area) return normalize(undefined);
    const stored = await area.sync.get("settings");
    return normalize(stored.settings);
  }

  async function save(patch) {
    const next = normalize({ ...(await load()), ...patch });
    const area = storage();
    if (area) await area.sync.set({ settings: next });
    return next;
  }

  function onChange(callback) {
    const area = storage();
    if (!area) return;
    area.onChanged.addListener((changes, name) => {
      if (name === "sync" && changes.settings) callback(normalize(changes.settings.newValue));
    });
  }

  const api = {
    LANGUAGES,
    ENGINES,
    TRIGGERS,
    LOCAL_MODES,
    LOCAL_SERVERS,
    LOCAL_HOSTS,
    MAX_TEXT,
    DEFAULTS,
    languageName,
    normalizeServerUrl,
    isLocalServerUrl,
    normalize,
    load,
    save,
    onChange,
  };
  root.DT = Object.assign(root.DT || {}, { config: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
