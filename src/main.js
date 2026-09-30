import { TEAMS } from './data/teams.js'
import { createInitialState } from './game/gameState.js'
import { throwPitch } from './game/pitch.js'
import { render } from './ui/render.js'

const root = document.querySelector('#app')

/** ゲーム画面内の右クリックメニューを抑止する */
document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.app')) event.preventDefault()
})

function newGame() {
  return createInitialState({
    home: TEAMS.home,
    away: TEAMS.away,
    rngSeed: Math.floor(Math.random() * 2147483647),
  })
}

let state = null
let lastText = ''

function draw() {
  if (!state) {
    root.innerHTML = renderTitle()
    return
  }
  render(root, state, { lastText })
}

function renderTitle() {
  return `
    <div class="title-screen">
      <h1>みかん野球</h1>
      <p>球種を選んで、9 回まで戦おう。</p>
      <button class="primary" data-action="start" data-testid="start">ゲーム開始</button>
    </div>
  `
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button) return

  if (button.dataset.action === 'start' || button.dataset.action === 'restart') {
    state = newGame()
    lastText = ''
    draw()
    return
  }

  if (button.dataset.pitch) {
    if (!state) return
    const result = throwPitch(state, button.dataset.pitch)
    lastText = result.text
    draw()
  }
})

draw()
