import {
  BATTING_ABILITIES,
  FIELDING_ABILITIES,
  PITCHING_ABILITIES,
  battingRating,
  fieldingAtPosition,
  fieldingRating,
  overallRating,
  pitchingRating,
} from '../game/abilities.js'
import { POSITIONS, POSITION_BY_ID } from '../game/positions.js'
import { MAX_BENCH, availablePitchers } from '../game/roster.js'
import { MATCH_CODE_FORMAT } from '../game/teamCode.js'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

const BATS_LABEL = { right: '右打', left: '左打', switch: '両打' }
const THROWS_LABEL = { right: '右投', left: '左投' }

const ABILITY_GROUPS = [
  { name: '打撃', keys: ['contact', 'power', 'speed', 'approach'], labels: BATTING_ABILITIES },
  {
    name: '投球',
    keys: ['velocity', 'control', 'breaking', 'stamina'],
    labels: PITCHING_ABILITIES,
  },
  { name: '守備', keys: ['fielding', 'arm', 'throwing'], labels: FIELDING_ABILITIES },
]

/** 選手の全能力値の合計。編成画面で育てた感を出すために表示する。 */
export function totalAbilities(player) {
  return Object.values(player.abilities).reduce((sum, value) => sum + value, 0)
}

function statBar(value) {
  const pct = Math.max(0, Math.min(100, value))
  return `<span class="bar"><span class="bar-fill" style="width:${pct}%"></span><span class="bar-value">${value}</span></span>`
}

/** 1 人の選手カード */
export function renderPlayerCard(player, { position = null, battingOrder = null } = {}) {
  const groups = [
    { name: '打撃', label: BATTING_ABILITIES, keys: ['contact', 'power', 'speed', 'approach'] },
    {
      name: '投球',
      label: PITCHING_ABILITIES,
      keys: ['velocity', 'control', 'breaking', 'stamina'],
    },
    { name: '守備', label: FIELDING_ABILITIES, keys: ['fielding', 'arm', 'throwing'] },
  ]

  const abilityHtml = groups
    .map(
      (group) => `
    <div class="ability-group">
      <h4>${group.name}</h4>
      ${group.keys
        .map(
          (key) =>
            `<div class="ability-row"><span class="ability-label">${group.label[key].label}</span>${statBar(player.abilities[key])}</div>`,
        )
        .join('')}
    </div>`,
    )
    .join('')

  const positionFitHtml = POSITIONS.filter((item) => item.id !== 'P')
    .map(
      (item) => `<tr>
        <th>${item.label}</th>
        <td>${statBar(player.positionFit[item.id] ?? 50)}</td>
        <td class="num">${fieldingAtPosition(player, item.id)}</td>
      </tr>`,
    )
    .join('')

  return `
  <article class="player-card" data-player="${escapeHtml(player.id)}" data-testid="player-${escapeHtml(player.id)}">
    <header>
      <div class="player-id">
        <span class="number">#${player.number}</span>
        <h3 data-testid="player-name">${escapeHtml(player.name)}</h3>
      </div>
      <div class="badges">
        ${battingOrder ? `<span class="badge">${battingOrder}番</span>` : '<span class="badge muted">控え</span>'}
        ${position ? `<span class="badge">${POSITION_BY_ID[position].label}</span>` : ''}
        ${player.isPitcher ? '<span class="badge pitcher">投手</span>' : ''}
      </div>
    </header>

    <div class="meta">
      <span>${BATS_LABEL[player.bats] ?? player.bats}</span>
      <span>${THROWS_LABEL[player.throws] ?? player.throws}</span>
      <span>${player.age}歳</span>
      <span>${player.height}cm / ${player.weight}kg</span>
    </div>

    <dl class="ratings">
      <div><dt>打撃</dt><dd data-testid="batting">${battingRating(player)}</dd></div>
      <div><dt>投球</dt><dd>${pitchingRating(player)}</dd></div>
      <div><dt>守備</dt><dd>${fieldingRating(player)}</dd></div>
      <div><dt>総合</dt><dd class="overall">${overallRating(player)}</dd></div>
    </dl>

    <div class="abilities">${abilityHtml}</div>

    <details class="position-fit">
      <summary>守備位置の適性</summary>
      <table class="fit-table">
        <thead><tr><th>位置</th><th>適性</th><th>守備評価</th></tr></thead>
        <tbody>${positionFitHtml}</tbody>
      </table>
    </details>
  </article>`
}

