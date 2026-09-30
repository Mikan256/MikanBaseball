import { INNINGS } from '../game/constants.js'
import { currentBatter, defenseKey, inningLabel, isGameOver, winnerKey } from '../game/gameState.js'
import { PITCHES } from '../game/pitch.js'

const BALLS = 4
const STRIKES = 3

/** ゲーム画面全体を innerHTML で描画し直す（状態は単一の情報源なので割り切りでよい） */
export function render(root, state, { lastText = '' } = {}) {
  if (isGameOver(state)) {
    root.innerHTML = renderGameOver(state)
    return
  }

  root.innerHTML = `
    <div class="game-header">
      <h1>${escapeHtml(state.away.name)} vs ${escapeHtml(state.home.name)}</h1>
      <p class="inning" data-testid="inning">${inningLabel(state)}</p>
    </div>
    <div class="game-body">
      <section class="panel">
        ${renderLinescore(state)}
        <div class="count-row">
          ${renderCount(state)}
          ${renderBases(state)}
        </div>
        <div class="result-banner" data-testid="result">${escapeHtml(lastText || '球種を選んでください')}</div>
        ${renderPitchButtons()}
      </section>
      <section class="panel">
        <h2 style="margin-top:0;font-size:1rem;color:var(--color-muted)">プレイログ</h2>
        <ul class="play-log" data-testid="log">
          ${state.log
            .map(
              (entry) =>
                `<li><span class="tag">${escapeHtml(entry.inning)}</span>${escapeHtml(entry.text)}</li>`,
            )
            .join('')}
        </ul>
      </section>
    </div>
  `
}

function renderLinescore(state) {
  const rows = [
    { key: 'away', team: state.away },
    { key: 'home', team: state.home },
  ]

  const cells = rows
    .map(({ key, team }) => {
      const innings = Array.from({ length: INNINGS }, (_, i) => {
        const value = state.linescore[key][i]
        const isCurrent =
          state.inning - 1 === i && (key === 'away') === state.isTopHalf && !isGameOver(state)
        return `<td class="${isCurrent ? 'current' : ''}">${value ?? '-'}</td>`
      }).join('')

      return `
        <tr>
          <th class="team-name" style="color:${team.color}">${escapeHtml(team.name)}</th>
          ${innings}
          <td class="total" data-testid="score-${key}">${state.score[key]}</td>
        </tr>
      `
    })
    .join('')

  const header = Array.from({ length: INNINGS }, (_, i) => `<th>${i + 1}</th>`).join('')

  return `
    <table class="linescore">
      <thead><tr><th class="team-name">チーム</th>${header}<th class="total">計</th></tr></thead>
      <tbody>${cells}</tbody>
    </table>
  `
}

function renderCount(state) {
  const balls = Array.from(
    { length: BALLS },
    (_, i) => `<span class="ball ${i < state.balls ? 'on' : ''}"></span>`,
  ).join('')
  const strikes = Array.from(
    { length: STRIKES },
    (_, i) => `<span class="strike ${i < state.strikes ? 'on' : ''}"></span>`,
  ).join('')

  return `
    <div>
      <div class="count-label">B <span data-testid="balls">${state.balls}</span> / S <span data-testid="strikes">${state.strikes}</span> / O <span data-testid="outs">${state.outs}</span></div>
      <div class="count" data-testid="count-balls">${balls}</div>
      <div class="count">${strikes}</div>
    </div>
  `
}

function renderBases(state) {
  const bases = state.runners
    .map((runner, i) => {
      const labels = ['一', '二', '三']
      return `<span class="base ${runner ? 'on' : ''}" data-testid="base-${i + 1}">${labels[i]}</span>`
    })
    .join('')

  const batter = currentBatter(state)
  return `
    <div>
      <div class="count-label">走者</div>
      <div class="bases" data-testid="bases">${bases}</div>
      <div class="count-label" style="margin-top:8px">打者: <span data-testid="batter">${escapeHtml(batter.name)}</span></div>
      <div class="count-label">守備: ${escapeHtml(state[defenseKey(state)].name)}</div>
    </div>
  `
}

function renderPitchButtons() {
  return `
    <div class="pitch-buttons">
      ${PITCHES.map(
        (pitch) => `
        <button class="pitch-button" data-pitch="${pitch.id}" data-testid="pitch-${pitch.id}" style="border-color:${pitch.color}">
          ${escapeHtml(pitch.label)}
          <small>${pitch.speed}km/h</small>
        </button>
      `,
      ).join('')}
    </div>
  `
}

function renderGameOver(state) {
  const winner = winnerKey(state)
  const headline = winner === null ? '引き分け' : `${state[winner].name} の勝利！`

  return `
    <div class="game-over">
      <h2 data-testid="gameover">${escapeHtml(headline)}</h2>
      <p>${state.away.name} ${state.score.away} - ${state.score.home} ${state.home.name}</p>
      <button class="primary" data-action="restart" data-testid="restart">もう一度プレイ</button>
    </div>
  `
}

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
