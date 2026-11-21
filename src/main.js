import { createRng } from './game/rng.js'
import { randomTeam } from './data/rosterFactory.js'
import {
  findPlayer,
  renameTeam,
  replacePlayer,
  updatePlayerAbilities,
  updatePlayerProfile,
  updatePositionFit,
  validateLineup,
} from './game/roster.js'
import { parseMatchCode, serializeMatch } from './game/teamCode.js'
import { gameSummary } from './game/simulate.js'
import { autoPlayLiveGame, createLiveGame, submitBatting, submitPitch } from './game/liveGame.js'
import { swapBattingOrder, swapPositions, swapWithBench } from './ui/rosterOps.js'
import { renderTeamScreen } from './ui/teamScreen.js'
import { renderGameScreen } from './ui/gameScreen.js'
import { renderResultScreen } from './ui/resultScreen.js'

const root = document.querySelector('#app')

const OPPONENTS = [
  { name: '東風タイガース', color: '#d9534f' },
  { name: '北星ホークス', color: '#4a90d9' },
  { name: '南国エレファンツ', color: '#2f9e6b' },
]

let screen = 'title'
let team = null
let opponent = null
let gameState = null
let gameRng = null
let message = ''
let selectedPlayerId = null
let selectedPitchType = 'straight'
let importText = ''
let dataOpen = false
let mode = 'solo'
let activeSide = 'home'

function startSetup(seed) {
  const target = OPPONENTS[seed % OPPONENTS.length]
  team = randomTeam({ name: 'みかんタイガース', color: '#f5a524', seed, benchCount: 5 })
  opponent = randomTeam({ name: target.name, color: target.color, seed: seed + 1, benchCount: 5 })
  screen = 'team'
  message = ''
  selectedPlayerId = null
  importText = ''
  dataOpen = false
  activeSide = 'home'
  draw()
}

/** いま編集中のチーム */
function activeTeam() {
  return activeSide === 'away' ? opponent : team
}

/** 編集中のチームだけを差し替える */
function updateActiveTeam(nextTeam) {
  if (activeSide === 'away') opponent = nextTeam
  else team = nextTeam
}

/** 能力値エディタの入力を読み取る */
function readEditorValues() {
  const abilities = {}
  const fit = {}
  const profile = {}

  for (const input of document.querySelectorAll('[data-ability]')) {
    abilities[input.dataset.ability] = Number(input.value)
  }
  for (const input of document.querySelectorAll('[data-fit]')) {
    fit[input.dataset.fit] = Number(input.value)
  }
  for (const input of document.querySelectorAll('[data-profile]')) {
    profile[input.dataset.profile] = input.value
  }

  return { abilities, fit, profile }
}

function startGame() {
  if (!validateLineup(team).valid || !validateLineup(opponent).valid) {
    message = '両チームの編成を確認してください'
    draw()
    return
  }

  gameRng = createRng(Math.floor(Math.random() * 1_000_000_000))
  gameState = createLiveGame({
    homeTeam: team,
    awayTeam: opponent,
    playerSide: 'home',
    mode,
    rng: gameRng,
  })
  selectedPitchType = 'straight'
  message = ''
  screen = 'game'
  draw()
}

/** 1 球進めたあとの画面更新。試合が終わったら結果画面へ。 */
function afterGameAction() {
  if (gameState?.finished) screen = 'result'
  draw()
}

function renameCurrentTeam() {
  const input = document.querySelector('[data-testid="team-name-input"]')
  const next = renameTeam(activeTeam(), input?.value ?? '')

  if (!next) {
    message = 'チーム名を入力してください'
    draw()
    return
  }

  updateActiveTeam(next)
  message = `チーム名を「${next.name}」に変更しました`
  draw()
}

async function copyTeamCode() {
  const textarea = document.querySelector('[data-testid="team-code"]')
  const code = textarea?.value ?? serializeMatch(team, opponent)
  dataOpen = true

  try {
    await navigator.clipboard.writeText(code)
    message = 'チームデータをコピーしました'
  } catch {
    textarea?.select()
    try {
      document.execCommand('copy')
      message = 'チームデータをコピーしました'
    } catch {
      message = 'コピーできませんでした。テキストを選択してコピーしてください'
    }
  }

  draw()
}

