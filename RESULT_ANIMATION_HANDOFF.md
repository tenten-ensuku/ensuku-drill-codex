# エンスクドリル 成績発表演出 移植メモ

このファイルは、エンスクドリルの成績発表画面を別プロジェクトへ移植するための引き継ぎ資料です。

対象は「完走時の成績発表演出」です。GAME OVER演出、ランキング投稿、復習、お気に入り、問題一覧、自己分析は移植対象外として切り離してよいです。

## 移植したい完成イメージ

- 成績発表画面に円形ゲージを表示する。
- ゲージはランク帯ごとに色分けする。
- スコアが0から最終得点まで増加する。
- ゲージ進行とスコア表示を連動させる。
- 得点演出が終わったあとにランクを表示する。
- ランク表示後にランクコメントを表示する。
- 新記録更新時のみ、スコア円の右下付近に「記録更新」ハンコを押す。
- ハンコ表示時に短い効果音を鳴らす。
- 神ランクはテキストではなく `assets/god-rank.png` を使う。

## 移植元

プロジェクト:

```text
C:\Users\kobot\Documents\Codex\2026-05-04\files-mentioned-by-the-user-spec
```

主ファイル:

```text
index.html
```

現在の内部バージョン:

```text
APP_VERSION = 143
```

## 必須アセット

移植先へコピーするファイル:

```text
assets/god-rank.png
assets/record-stamp-transparent-v2.png
```

用途:

- `god-rank.png`: ランクが `神` のときに表示する画像。
- `record-stamp-transparent-v2.png`: 新記録更新時の透過ハンコ画像。

不要になりやすい古い候補:

```text
assets/record-stamp-transparent.png
assets/record-stamps.png
```

基本的には `record-stamp-transparent-v2.png` を使う。

## 移植元コード位置

`index.html` 内の主な参照箇所:

```text
CSS:
- .score-gauge 系
- .score-gauge-segment.rainbow
- .score-gauge-fill
- .score-gauge-center
- .score-rank / .score-rank.show
- .god-rank
- .record-stamp
- @keyframes stamp-hit

JS/React:
- RANKS
- rankFor()
- rankThreshold()
- rankGaugeSegments()
- scoreGaugeProgress()
- rankComment()
- RankBadge()
- rankClass()
- tone("stamp")
- Result()
```

## Resultコンポーネントが受け取るデータ形

移植先では、最低限この形の `result` を渡せばよいです。

```js
const result = {
  modeId: "6",                 // "6" | "7" | "10_20" | "10_all" など
  modeLabel: "六枚形",
  tileCount: 6,
  questionCount: 13,
  variant: "normal",           // "normal" / "ura"。復習系は演出対象外にしてよい
  score: 378,
  rank: "神",
  correctCount: 13,
  mistakeCount: 0,
  elapsedSeconds: 13.5,
  previousBest: 365,
  isNewRecord: true,
  gameOver: false,
  finishedAt: new Date().toISOString()
};
```

移植先がランキング投稿や復習機能を持たない場合は、`Result()` から以下は削除してよいです。

- `showPost`
- `submitStatus`
- `submittingRanking`
- `rankingSubmitted`
- `postedRank`
- `xSharing`
- `xShareStatus`
- `copyPayload()`
- `postRanking()`
- `postToX()`
- ランキング投稿UI
- X共有UI
- 誤答問題リスト

## ランク定義

現在のエンスクドリルのランク定義です。別プロジェクトに合わせて数値は変更してよいですが、ゲージ演出はこの配列を前提にしています。

```js
const RANKS = {
  "6": [
    ["神", 379], ["SS", 365], ["S", 355], ["A+", 345], ["A", 335], ["A-", 325],
    ["B+", 315], ["B", 305], ["B-", 295], ["C", 285], ["D", 275], ["E", -Infinity]
  ],
  "7": [
    ["神", 551], ["SS", 535], ["S", 520], ["A+", 510], ["A", 500], ["A-", 490],
    ["B+", 480], ["B", 470], ["B-", 460], ["C", 450], ["D", 440], ["E", -Infinity]
  ],
  "10_20": [
    ["神", 560], ["SS", 530], ["S", 500], ["A+", 460], ["A", 420], ["A-", 385],
    ["B+", 350], ["B", 315], ["B-", 280], ["C", 230], ["D", 170], ["E", -Infinity]
  ],
  "10_all": [
    ["神", 2240], ["SS", 2120], ["S", 2000], ["A+", 1800], ["A", 1600], ["A-", 1400],
    ["B+", 1200], ["B", 1000], ["B-", 800], ["C", 600], ["D", 400], ["E", -Infinity]
  ]
};
```

