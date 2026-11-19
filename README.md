# 공공데이터 교차검증기

KSPO(한국체육산업개발) 공공데이터를 쓰기 전에, 다른 기관 공공데이터와 맞춰 보고 찾은 주의사항(신뢰도 카드)과 보완 데이터를 제공하는 정적 웹입니다. 서버와 AI 호출 없이 동작합니다.

## 기능
1. **데이터 고르기**: 검사를 마친 KSPO 데이터 4종 또는 직접 받은 CSV 파일
2. **신뢰도 카드**: 규칙(A1~A8 내부 검사, B1~B4 교차 검증)에 걸린 문제와 쓰는 방법, 근거 그래프
3. **보완 데이터 내려받기**: 통합 공연 달력, 일별 퇴장 인파 지표, 신뢰도 카드 JSON
4. **함께 쓰면 좋은 데이터**: 대조에 쓴 공공데이터 안내
5. **오류 제보**: 제보 글을 만들어 공공데이터포털 오류신고로 연결

## 파일
| 파일 | 내용 |
|---|---|
| `index.html`, `app.js` | 화면 |
| `checks.js`, `worker.js` | 검사 엔진 (브라우저·node 공용). 올린 파일은 브라우저 안에서만 처리, 큰 파일은 worker에서 검사 |
| `data/rules.json` | 검사 규칙과 기준값. 이 파일만 고치면 기준이 바뀜 |
| `data/recommend.json` | 열 이름으로 함께 맞춰 볼 데이터를 추천하는 규칙 |
| `data/monitor.json`, `tools/recheck.js` | 매주 KSPO API 자동 재검사 |
| `data/trust.json` | 신뢰도 카드 (`kspo-trust-card/0.1`, AI·프로그램용) |
| `data/calendar_2025.csv` | 2025 올림픽공원 통합 공연 달력 (KOPIS + KSPO, 121건) |
| `data/daily_index_2025.csv` | 2025 올림픽공원역 일별 21~23시 승차 지표 (365일) |
| `data/sample_linked_2025.csv` | 예시 파일: KSPO 올림픽공원 2025 연계 데이터 7,803건 (API 수집본) |

## 실행
GitHub Pages에 그대로 올리면 됩니다. 로컬에서는 `data/`를 불러와야 하므로 파일을 직접 열지 말고 간단한 서버로 여세요.

```
python -m http.server 8000
```

검사 엔진만 node로 돌릴 수도 있습니다.

```js
const C = require('./checks.js');
const R = require('./data/rules.json');
const res = C.run(fs.readFileSync('파일.csv'), '파일.csv', R, ref);
```

## 사용한 공공데이터
- 한국체육산업개발: 올림픽공원 2025 차량입출차·공연·날씨 연계 데이터, 공연정보(KSCperf), 유실물(KSClost), 주차장 혼잡도
- 서울교통공사: 1~8호선 역별 일별 시간대별 승하차인원, 9호선 2·3단계 역별 일별 시간대별 승하차인원
- 예술경영지원센터: KOPIS 공연목록 API (공연시설 FC001247)

## 자동 재검사 (GitHub Actions)
`.github/workflows/site.yml`이 매주 월요일 오전 6시 17분(한국 시간)에 `tools/recheck.js`를 돌려, `data/monitor.json`에 적힌 KSPO API의 응답 상태와 전체 건수를 확인하고 `data/trust.json`에 적은 뒤 사이트를 다시 배포합니다. Actions 탭에서 **Run workflow**로 바로 돌릴 수도 있습니다.

- 인증키는 저장소 **Settings → Secrets and variables → Actions**에 `KCISA_KEY_LINKED`(연계 데이터), `KCISA_KEY_LOST`(유실물), `KCISA_KEY_PERF`(공연정보) 이름으로 넣습니다. 키가 없는 API는 건너뜁니다.
- **Settings → Pages → Source**는 **GitHub Actions**로 둡니다.
- 0건이 되면 카드 맨 위에 ‘API가 0건을 돌려줌’(높음), 건수가 바뀌면 ‘전체 건수가 바뀜’(낮음)이 `auto: true`로 붙고, 다시 열리면 자동으로 바뀝니다. 인증키 오류처럼 우리 쪽 문제일 수 있는 실패는 카드를 바꾸지 않고 기록만 남깁니다.
- 확인할 API를 더하려면 `data/monitor.json`에 한 줄을 더하고 Secrets에 키를 넣으면 됩니다.
- 올린 파일에 맞춰 볼 데이터를 추천하는 규칙은 `data/recommend.json`에 있습니다.