function downloadTeamCode() {
  const code = serializeMatch(team, opponent)
  dataOpen = true
  const blob = new Blob([code], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeName = `${team.name}-vs-${opponent.name}`.replace(/[\\/:*?"<>|]/g, '_') || 'match'

  anchor.href = url
  anchor.download = `${safeName}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  message = 'チームデータをファイルに保存しました'
  draw()
}

function applyImportedTeam(text) {
  const result = parseMatchCode(text)

  if (!result.ok) {
    importText = text
    dataOpen = true
    message = `読み込めません: ${result.errors[0]}`
    draw()
    return
  }

  if (result.match) {
    team = result.match.home
    opponent = result.match.away
    message = `「${team.name}」と「${opponent.name}」の 2 チームを読み込みました`
  } else {
    updateActiveTeam(result.team)
    message = `「${result.team.name}」を読み込みました`
  }

  selectedPlayerId = null
  importText = ''
  dataOpen = true
  draw()
}

function importTeamFromInput() {
  const textarea = document.querySelector('[data-testid="import-code"]')
  applyImportedTeam(textarea?.value ?? '')
}

function saveSelectedPlayer() {
  const current = activeTeam()
  const player = findPlayer(current, selectedPlayerId)
  if (!player) {
    message = '編集する選手が見つかりません'
    selectedPlayerId = null
    draw()
    return
  }

  const { abilities, fit, profile } = readEditorValues()
  let next = updatePlayerAbilities(player, abilities)
  next = updatePositionFit(next, fit)
  next = updatePlayerProfile(next, profile)

  updateActiveTeam(replacePlayer(current, player.id, next))
  message = `${next.name} の能力値を更新しました`
  selectedPlayerId = null
  draw()
}

function draw() {
  if (screen === 'team') {
    root.innerHTML = renderTeamScreen({
      homeTeam: team,
      awayTeam: opponent,
      activeSide,
      mode,
      homeValidation: validateLineup(team),
      awayValidation: validateLineup(opponent),
      message,
      selectedPlayerId,
      teamCode: serializeMatch(team, opponent),
      importText,
      dataOpen,
    })
    return
  }

  if (screen === 'game' && gameState) {
    root.innerHTML = renderGameScreen({
      state: gameState,
      homeTeam: team,
      awayTeam: opponent,
      selectedPitchType,
    })
    return
  }

  if (screen === 'result' && gameState) {
    root.innerHTML = renderResultScreen({
      state: gameState,
      homeTeam: team,
      awayTeam: opponent,
      summary: gameSummary(gameState),
    })
    return
  }

  root.innerHTML = `
    <div class="title-screen">
      <h1>みかん野球</h1>
      <p>能力値を自分で決めて打線を組み、1 球ずつ采配する野球ゲーム。</p>
      <button class="primary" data-action="new-game" data-testid="start">チームを作る</button>
    </div>
  `
}

root.addEventListener('input', (event) => {
  if (event.target.matches('[data-testid="import-code"]')) {
    importText = event.target.value
    return
  }

  const input = event.target.closest('[data-ability], [data-fit]')
  if (!input) return

  const output = input.parentElement.querySelector('output')
  if (output) output.textContent = input.value

  const total = document.querySelector('[data-testid="ability-total"]')
  if (total) {
    let sum = 0
    for (const slider of document.querySelectorAll('[data-ability]')) {
      sum += Number(slider.value)
    }
    total.textContent = sum
  }
})

root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  if (!event.target.matches('[data-testid="team-name-input"]')) return

  event.preventDefault()
  renameCurrentTeam()
})

root.addEventListener('change', async (event) => {
  const input = event.target
  if (!input.matches('[data-testid="team-code-file"]')) return

  const file = input.files?.[0]
  if (!file) return

  try {
    applyImportedTeam(await file.text())
  } catch {
    message = 'ファイルを読み込めませんでした'
    draw()
  }
})

root.addEventListener('click', (event) => {
  const summary = event.target.closest('[data-testid="data-summary"]')
  if (summary) {
    // details の開閉はブラウザに任せ、再描画後も状態を保つ
    dataOpen = !summary.parentElement.open
    return
  }

  const button = event.target.closest('button')
  if (!button || button.disabled) return

  const action = button.dataset.action

  switch (action) {
    case 'new-game':
    case 'reroll':
      startSetup(Math.floor(Math.random() * 100000))
      return

    case 'select-team':
      activeSide = button.dataset.side === 'away' ? 'away' : 'home'
      selectedPlayerId = null
      message = ''
      draw()
      return

    case 'set-mode':
      mode = button.dataset.mode === 'two-player' ? 'two-player' : 'solo'
      message = mode === 'two-player' ? '2人プレイに設定しました' : '1人プレイに設定しました'
      draw()
      return

    case 'rename-team':
      renameCurrentTeam()
      return

    case 'copy-team-code':
      copyTeamCode()
      return

    case 'download-team-code':
      downloadTeamCode()
      return

    case 'import-team-code':
      importTeamFromInput()
      return

    case 'edit-player':
      selectedPlayerId = button.dataset.player
      message = ''
      draw()
      return

    case 'cancel-edit':
      selectedPlayerId = null
      draw()
      return

    case 'save-player':
      saveSelectedPlayer()
      return

    case 'swap-order': {
      const current = activeTeam()
      updateActiveTeam({
        ...current,
        starters: swapBattingOrder(
          current.starters,
          Number(button.dataset.from),
          Number(button.dataset.to),
        ),
      })
      draw()
      return
    }

    case 'swap-positions': {
      const selectA = document.querySelector('[data-testid="position-a"]')
      const selectB = document.querySelector('[data-testid="position-b"]')
      if (!selectA?.value || !selectB?.value) {
        message = '守備位置を 2 つ選んでください'
        draw()
        return
      }
      const current = activeTeam()
      updateActiveTeam({
        ...current,
        starters: swapPositions(current.starters, selectA.value, selectB.value),
      })
      draw()
      return
    }

    case 'promote':
      updateActiveTeam(swapWithBench(activeTeam(), 0, Number(button.dataset.bench)))
      draw()
      return

    case 'start-game':
    case 'rematch':
      startGame()
      return

    case 'select-pitch-type':
      selectedPitchType = button.dataset.type
      draw()
      return

    case 'pitch':
      if (!gameState || gameState.phase !== 'pitch') return
      submitPitch(
        gameState,
        { typeId: selectedPitchType, courseId: button.dataset.course },
        gameRng,
      )
      afterGameAction()
      return

    case 'bat':
      if (!gameState || gameState.phase !== 'bat') return
      submitBatting(gameState, button.dataset.swing, gameRng)
      afterGameAction()
      return

    case 'auto-play':
      if (!gameState) return
      autoPlayLiveGame(gameState, gameRng)
      afterGameAction()
      return

    case 'back-to-team':
      screen = 'team'
      draw()
      return

    default:
      break
  }
})

draw()