関連関数:

```js
function getMode(modeId) {
  return MODES.find(m => m.id === modeId);
}

function rankFor(modeId, score) {
  const key = getMode(modeId)?.rankKey || modeId;
  return (RANKS[key] || RANKS["6"]).find(([, threshold]) => score >= threshold)?.[0] || "E";
}

function rankThreshold(modeId, rank) {
  const key = getMode(modeId)?.rankKey || modeId;
  return (RANKS[key] || RANKS["6"]).find(([r]) => r === rank)?.[1] ?? 0;
}
```

## 円形ゲージの分割ロジック

ゲージは12分割の時計型です。

- 0時〜2時: E
- 2時〜3時: D
- 3時〜4時: C
- 4時〜5時: B-
- 5時〜6時: B
- 6時〜7時: B+
- 7時〜8時: A-
- 8時〜9時: A
- 9時〜10時: A+
- 10時〜11時: S
- 11時〜12時: SS
- 神はSS帯のさらに先、てっぺん到達時の隠し最高ランク扱い

```js
function rankGaugeSegments(modeId) {
  const order = ["E", "D", "C", "B-", "B", "B+", "A-", "A", "A+", "S", "SS"];
  const colors = {
    E: "#64748b",
    D: "#6b7280",
    C: "#38bdf8",
    "B-": "#34d399",
    B: "#10b981",
    "B+": "#22c55e",
    "A-": "#fca5a5",
    A: "#f87171",
    "A+": "#ef4444",
    S: "#d8a83c",
    SS: "url(#scoreGaugeRainbow)"
  };
  return order.map((rank, index) => {
    const start = index === 0 ? 0 : (index + 1) / 12;
    const end = index === 0 ? 2 / 12 : (index + 2) / 12;
    return { rank, start, end, color: colors[rank] };
  });
}
```

スコアからゲージ進捗を出す関数:

```js
function scoreGaugeProgress(modeId, score) {
  const key = getMode(modeId)?.rankKey || modeId;
  const thresholds = Object.fromEntries((RANKS[key] || RANKS["6"]).map(([rank, value]) => [rank, value]));
  const bands = [
    { startRank: null, endRank: "D", start: 0, end: 2 / 12 },
    { startRank: "D", endRank: "C", start: 2 / 12, end: 3 / 12 },
    { startRank: "C", endRank: "B-", start: 3 / 12, end: 4 / 12 },
    { startRank: "B-", endRank: "B", start: 4 / 12, end: 5 / 12 },
    { startRank: "B", endRank: "B+", start: 5 / 12, end: 6 / 12 },
    { startRank: "B+", endRank: "A-", start: 6 / 12, end: 7 / 12 },
    { startRank: "A-", endRank: "A", start: 7 / 12, end: 8 / 12 },
    { startRank: "A", endRank: "A+", start: 8 / 12, end: 9 / 12 },
    { startRank: "A+", endRank: "S", start: 9 / 12, end: 10 / 12 },
    { startRank: "S", endRank: "SS", start: 10 / 12, end: 11 / 12 },
    { startRank: "SS", endRank: "神", start: 11 / 12, end: 1 }
  ];
  const safeScore = Math.max(0, Number(score) || 0);
  for (const band of bands) {
    const low = band.startRank ? thresholds[band.startRank] : 0;
    const high = thresholds[band.endRank];
    if (!Number.isFinite(high)) continue;
    if (safeScore < high) {
      const span = Math.max(1, high - low);
      const t = Math.min(Math.max((safeScore - low) / span, 0), 1);
      return band.start + (band.end - band.start) * t;
    }
  }
  return 1;
}
```

## 演出タイムライン

現在の挙動:

1. 成績発表画面に入る。
2. スコアとゲージを0から開始。
3. Eランク相当までは0.5秒で素早く進行。
4. そこから最終スコアまでは2.5秒かけて一定速度で進行。
5. スコア確定後、0.12秒後にランク表示。
6. 新記録なら0.54秒後にハンコ音とハンコ表示。
7. 新記録なら1.04秒後にランクコメント表示。
8. 新記録でなければ0.52秒後にランクコメント表示。

該当ロジック:

