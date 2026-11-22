import { battingRating, pitchingRating } from '../game/abilities.js'
import { INNINGS } from '../game/constants.js'
import {
  COURSES,
  PITCH_TYPES,
  courseLabel,
  currentBatter,
  currentPitcher,
  currentTurnSide,
} from '../game/liveGame.js'
import { escapeHtml } from './teamScreen.js'

const BATS_LABEL = { right: '右打', left: '左打', switch: '両打' }

function linescoreHtml(state, homeTeam, awayTeam) {
  const header = Array.from({ length: INNINGS }, (_, i) => `<th>${i + 1}</th>`).join('')
  const rows = [
    { key: 'away', team: awayTeam },
    { key: 'home', team: homeTeam },
  ]
    .map(({ key, team }) => {
      const cells = Array.from({ length: INNINGS }, (_, i) => {
        const value = state.linescore[key][i]
        return `<td>${value ?? '-'}</td>`
      }).join('')
      return `<tr><th class="team-name">${escapeHtml(team.shortName || team.name)}</th>${cells}<td class="total">${state.score[key]}</td></tr>`
    })
    .join('')

  return `<table class="linescore compact">
    <thead><tr><th class="team-name">回</th>${header}<th class="total">計</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function logHtml(state) {
  const entries = state.log
    .slice(-7)
    .reverse()
    .map(
      (entry) => `<li>
        <span class="tag">${entry.inning}回${entry.half}</span>
        <span class="name">${escapeHtml(entry.text)}</span>
      </li>`,
    )
    .join('')

  return `<ul class="play-log game-log" data-testid="game-log">${entries || '<li class="muted">プレーはまだありません</li>'}</ul>`
}

function pitchControls(
  selectedPitchType,
  teamName,
  batter,
  pitcher,
  selectedCourseId,
  pitchMeterValue,
) {
  const typeButtons = PITCH_TYPES.map(
    (type) => `<button
      class="pitch-type${type.id === selectedPitchType ? ' selected' : ''}"
      data-action="select-pitch-type"
      data-type="${type.id}"
      data-testid="pitch-type-${type.id}"
      title="${escapeHtml(type.description)}"
    >${type.label}</button>`,
  ).join('')

  const courseButtons = COURSES.map(
    (course) => `<button
      class="course${course.inZone ? ' in-zone' : ''}${course.id === selectedCourseId ? ' selected' : ''}"
      data-action="pitch"
      data-course="${course.id}"
      data-testid="course-${course.id}"
      title="${course.inZone ? 'ストライクゾーン' : 'ボールゾーン'}"
    >${courseLabel(course, batter, pitcher)}</button>`,
  ).join('')

  return `<section class="panel controls" data-testid="pitch-controls">
    <div class="controls-head">
      <h2>投球（${escapeHtml(teamName)}）</h2>
      <p class="muted small">球種を選んでコースをクリック。動くメーターを緑ゾーンでリリース。</p>
    </div>
    <div class="pitch-types" data-testid="pitch-types">${typeButtons}</div>
    <div class="course-grid">${courseButtons}</div>
    <div class="pitch-meter-panel" data-testid="pitch-meter">
      <div class="pitch-meter-track">
        <span class="pitch-meter-zone"></span>
        <span
          class="pitch-meter-marker"
          data-testid="pitch-meter-marker"
          style="left:${pitchMeterValue * 100}%"
        ></span>
      </div>
      <div class="pitch-meter-footer">
        <span class="muted small">${selectedCourseId ? '緑のゾーンで離すと制球が安定します' : 'コースを選ぶとメーターが動きます'}</span>
        <button
          class="primary"
          data-action="release-pitch"
          data-testid="release-pitch"
          ${selectedCourseId ? '' : 'disabled'}
        >リリース</button>
      </div>
    </div>
  </section>`
}

function battingControls(state, teamName, batter, pitcher, battingCursor, battingTimingValue) {
  const pitch = state.currentPitch
  const zoneButtons = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3)
    const column = index % 3
    const selected = row === battingCursor.row && column === battingCursor.column
    return `<button
      class="zone-cell${selected ? ' selected' : ''}"
      data-action="move-cursor"
      data-row="${row}"
      data-column="${column}"
      data-testid="cursor-${row}-${column}"
      aria-label="カーソルを${row + 1}段目${column + 1}列目へ"
    ></button>`
  }).join('')

  return `<section class="panel controls" data-testid="bat-controls">
    <div class="controls-head">
      <h2>打席（${escapeHtml(teamName)}）</h2>
      <p class="muted small">カーソルを合わせ、タイミングよくスイングしてください。</p>
    </div>
    <p class="incoming-pitch" data-testid="incoming-pitch">
      <span class="badge">${pitch.type.label}</span>
      <span class="badge">${courseLabel(pitch.course, batter, pitcher)}</span>
      <span class="muted small">${escapeHtml(pitch.type.description)}</span>
    </p>
    <div class="bat-control-layout">
      <div class="bat-zone" data-testid="bat-zone">${zoneButtons}</div>
      <div class="bat-timing-wrap">
        <div class="bat-timing-track" data-testid="bat-timing">
          <span class="bat-timing-zone"></span>
          <span
            class="bat-timing-marker"
            data-testid="bat-timing-marker"
            style="left:${battingTimingValue * 100}%"
          ></span>
        </div>
        <p class="muted small">緑のタイミングで振ると捉えやすい</p>
      </div>
    </div>
    <div class="bat-actions">
      <button data-action="bat" data-swing="take" data-testid="take">見送る</button>
      <button data-action="bat" data-swing="contact" data-testid="swing-contact">ミートで打つ</button>
      <button class="primary" data-action="bat" data-swing="power" data-testid="swing-power">強振する</button>
    </div>
    <p class="muted small">ミートは当てる確率が上がり、強振は長打が増えますが空振りも増えます。</p>
  </section>`
}

/** 試合中の画面 */
export function renderGameScreen({
  state,
  homeTeam,
  awayTeam,
  selectedPitchType = 'straight',
  selectedCourseId = null,
  pitchMeterValue = 0.5,
  battingCursor = { row: 1, column: 1 },
  battingTimingValue = 0,
}) {
  const batter = currentBatter(state)
  const pitcher = currentPitcher(state)
  const batting = state.phase === 'bat'
  const turnSide = currentTurnSide(state)
  const turnTeam = turnSide ? state.teams[turnSide] : null
  const turnText =
    state.mode === 'two-player'
      ? `プレイヤー${turnSide === 'home' ? '1' : '2'}（${turnTeam?.name ?? ''}）の${batting ? '攻撃' : '守備'}`
      : batting
        ? 'あなたの攻撃'
        : 'あなたの守備'
  const last = state.lastPitch

  return `
  <div
    class="game-screen"
    data-testid="game-screen"
    data-pitch-count="${state.log.length}"
    data-phase="${state.phase}"
    data-mode="${state.mode}"
    data-turn-side="${turnSide ?? ''}"
  >
    <header class="game-header">
      <div class="inning" data-testid="inning">${state.inning}回 ${state.isTopHalf ? '表' : '裏'}</div>
      <div class="score" data-testid="score">
        <span class="away-team">${escapeHtml(awayTeam.name)}</span>
        <strong>${state.score.away}</strong>
        <span class="dash">-</span>
        <strong>${state.score.home}</strong>
        <span class="home-team">${escapeHtml(homeTeam.name)}</span>
      </div>
      <div class="turn" data-testid="turn">${escapeHtml(turnText)}</div>
    </header>
    ${state.mode === 'two-player' ? `<p class="turn-banner" data-testid="turn-banner">${escapeHtml(turnText)}</p>` : ''}

    <div class="game-top">
      <section class="field-panel">
        <div class="count-row">
          <span class="count" data-testid="count">B ${state.balls} / S ${state.strikes}</span>
          <span class="outs" data-testid="outs">アウト ${state.outs} / 3</span>
        </div>
        <div class="match-stage">
          <canvas class="match-canvas" data-testid="match-canvas" aria-label="試合フィールド"></canvas>
        </div>
        <div class="table-scroll">${linescoreHtml(state, homeTeam, awayTeam)}</div>
      </section>

      <section class="matchup-panel">
        <article class="matchup-card" data-testid="batter-card">
          <span class="role">打者</span>
          <h3>${escapeHtml(batter.name)}</h3>
          <p class="muted small">${BATS_LABEL[batter.bats] ?? ''} / 打撃 ${battingRating(batter)}</p>
          <p class="muted small">ミート ${batter.abilities.contact} ・ 長打 ${batter.abilities.power} ・ 選球 ${batter.abilities.approach}</p>
        </article>
        <article class="matchup-card pitcher-card" data-testid="pitcher-card">
          <span class="role">投手</span>
          <h3>${escapeHtml(pitcher.name)}</h3>
          <p class="muted small">投球 ${pitchingRating(pitcher)}</p>
          <p class="muted small">球速 ${pitcher.abilities.velocity} ・ 制球 ${pitcher.abilities.control} ・ 変化球 ${pitcher.abilities.breaking}</p>
        </article>
      </section>
    </div>

    <p class="last-result" data-testid="last-result">
      ${last ? `<span class="tag">${last.inning}回${last.half}</span> ${escapeHtml(last.batter)} — <strong>${escapeHtml(last.text)}</strong><span class="muted small">（${escapeHtml(last.pitch)}）</span>` : 'プレイボール！'}
    </p>

    ${
      batting
        ? battingControls(
            state,
            turnTeam?.name ?? '',
            batter,
            pitcher,
            battingCursor,
            battingTimingValue,
          )
        : pitchControls(
            selectedPitchType,
            turnTeam?.name ?? '',
            batter,
            pitcher,
            selectedCourseId,
            pitchMeterValue,
          )
    }

    <div class="game-bottom">
      <section class="panel log-panel">
        <h2>プレーログ</h2>
        ${logHtml(state)}
      </section>
    </div>

    <footer class="actions">
      <button data-action="auto-play" data-testid="auto-play">${state.mode === 'two-player' ? '最後まで自動（両チームCPU）' : '最後まで自動で進める'}</button>
      <button data-action="back-to-team" data-testid="game-back">編成に戻る</button>
    </footer>

    <div class="rotate-overlay" data-testid="rotate-overlay">
      <div class="rotate-card">
        <h2>横画面でプレイしてください</h2>
        <p>端末を横向きにすると、フィールドと操作パネルが快適に表示されます。</p>
      </div>
    </div>
  </div>`
}
