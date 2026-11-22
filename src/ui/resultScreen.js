import { INNINGS } from '../game/constants.js'
import { escapeHtml } from './teamScreen.js'

/** 試合結果画面 */
export function renderResultScreen({ state, homeTeam, awayTeam, summary }) {
  const winner =
    state.score.home > state.score.away
      ? homeTeam
      : state.score.away > state.score.home
        ? awayTeam
        : null

  const headline = winner ? `${winner.name} の勝利` : '引き分け'
  const inningsCount = Math.max(
    INNINGS,
    state.inning,
    state.linescore.home.length,
    state.linescore.away.length,
  )

  const scoreRows = [
    { key: 'away', team: awayTeam },
    { key: 'home', team: homeTeam },
  ]
    .map(({ key, team }) => {
      const innings = Array.from({ length: inningsCount }, (_, i) => {
        const value = state.linescore[key][i]
        return `<td>${value ?? '-'}</td>`
      }).join('')

      return `<tr>
        <th class="team-name">${escapeHtml(team.name)}</th>
        ${innings}
        <td class="total" data-testid="final-${key}">${state.score[key]}</td>
      </tr>`
    })
    .join('')

  const header = Array.from({ length: inningsCount }, (_, i) => `<th>${i + 1}</th>`).join('')

  const highlights = state.plays
    .filter((play) => ['homerun', 'triple', 'double'].includes(play.outcome))
    .slice(-8)
    .reverse()
    .map(
      (play) => `<li>
        <span class="tag">${play.inning}回${play.half}</span>
        <span class="name">${escapeHtml(play.batter)}</span>
        <span class="result">${escapeHtml(play.text)}</span>
      </li>`,
    )
    .join('')

  return `
  <div class="result-screen">
    <h1 data-testid="result-headline">${escapeHtml(headline)}</h1>
    <p class="final-score" data-testid="final-score">${state.score.away} - ${state.score.home}</p>

    <div class="table-scroll">
      <table class="linescore">
        <thead><tr><th class="team-name">チーム</th>${header}<th class="total">計</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </div>

    <section class="panel">
      <h2>試合概況</h2>
      <dl class="summary">
        <div><dt>総得点</dt><dd>${summary.total}</dd></div>
        <div><dt>得点差</dt><dd>${summary.margin}</dd></div>
        <div><dt>一球勝負</dt><dd>${summary.oneRunGame ? 'はい' : 'いいえ'}</dd></div>
        <div><dt>打席数</dt><dd>${state.plays.length}</dd></div>
      </dl>
    </section>

    <section class="panel">
      <h2>長打のまとめ</h2>
      <ul class="play-log" data-testid="highlights">${highlights || '<li class="muted">長打はありませんでした</li>'}</ul>
    </section>

    <footer class="actions">
      <button data-action="rematch" data-testid="rematch">もう一度対戦</button>
      <button class="primary" data-action="back-to-team" data-testid="back-to-team">編成に戻る</button>
    </footer>
  </div>`
}

export { escapeHtml }