```js
useEffect(() => {
  if (isPractice) {
    setDisplayScore(result.score);
    setShowComment(true);
    return;
  }
  setShowRecordStamp(false);
  setShowRank(false);
  setShowComment(false);
  setDisplayScore(0);

  let frame = 0;
  const started = performance.now();
  const eClearScore = Math.min(result.score, Math.max(0, rankThreshold(result.modeId, "D")));
  const eClearDuration = 500;
  const rankClimbDuration = 2500;
  const totalDuration = result.score <= eClearScore ? eClearDuration : eClearDuration + rankClimbDuration;

  function animatedScore(elapsed) {
    if (result.score <= eClearScore) {
      return result.score * Math.min(elapsed / eClearDuration, 1);
    }
    if (elapsed <= eClearDuration) {
      return eClearScore * Math.min(elapsed / eClearDuration, 1);
    }
    const rankT = Math.min((elapsed - eClearDuration) / rankClimbDuration, 1);
    return eClearScore + (result.score - eClearScore) * rankT;
  }

  function step(now) {
    const elapsed = Math.min(now - started, totalDuration);
    setDisplayScore(Math.round(animatedScore(elapsed)));
    const t = elapsed / totalDuration;
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      setTimeout(() => setShowRank(true), 120);
      if (result.isNewRecord) {
        setTimeout(() => {
          tone?.("stamp");
          setShowRecordStamp(true);
        }, 540);
        setTimeout(() => setShowComment(true), 1040);
      } else {
        setTimeout(() => setShowComment(true), 520);
      }
    }
  }

  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}, [result.finishedAt]);
```

## CSS

移植時は以下のCSS群を持っていく。

```css
.score-gauge {
  position: relative;
  width: min(228px, 72vw);
  aspect-ratio: 1;
  margin: 0 auto;
  overflow: visible;
}
.score-gauge svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  overflow: visible;
  filter: drop-shadow(0 16px 22px rgba(0,0,0,0.38));
}
.score-gauge-track { stroke: rgba(246,242,223,0.08); }
.score-gauge-segment {
  opacity: 0.72;
  stroke-linecap: butt;
}
.score-gauge-segment.rainbow {
  opacity: 1;
  stroke-width: 12;
  filter:
    drop-shadow(0 0 6px rgba(255,45,130,0.48))
    drop-shadow(0 0 10px rgba(0,200,255,0.34));
  animation: rainbow-band-pulse 1.6s ease-in-out infinite alternate;
}
@keyframes rainbow-band-pulse {
  0% { opacity: 0.78; filter: drop-shadow(0 0 4px rgba(255,45,130,0.35)) drop-shadow(0 0 8px rgba(0,200,255,0.22)); }
  100% { opacity: 1; filter: drop-shadow(0 0 9px rgba(255,45,130,0.72)) drop-shadow(0 0 14px rgba(0,200,255,0.48)); }
}
.score-gauge-fill {
  stroke: url(#scoreGaugeFill);
  stroke-linecap: round;
}
.score-gauge-center {
  position: absolute;
  inset: 15%;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at 50% 0%, rgba(242,210,123,0.16), transparent 62%),
    linear-gradient(180deg, rgba(4,8,7,0.94), rgba(0,0,0,0.72));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 16px 32px rgba(255,255,255,0.035);
}
.score-number {
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 16px rgba(242,210,123,0.24);
}
.score-rank {
  opacity: 0;
  transform: scale(0.72);
}
.score-rank.show {
  animation: rank-reveal 360ms cubic-bezier(.2,.9,.18,1.18) both;
}
@keyframes rank-reveal {
  0% { opacity: 0; transform: scale(0.72) translateY(6px); }
  64% { opacity: 1; transform: scale(1.08) translateY(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
.god-rank {
  display: inline-block;
  width: 1.45em;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 999px;
  filter: drop-shadow(0 0 12px rgba(242,210,123,0.48));
  vertical-align: middle;
}
.god-rank.result {
  width: 92px;
}
.record-stamp {
  position: absolute;
  z-index: 8;
  right: 8px;
  bottom: 20px;
  width: 85px;
  height: 85px;
  background-image: url("assets/record-stamp-transparent-v2.png");
  background-repeat: no-repeat;
  background-size: contain;
  background-position: center;
  pointer-events: none;
  mix-blend-mode: normal;
  filter: drop-shadow(0 8px 10px rgba(0,0,0,0.36)) saturate(1.18);
  animation: stamp-hit 500ms cubic-bezier(.16,.9,.2,1.12) both;
  transform-origin: center;
}
@keyframes stamp-hit {
  0% { transform: translate(18px, -22px) rotate(-14deg) scale(2.15); opacity: 0; }
  44% { transform: translate(0, 0) rotate(-14deg) scale(0.84); opacity: 1; }
  62% { transform: translate(0, 0) rotate(-14deg) scale(1.04); opacity: 1; }
  100% { transform: translate(0, 0) rotate(-14deg) scale(1); opacity: 1; }
}
```

## SVG構造

`Result()` 内の円ゲージ構造。Tailwindを使わない移植先では、外側のクラスだけ置き換えればよい。

