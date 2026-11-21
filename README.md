# AI Studio XHigh Pin

Google AI Studio에서 어떤 모델을 사용하든 **Thinking Level(추론 레벨)**을 자동으로 최상위 옵션(예: `Extra High`, `High` 등 해당 모델에서 지원하는 최대치)으로 고정해 주는 Chrome 확장 프로그램입니다.

특정 모델명이나 레벨 이름(`Extra High` 등)을 하드코딩하지 않기 때문에, `gemini-4-neon`, `gemini-4-hydrogen`은 물론 앞으로 출시될 신규 모델과 새로운 상위 레벨에도 별도 수정 없이 자동으로 동작합니다.

## 주요 기능

- **모델 제한 없는 최대 추론 레벨 자동 고정**: `gemini-4-neon` / `gemini-4-hydrogen`에서는 `Extra High`, `gemini-4-carbon` / `gemini-3.8-flash` / `gemini-3.5-flash-lite` 등에서는 `High`처럼 해당 모델이 지원하는 가장 높은 활성 옵션을 자동 선택합니다.
- **무깜빡임 & 포커스 유지**: 드롭다운 메뉴를 열거나 입력창 포커스를 빼앗지 않고, Angular Material `mat-select`에 `End` 키 입력을 전달해 실제 모델 설정(`thinking_level`)까지 즉시 반영합니다.
- **SPA 전환 및 모델 변경 완벽 대응**: 새 채팅 접속, 모델 선택기에서 모델 전환, `Reset default settings` 클릭, Run settings 패널 재오픈, 비동기 로딩으로 인한 기본값 덮어쓰기까지 자동으로 감지해 재적용합니다.
- **수동 선택 존중 옵션 (기본 ON)**: 사용자가 직접 드롭다운에서 더 낮은 레벨을 선택하면 현재 채팅/모델에서는 그대로 유지하고, 다른 모델로 바꾸거나 초기화/새 채팅으로 이동하면 다시 최대 레벨로 고정합니다. (팝업에서 Strict 고정 모드로 변경 가능)
- **상태 확인 및 제어 팝업**: 툴바 아이콘을 클릭해 현재 모델과 Thinking Level 확인, 자동 고정 ON/OFF, 수동 오버라이드 허용 여부, `Pin Max Now` 즉시 적용을 할 수 있습니다.

## 설치 방법 (Chrome / Edge / Chromium)

별도 빌드 과정 없이 바로 로드할 수 있습니다.

1. 이 저장소를 클론하거나 ZIP으로 다운로드합니다.
   ```bash
   git clone https://github.com/devbattery/ai-studio-xhigh-pin.git
   ```
2. Chrome 주소창에 `chrome://extensions` 를 입력해 확장 프로그램 관리 페이지로 이동합니다.
3. 우측 상단의 **개발자 모드(Developer mode)** 를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다(Load unpacked)** 를 클릭하고 클론한 `ai-studio-xhigh-pin` 폴더를 선택합니다.
5. Google AI Studio (`https://aistudio.google.com/prompts/new_chat?model=gemini-4-neon` 등)에 접속하면 Thinking Level이 자동으로 최상위 옵션으로 고정됩니다.

## 프로젝트 구조

```text
ai-studio-xhigh-pin/
├── manifest.json          # Chrome Extension Manifest V3
├── icons/                 # 16, 32, 48, 128px PNG 아이콘
├── src/
│   ├── pin-logic.js       # 핵심 선택/상태 머신 로직 (단위 테스트 가능)
│   └── content.js         # AI Studio DOM 관찰, 신뢰 이벤트 구분, 스토리지/팝업 연동
├── popup/
│   ├── popup.html         # 확장 프로그램 팝업 UI
│   ├── popup.css
│   └── popup.js
└── tests/
    └── pin-logic.test.mjs # Node 내장 테스트 러너 기반 단위 테스트
```

## 테스트 실행

```bash
npm test
```