/** 能力値エディタ。選択した選手 1 人の能力をスライダーで自由に変えられる。 */
export function renderAbilityEditor(player) {
  const abilityHtml = ABILITY_GROUPS.map(
    (group) => `
    <fieldset class="ability-edit-group">
      <legend>${group.name}</legend>
      ${group.keys
        .map(
          (key) => `
        <label class="ability-edit-row">
          <span class="ability-edit-label">${group.labels[key].label}</span>
          <input
            type="range"
            min="1"
            max="100"
            value="${player.abilities[key]}"
            data-ability="${key}"
            data-testid="edit-${key}"
          />
          <input
            class="ability-number"
            type="number"
            min="1"
            max="100"
            value="${player.abilities[key]}"
            data-ability-number="${key}"
            data-testid="edit-number-${key}"
            aria-label="${group.labels[key].label}の数値"
          />
        </label>`,
        )
        .join('')}
    </fieldset>`,
  ).join('')

  const fitHtml = POSITIONS.map(
    (position) => `
    <label class="ability-edit-row">
      <span class="ability-edit-label">${position.label}</span>
      <input
        type="range"
        min="1"
        max="100"
        value="${player.positionFit[position.id] ?? 50}"
        data-fit="${position.id}"
        data-testid="edit-fit-${position.id}"
      />
      <input
        class="ability-number"
        type="number"
        min="1"
        max="100"
        value="${player.positionFit[position.id] ?? 50}"
        data-fit-number="${position.id}"
        data-testid="edit-fit-number-${position.id}"
        aria-label="${position.label}の適性値"
      />
    </label>`,
  ).join('')

  return `
  <section class="panel ability-editor" data-testid="ability-editor">
    <header class="editor-header">
      <div>
        <h2>${escapeHtml(player.name)} の能力を編集</h2>
        <p class="muted small">数値を決めて「能力を保存」を押してください。1〜100 で設定できます。</p>
      </div>
      <span class="editor-total">能力合計 <strong data-testid="ability-total">${totalAbilities(player)}</strong></span>
    </header>

    <div class="profile-form">
      <label>名前
        <input type="text" maxlength="20" value="${escapeHtml(player.name)}" data-profile="name" data-testid="edit-name" />
      </label>
      <label>背番号
        <input type="number" min="0" max="99" value="${player.number}" data-profile="number" data-testid="edit-number" />
      </label>
      <label>打席
        <select data-profile="bats" data-testid="edit-bats">
          <option value="right"${player.bats === 'right' ? ' selected' : ''}>右打</option>
          <option value="left"${player.bats === 'left' ? ' selected' : ''}>左打</option>
          <option value="switch"${player.bats === 'switch' ? ' selected' : ''}>両打</option>
        </select>
      </label>
      <label>投げ
        <select data-profile="throws" data-testid="edit-throws">
          <option value="right"${player.throws === 'right' ? ' selected' : ''}>右投</option>
          <option value="left"${player.throws === 'left' ? ' selected' : ''}>左投</option>
        </select>
      </label>
    </div>

    <div class="ability-edit-grid">${abilityHtml}</div>

    <details class="position-fit">
      <summary>守備位置の適性を編集</summary>
      <div class="ability-edit-grid">${fitHtml}</div>
    </details>

    <footer class="actions">
      <button data-action="cancel-edit" data-testid="cancel-edit">キャンセル</button>
      <button class="primary" data-action="save-player" data-testid="save-player">能力を保存</button>
    </footer>
  </section>`
}