```jsx
<div className="score-gauge">
  <svg viewBox="0 0 240 240" aria-hidden="true">
    <defs>
      <linearGradient id="scoreGaugeFill" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#fffdf0" />
        <stop offset="45%" stopColor="#f2d27b" />
        <stop offset="100%" stopColor="#ffffff" />
      </linearGradient>
      <linearGradient id="scoreGaugeRainbow" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#ff2d55" />
        <stop offset="16%" stopColor="#ffb000" />
        <stop offset="32%" stopColor="#fff35c" />
        <stop offset="48%" stopColor="#00e676" />
        <stop offset="64%" stopColor="#00c8ff" />
        <stop offset="82%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#ff4fd8" />
        <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="2.4s" repeatCount="indefinite" />
      </linearGradient>
    </defs>

    <circle className="score-gauge-track" cx="120" cy="120" r={gaugeRadius} fill="none" strokeWidth="14" />

    {gaugeSegments.map(seg => {
      const length = Math.max(0.01, (seg.end - seg.start) * gaugeCircumference);
      const offset = -seg.start * gaugeCircumference;
      return (
        <circle
          key={seg.rank}
          className={`score-gauge-segment ${seg.rank === "SS" ? "rainbow" : ""}`}
          cx="120"
          cy="120"
          r={gaugeRadius}
          fill="none"
          stroke={seg.color}
          strokeWidth={seg.rank === "SS" ? "12" : "10"}
          strokeDasharray={`${length} ${gaugeCircumference - length}`}
          strokeDashoffset={offset}
        />
      );
    })}

    <circle
      className="score-gauge-fill"
      cx="120"
      cy="120"
      r={gaugeRadius}
      fill="none"
      strokeWidth="14"
      strokeDasharray={gaugeCircumference}
      strokeDashoffset={gaugeOffset}
    />
  </svg>

  <div className="score-gauge-center">
    <div>
      <div className={`score-rank ${rankColor} ${showRank ? "show" : ""}`}>
        <RankBadge rank={result.rank} size="result" />
      </div>
      <div className="score-number">
        {displayScore}<span>pt</span>
      </div>
    </div>
  </div>

  {showRecordStamp && <div className="record-stamp" aria-label="記録更新" />}
</div>
```

事前に必要な値:

```js
const gaugeRadius = 104;
const gaugeCircumference = 2 * Math.PI * gaugeRadius;
const gaugeProgress = scoreGaugeProgress(result.modeId, displayScore);
const gaugeOffset = gaugeCircumference * (1 - gaugeProgress);
const gaugeSegments = rankGaugeSegments(result.modeId);
```

## ランク表示

```js
function RankBadge({ rank, size = "menu", className = "" }) {
  if (rank === "神") {
    return <img className={`god-rank ${size} ${className}`} src="assets/god-rank.png" alt="神" />;
  }
  return <>{rank}</>;
}

function rankClass(rank) {
  if (rank === "神" || rank === "SS") return "rainbow-text";
  if (rank === "S") return "gold-text";
  if (rank?.startsWith("A")) return "text-red-300";
  if (rank?.startsWith("B")) return "text-emerald-300";
  if (rank === "C") return "text-sky-300";
  return "text-slate-300";
}
```

`rainbow-text` と `gold-text` は移植先で既存CSSがなければ追加する。

```css
.rainbow-text {
  background: linear-gradient(to right, #ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: rainbow-shift 1.6s linear infinite;
}
@keyframes rainbow-shift {
  to { background-position: 200% center; }
}
.gold-text {
  color: #f2d27b;
  text-shadow: 0 0 12px rgba(242,210,123,0.32);
}
```

## ランクコメント

```js
function rankComment(rank, tileCount) {
  const shapeLabel = tileCount === 6 ? "六枚形" : tileCount === 7 ? "七枚形" : "十枚形";
  const comments = {
    神: "みんなには内緒だよ",
    SS: "キミは神になるつもりかい！？",
    S: "Congratulations!…Congratulations!…",
    "A+": "狂気の沙汰ほど面白い……！",
    A: "強えっつっても兄さんのは昼間の麻雀だ",
    "A-": "行くぜ、坊や！！",
    "B+": "倍プッシュだ…！",
    B: "こざかしいことと無関係のところに強者は存在する",
    "B-": "熱い三流なら上等よ",
    C: "まだまだだね",
    D: `${shapeLabel}が仲間になりたそうにコチラを見ている`,
    E: `へんじが無い。ただの${shapeLabel}のようだ。`
  };
  return comments[rank] || comments.E;
}
```

## ハンコ効果音

現在はWeb Audio APIで生成している。音声ファイルは不要。

移植先で既に音声管理がある場合は、`tone("stamp")` をそのプロジェクトのSE再生関数へ置き換える。

該当部分だけ抜き出すと以下。

```js
function tone(type) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const output = ctx.createGain();

  output.gain.setValueAtTime(1, now);
  output.connect(ctx.destination);
  osc.connect(gain);
  gain.connect(output);

  if (type === "stamp") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(78, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);

    const hit = ctx.createOscillator();
    const hitGain = ctx.createGain();
    hit.type = "square";
    hit.frequency.setValueAtTime(92, now + 0.06);
    hit.frequency.exponentialRampToValueAtTime(58, now + 0.18);
    hitGain.gain.setValueAtTime(0.0001, now + 0.05);
    hitGain.gain.exponentialRampToValueAtTime(0.18, now + 0.07);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    hit.connect(hitGain);
    hitGain.connect(output);
    hit.start(now + 0.05);
    hit.stop(now + 0.22);

    const pop = ctx.createOscillator();
    const popGain = ctx.createGain();
    pop.type = "sine";
    pop.frequency.setValueAtTime(520, now + 0.015);
    pop.frequency.exponentialRampToValueAtTime(310, now + 0.08);
    popGain.gain.setValueAtTime(0.0001, now + 0.01);
    popGain.gain.exponentialRampToValueAtTime(0.055, now + 0.018);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    pop.connect(popGain);
    popGain.connect(output);
    pop.start(now + 0.01);
    pop.stop(now + 0.1);
  }
}
```

`ensureAudio()` は、ユーザー操作後にAudioContextを作る既存処理へ接続する。iPhone/Androidではユーザー操作前の自動再生がブロックされるため、プレイ開始時やボタンタップ時にAudioContextをresumeしておく。

## 移植時に削ってよいもの

移植先で成績発表演出だけ必要なら、以下は削除してよい。

- Supabaseランキング投稿
- X共有
- お気に入り追加
- 誤答問題一覧
- 復習/お気に入り練習用の分岐
- Enterで再挑戦

ただし、以下は残す。

- `displayScore`
- `showRank`
- `showComment`
- `showRecordStamp`
- `rankGaugeSegments`
- `scoreGaugeProgress`
- `rankThreshold`
- `RankBadge`
- `.score-gauge` 系CSS
- `.record-stamp` 系CSS
- `assets/god-rank.png`
- `assets/record-stamp-transparent-v2.png`

## Tailwind依存について

移植元はTailwindクラスを多用している。

Tailwindを使わないプロジェクトに移植する場合は、以下の外枠UIだけ通常CSSへ置き換える。

- `panel`
- `record-card`
- `result-pop`
- `rounded-3xl`
- `bg-black/30`
- `text-*`
- `grid`
- `gap-*`
- `px-*`
- `py-*`

円ゲージ自体は通常CSSとSVGなので、Tailwind非依存で移植できる。

## 動作確認項目

移植後は最低限以下を確認する。

1. 成績発表画面が開いた直後、スコアが0から増える。
2. ゲージがスコアと連動して時計回りに進む。
3. ランクがスコア確定後に出る。
4. ランクコメントがランク表示後に出る。
5. 新記録時だけハンコが出る。
6. ハンコが円の中で切れず、円の上に重なる。
7. `神` ランク時に `god-rank.png` が表示される。
8. スマホ幅でハンコ、スコア、ランクが重ならない。
9. 音量0またはミュート時にハンコ音が鳴らない。
10. iPhone/Androidで初回タップ後にハンコ音が鳴る。

## 移植先Codexへの依頼文例

別プロジェクトのCodexには、このように渡す。

```text
この `RESULT_ANIMATION_HANDOFF.md` を読んでください。
エンスクドリルの成績発表演出を、現在のプロジェクトのリザルト画面へ移植してください。

移植対象:
- 円形ランクゲージ
- スコア増加演出
- ランク遅延表示
- ランクコメント遅延表示
- 新記録ハンコ演出
- ハンコ効果音
- 神ランク画像表示

移植不要:
- Supabaseランキング投稿
- X共有
- 復習/お気に入り
- 誤答問題一覧

まず既存のリザルト画面を読み、既存データ構造に合わせて移植してください。
実装後はPC幅とスマホ幅で表示確認してください。
```

## 注意

この演出は「スコアが最終値へ到達してからランクを見せる」順番が重要です。ランクコメントを先に出すとランク先バレになるため、必ず以下の順序にする。

```text
スコア/ゲージ上昇
→ ランク表示
→ 新記録ならハンコ
→ コメント表示
```

以上。