/** チーム編成画面。ホーム／アウェイを切り替えて両チームを編集できる。 */
export function renderTeamScreen({
  homeTeam,
  awayTeam,
  activeSide = 'home',
  mode = 'solo',
  homeValidation,
  awayValidation,
  message = '',
  selectedPlayerId = null,
  teamCode = '',
  importText = '',
  dataOpen = false,
}) {
  const editingTeam = activeSide === 'away' ? awayTeam : homeTeam
  const otherTeam = activeSide === 'away' ? homeTeam : awayTeam
  const validation = activeSide === 'away' ? awayValidation : homeValidation
  const otherValidation = activeSide === 'away' ? homeValidation : awayValidation
  const editingRole =
    activeSide === 'home'
      ? mode === 'two-player'
        ? 'プレイヤー1（ホーム）'
        : 'あなた（ホーム）'
      : mode === 'two-player'
        ? 'プレイヤー2（アウェイ）'
        : 'CPU（アウェイ）'
  const otherRole = activeSide === 'home' ? 'アウェイ' : 'ホーム'
  const sorted = editingTeam.starters.slice().sort((a, b) => a.battingOrder - b.battingOrder)
  const selectedPlayer = selectedPlayerId
    ? [...editingTeam.starters.map((slot) => slot.player), ...editingTeam.bench].find(
        (player) => player.id === selectedPlayerId,
      )
    : null
  const teamOverall = Math.round(
    sorted.reduce((sum, slot) => sum + overallRating(slot.player), 0) / sorted.length,
  )
  const canStart = homeValidation.valid && awayValidation.valid
  const atMaxBench = editingTeam.bench.length >= MAX_BENCH

  const slots = sorted
    .map((slot, index) => {
      const positionLabel = POSITION_BY_ID[slot.position]?.label ?? slot.position
      const defense =
        slot.position === 'P'
          ? ''
          : `<span class="slot-rating" title="${positionLabel}での守備評価">守${fieldingAtPosition(slot.player, slot.position)}</span>`

      const moveUp =
        index > 0
          ? `<button class="mini" data-action="swap-order" data-from="${index}" data-to="${index - 1}" data-testid="order-up-${index}" aria-label="打席順を1つ上げる">▲</button>`
          : ''
      const moveDown =
        index < sorted.length - 1
          ? `<button class="mini" data-action="swap-order" data-from="${index}" data-to="${index + 1}" data-testid="order-down-${index}" aria-label="打席順を1つ下げる">▼</button>`
          : ''

      return `<li class="slot" data-position="${slot.position}" data-testid="slot-${slot.position}">
        <span class="slot-order">${index + 1}番</span>
        <span class="slot-position">${positionLabel}</span>
        <span class="slot-name" data-testid="slot-name-${slot.position}">${escapeHtml(slot.player.name)}</span>
        <span class="slot-bat">${BATS_LABEL[slot.player.bats] ?? ''}</span>
        <span class="slot-ratings">
          <span class="slot-rating" title="打撃評価">打${battingRating(slot.player)}</span>
          ${defense}
        </span>
        <span class="slot-actions">
          <button class="mini" data-action="edit-player" data-player="${escapeHtml(slot.player.id)}" data-testid="edit-${slot.position}">編集</button>
          ${moveUp}${moveDown}
        </span>
      </li>`
    })
    .join('')

  const bench = editingTeam.bench
    .map(
      (player, index) => `<li class="bench-player" data-testid="bench-${index}">
        <span class="number">#${player.number}</span>
        <span class="slot-name">${escapeHtml(player.name)}</span>
        <span class="slot-bat">${BATS_LABEL[player.bats] ?? ''}</span>
        <span class="slot-ratings">
          <span class="slot-rating">打${battingRating(player)}</span>
          <span class="slot-rating">守${fieldingRating(player)}</span>
        </span>
        <span class="slot-actions">
          <button class="mini" data-action="edit-player" data-player="${escapeHtml(player.id)}" data-testid="bench-edit-${index}">編集</button>
          <button class="mini" data-action="promote" data-bench="${index}" data-testid="bench-in-${index}" aria-label="${escapeHtml(player.name)}を出場させる">›</button>
          <button class="mini danger" data-action="remove-bench" data-bench="${index}" data-testid="bench-remove-${index}" aria-label="${escapeHtml(player.name)}を控えから削除">×</button>
        </span>
      </li>`,
    )
    .join('')

  const errors = validation.valid
    ? ''
    : `<ul class="errors" data-testid="validation-errors">${validation.errors
        .map((error) => `<li>${escapeHtml(error)}</li>`)
        .join('')}</ul>`

  const otherSlots = otherTeam.starters
    .slice()
    .sort((a, b) => a.battingOrder - b.battingOrder)
    .map(
      (slot, index) => `<li class="slot">
        <span class="slot-order">${index + 1}番</span>
        <span class="slot-position">${POSITION_BY_ID[slot.position]?.label ?? slot.position}</span>
        <span class="slot-name">${escapeHtml(slot.player.name)}</span>
        <span class="slot-ratings">
          <span class="slot-rating">打${battingRating(slot.player)}</span>
        </span>
      </li>`,
    )
    .join('')

  const positionOptions = POSITIONS.map(
    (position) => `<option value="${position.id}">${position.label}</option>`,
  ).join('')

  return `
  <div class="team-screen">
    <header class="screen-header team-header">
      <div class="team-title">
        <h1>チーム編成</h1>
        <p class="muted">ホームとアウェイの両方を編集できます。9 人で守備位置と打席順を決めてください。</p>
        <div class="mode-select" data-testid="mode-select" role="group" aria-label="プレイモード">
          <span>プレイモード</span>
          <button class="${mode === 'solo' ? 'selected' : ''}" data-action="set-mode" data-mode="solo" data-testid="mode-solo">1人プレイ</button>
          <button class="${mode === 'two-player' ? 'selected' : ''}" data-action="set-mode" data-mode="two-player" data-testid="mode-two-player">2人プレイ</button>
          <button data-action="online-lobby" data-testid="mode-online">オンライン</button>
        </div>
      </div>
      <div class="team-name-card">
        <label for="team-name-input">チーム名（${editingRole}）</label>
        <div class="team-name-row">
          <input
            id="team-name-input"
            type="text"
            maxlength="20"
            autocomplete="off"
            value="${escapeHtml(editingTeam.name)}"
            data-testid="team-name-input"
          />
          <button data-action="rename-team" data-testid="rename-team">変更</button>
        </div>
        <p class="muted small">総合力 <strong>${teamOverall}</strong> ・ 登録 ${editingTeam.starters.length + editingTeam.bench.length} 人</p>
      </div>
    </header>

    <nav class="team-tabs" data-testid="team-tabs" aria-label="編集するチーム">
      <button class="team-tab${activeSide === 'home' ? ' active' : ''}" data-action="select-team" data-side="home" data-testid="edit-team-home">
        <span class="team-tab-role">${mode === 'two-player' ? 'プレイヤー1' : 'あなた'}</span>
        <strong>${escapeHtml(homeTeam.name)}</strong>
        <span class="team-tab-side">ホーム</span>
      </button>
      <button class="team-tab${activeSide === 'away' ? ' active' : ''}" data-action="select-team" data-side="away" data-testid="edit-team-away">
        <span class="team-tab-role">${mode === 'two-player' ? 'プレイヤー2' : 'CPU'}</span>
        <strong>${escapeHtml(awayTeam.name)}</strong>
        <span class="team-tab-side">アウェイ</span>
      </button>
    </nav>
    <p class="muted small mode-hint" data-testid="mode-hint">
      ${mode === 'two-player' ? '2人プレイ：投球と打席を交互に操作します。' : '1人プレイ：ホームを操作し、アウェイはCPUが操作します。'}
    </p>

    ${message ? `<p class="notice" data-testid="notice">${escapeHtml(message)}</p>` : ''}
    ${errors}
    ${!otherValidation.valid ? `<p class="notice" data-testid="other-validation">もう一方のチーム（${otherRole}）に編成エラーがあります。タブを切り替えて確認してください。</p>` : ''}
    ${selectedPlayer ? renderAbilityEditor(selectedPlayer) : ''}

    <div class="team-layout">
      <div class="team-main">
        <section class="panel">
          <h2>${editingRole}のチーム <span class="badge">${escapeHtml(editingTeam.name)}</span></h2>
          <ol class="lineup" data-testid="lineup">${slots}</ol>
          <p class="muted small">「編集」で能力値を自由に設定できます。▲▼ で打席順を入れ替えられます。</p>

          <h3>守備位置の組み替え</h3>
          <div class="position-form">
            <label>位置A
              <select data-testid="position-a"><option value="">選択</option>${positionOptions}</select>
            </label>
            <span class="muted">と</span>
            <label>位置B
              <select data-testid="position-b"><option value="">選択</option>${positionOptions}</select>
            </label>
            <button class="primary" data-action="swap-positions" data-testid="swap-positions">入れ替える</button>
          </div>

          <div class="bench-head">
            <h3>控え <span class="muted small" data-testid="bench-count">${editingTeam.bench.length}/${MAX_BENCH} 人</span></h3>
            <button class="mini" data-action="add-bench" data-testid="add-bench"${atMaxBench ? ' disabled' : ''}>＋ 控えを追加</button>
          </div>
          <ul class="bench" data-testid="bench">${bench || '<li class="muted">控えはいません</li>'}</ul>
          <p class="muted small">控えは最大 ${MAX_BENCH} 人まで追加・削除できます。「›」で 1 番の打席と入れ替えます。</p>
        </section>
      </div>

      <aside class="team-side">
        <section class="panel">
          <h2>${otherRole}のチーム <span class="badge">${escapeHtml(otherTeam.name)}</span></h2>
          <ol class="lineup opponent" data-testid="preview-lineup">${otherSlots}</ol>
          <p class="muted small">登録投手 ${availablePitchers(otherTeam).length} 人</p>
          <button class="mini" data-action="select-team" data-side="${activeSide === 'home' ? 'away' : 'home'}" data-testid="edit-other-team">このチームを編集</button>
        </section>

        <details class="panel data-panel" data-testid="data-panel"${dataOpen || importText ? ' open' : ''}>
          <summary data-testid="data-summary">両チームのデータを文字列で保存・読み込み</summary>
          <div class="data-panel-body">
            <h3>出力</h3>
            <p class="muted small">ホームとアウェイの 2 チームをまとめて保存します。</p>
            <textarea
              class="code-text"
              rows="7"
              readonly
              spellcheck="false"
              data-testid="team-code"
            >${escapeHtml(teamCode)}</textarea>
            <div class="data-actions">
              <button data-action="copy-team-code" data-testid="copy-team-code">コピー</button>
              <button data-action="download-team-code" data-testid="download-team-code">ファイル保存</button>
            </div>

            <h3>入力</h3>
            <p class="muted small">保存した文字列を貼り付けるか、ファイルを選んでください。旧形式の 1 チームデータも読み込めます。</p>
            <textarea
              class="code-text"
              rows="7"
              spellcheck="false"
              placeholder='{"format":"${MATCH_CODE_FORMAT}","version":1,...}'
              data-testid="import-code"
            >${escapeHtml(importText)}</textarea>
            <div class="data-actions">
              <label class="file-button">
                ファイルを選ぶ
                <input
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  data-testid="team-code-file"
                />
              </label>
              <button class="primary" data-action="import-team-code" data-testid="import-team-code">読み込む</button>
            </div>
            <p class="muted small">読み込むと、両チームの編成が置き換わります。</p>
          </div>
        </details>
      </aside>
    </div>

    <footer class="actions${selectedPlayer ? '' : ' sticky-actions'}">
      <button data-action="reroll" data-testid="reroll">両チームをやり直す</button>
      <button class="primary" data-action="start-game" data-testid="start-game"${canStart ? '' : ' disabled'}>試合開始</button>
    </footer>
  </div>`
}

export { escapeHtml }
