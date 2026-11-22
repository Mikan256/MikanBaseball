import { createRng } from './game/rng.js'
import { randomPlayer, randomTeam } from './data/rosterFactory.js'
import {
  MAX_BENCH,
  addBenchPlayer,
  findPlayer,
  removeBenchPlayer,
  renameTeam,
  replacePlayer,
  updatePlayerAbilities,
  updatePlayerProfile,
  updatePositionFit,
  validateLineup,
} from './game/roster.js'
import { parseMatchCode, serializeMatch } from './game/teamCode.js'
import { gameSummary } from './game/simulate.js'
import {
  COURSES,
  autoPlayLiveGame,
  createLiveGame,
  submitBatting,
  submitPitch,
} from './game/liveGame.js'
import { swapBattingOrder, swapPositions, swapWithBench } from './ui/rosterOps.js'
import { renderTeamScreen } from './ui/teamScreen.js'
import { renderGameScreen } from './ui/gameScreen.js'
import { renderResultScreen } from './ui/resultScreen.js'
import { createMatchView } from './ui/matchView.js'

const root = document.querySelector('#app')
const SAVE_KEY = 'mikanbaseball-match-v1'

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
let gameSeed = 1
let message = ''
let selectedPlayerId = null
let selectedPitchType = 'straight'
let importText = ''
let dataOpen = false
let mode = 'solo'
let activeSide = 'home'
let matchView = null
let selectedCourseId = null
const pitchMeter = { running: false, value: 0.5, direction: 1, frame: 0, lastTime: 0 }
const battingTiming = { running: false, value: 0, frame: 0, lastTime: 0 }
let battingCursor = { row: 1, column: 1 }

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
  clearSavedGame()
  draw()
}

function readSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data?.version !== 1 || !data.state || !data.homeTeam || !data.awayTeam) return null
    return data
  } catch {
    return null
  }
}

function saveGame() {
  if (!gameState || gameState.finished) {
    clearSavedGame()
    return
  }

  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        state: gameState,
        homeTeam: team,
        awayTeam: opponent,
        mode,
        gameSeed,
        savedAt: Date.now(),
      }),
    )
  } catch {
    // 保存できない環境でも試合は続行する
  }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // 何もしない
  }
}

function resumeGame() {
  const saved = readSavedGame()
  if (!saved) return

  team = saved.homeTeam
  opponent = saved.awayTeam
  gameState = saved.state
  mode = saved.mode === 'two-player' ? 'two-player' : 'solo'
  gameSeed = Number(saved.gameSeed) || 1
  gameRng = createRng(gameSeed + (gameState.log?.length ?? 0))
  selectedPitchType = 'straight'
  selectedCourseId = null
  pitchMeter.value = 0.5
  pitchMeter.direction = 1
  battingCursor = { row: 1, column: 1 }
  stopMeters()
  message = '保存した試合を再開しました'
  screen = 'game'
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

function mountMatchView() {
  const canvas = root.querySelector('[data-testid="match-canvas"]')
  if (!canvas) return

  if (!matchView) {
    matchView = createMatchView(canvas)
    matchView.start()
  } else {
    matchView.setCanvas(canvas)
  }

  matchView.setState(gameState)
}

function stopMatchView() {
  stopMeters()
  if (!matchView) return
  matchView.destroy()
  matchView = null
}

function stopMeters() {
  stopPitchMeter()
  stopBattingTiming()
}

function startGame() {
  if (!validateLineup(team).valid || !validateLineup(opponent).valid) {
    message = '両チームの編成を確認してください'
    draw()
    return
  }

  gameSeed = Math.floor(Math.random() * 1_000_000_000)
  gameRng = createRng(gameSeed)
  gameState = createLiveGame({
    homeTeam: team,
    awayTeam: opponent,
    playerSide: 'home',
    mode,
    rng: gameRng,
  })
  selectedPitchType = 'straight'
  selectedCourseId = null
  pitchMeter.value = 0.5
  pitchMeter.direction = 1
  battingCursor = { row: 1, column: 1 }
  stopPitchMeter()
  stopBattingTiming()
  message = ''
  screen = 'game'
  saveGame()
  draw()
}

function startPitchMeter() {
  if (pitchMeter.running) return

  pitchMeter.running = true
  pitchMeter.lastTime = performance.now()

  const loop = (now) => {
    if (!pitchMeter.running) return

    const delta = Math.min(0.05, (now - pitchMeter.lastTime) / 1000)
    pitchMeter.lastTime = now
    pitchMeter.value += pitchMeter.direction * delta * 1.35

    if (pitchMeter.value >= 1) {
      pitchMeter.value = 1
      pitchMeter.direction = -1
    } else if (pitchMeter.value <= 0) {
      pitchMeter.value = 0
      pitchMeter.direction = 1
    }

    const marker = document.querySelector('[data-testid="pitch-meter-marker"]')
    if (marker) marker.style.left = `${pitchMeter.value * 100}%`
    pitchMeter.frame = requestAnimationFrame(loop)
  }

  pitchMeter.frame = requestAnimationFrame(loop)
}

function stopPitchMeter() {
  pitchMeter.running = false
  cancelAnimationFrame(pitchMeter.frame)
}

function releasePitch() {
  if (!gameState || gameState.phase !== 'pitch' || !selectedCourseId) return

  const distance = Math.abs(pitchMeter.value - 0.5)
  const releaseQuality = Math.min(1, Math.max(0.08, 1 - distance * 3.4))
  stopPitchMeter()

  submitPitch(
    gameState,
    {
      typeId: selectedPitchType,
      courseId: selectedCourseId,
      releaseQuality,
    },
    gameRng,
  )
  selectedCourseId = null
  pitchMeter.value = 0.5
  pitchMeter.direction = 1
  afterGameAction()
}

function startBattingTiming() {
  if (battingTiming.running) return

  battingTiming.running = true
  battingTiming.value = 0
  battingTiming.lastTime = performance.now()

  const loop = (now) => {
    if (!battingTiming.running) return

    const delta = Math.min(0.05, (now - battingTiming.lastTime) / 1000)
    battingTiming.lastTime = now
    battingTiming.value += delta / 2.4

    if (battingTiming.value >= 1) {
      battingTiming.value = 1
      stopBattingTiming()
      if (gameState && gameState.phase === 'bat') {
        submitBatting(gameState, 'take', gameRng)
        afterGameAction()
      }
      return
    }

    const marker = document.querySelector('[data-testid="bat-timing-marker"]')
    if (marker) marker.style.left = `${battingTiming.value * 100}%`
    battingTiming.frame = requestAnimationFrame(loop)
  }

  battingTiming.frame = requestAnimationFrame(loop)
}

function stopBattingTiming() {
  battingTiming.running = false
  cancelAnimationFrame(battingTiming.frame)
}

function syncTimers() {
  if (screen !== 'game' || !gameState || gameState.finished) {
    stopPitchMeter()
    stopBattingTiming()
    return
  }

  if (gameState.phase === 'bat') {
    stopPitchMeter()
    selectedCourseId = null
    if (!battingTiming.running) startBattingTiming()
    return
  }

  stopBattingTiming()
  if (selectedCourseId && !pitchMeter.running) startPitchMeter()
}

function battingTimingQuality() {
  const distance = Math.abs(battingTiming.value - 0.55)
  return Math.min(1, Math.max(0.05, 1 - distance * 2.8))
}

function cursorMatchesPitch() {
  const course = gameState?.currentPitch?.course
  if (!course) return false
  return course.row === battingCursor.row && course.column === battingCursor.column
}

/** 1 球進めたあとの画面更新。試合が終わったら結果画面へ。 */
function afterGameAction() {
  stopPitchMeter()
  stopBattingTiming()
  saveGame()
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

function addBenchToActiveTeam() {
  const current = activeTeam()
  if (current.bench.length >= MAX_BENCH) {
    message = `控えは最大 ${MAX_BENCH} 人までです`
    draw()
    return
  }

  const seed = Math.floor(Math.random() * 1_000_000_000)
  const player = randomPlayer(createRng(seed), {
    position: null,
    index: current.bench.length,
    seedOffset: seed,
  })
  updateActiveTeam(addBenchPlayer(current, player))
  message = `${player.name} を控えに追加しました`
  draw()
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
      selectedCourseId,
      pitchMeterValue: pitchMeter.value,
      battingCursor,
      battingTimingValue: battingTiming.value,
    })
    mountMatchView()
    syncTimers()
    return
  }

  stopMatchView()

  if (screen === 'result' && gameState) {
    root.innerHTML = renderResultScreen({
      state: gameState,
      homeTeam: team,
      awayTeam: opponent,
      summary: gameSummary(gameState),
    })
    return
  }

  const saved = readSavedGame()
  const savedInfo = saved
    ? `<p class="muted small" data-testid="saved-game-info">${saved.state.inning}回${saved.state.isTopHalf ? '表' : '裏'} ${saved.state.score.away} - ${saved.state.score.home} / ${escapeText(saved.homeTeam.name)} vs ${escapeText(saved.awayTeam.name)}</p>`
    : ''

  root.innerHTML = `
    <div class="title-screen">
      <h1>みかん野球</h1>
      <p>能力値を自分で決めて打線を組み、1 球ずつ采配する野球ゲーム。</p>
      ${savedInfo}
      <div class="title-actions">
        ${saved ? '<button class="primary" data-action="resume-game" data-testid="resume-game">続きから</button>' : ''}
        <button class="${saved ? '' : 'primary'}" data-action="new-game" data-testid="start">${saved ? '新しいチームで始める' : 'チームを作る'}</button>
        ${saved ? '<button data-action="delete-save" data-testid="delete-save">保存を削除</button>' : ''}
      </div>
    </div>
  `
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return entities[char]
  })
}

function updateAbilityTotal() {
  const total = document.querySelector('[data-testid="ability-total"]')
  if (!total) return

  let sum = 0
  for (const slider of document.querySelectorAll('[data-ability]')) {
    sum += Number(slider.value)
  }
  total.textContent = sum
}

/** スライダーと数値入力の値を同期する */
function syncAbilityPair(source) {
  const fitKey = source.dataset.fit ?? source.dataset.fitNumber
  const isFit = fitKey !== undefined
  const key = isFit ? fitKey : (source.dataset.ability ?? source.dataset.abilityNumber)

  const range = source.parentElement.querySelector(
    isFit ? `[data-fit="${key}"]` : `[data-ability="${key}"]`,
  )
  const number = source.parentElement.querySelector(
    isFit ? `[data-fit-number="${key}"]` : `[data-ability-number="${key}"]`,
  )
  if (!range || !number) return

  if (source === number) {
    const value = Number(number.value)
    if (!Number.isFinite(value)) return
    range.value = String(Math.min(100, Math.max(1, value)))
  } else {
    number.value = range.value
  }
}

root.addEventListener('input', (event) => {
  if (event.target.matches('[data-testid="import-code"]')) {
    importText = event.target.value
    return
  }

  const source = event.target.closest(
    '[data-ability], [data-fit], [data-ability-number], [data-fit-number]',
  )
  if (!source) return

  syncAbilityPair(source)
  updateAbilityTotal()
})

window.addEventListener('keydown', (event) => {
  if (screen === 'game' && gameState) {
    const key = event.key

    if (gameState.phase === 'pitch') {
      if (/^[1-9]$/.test(key)) {
        event.preventDefault()
        selectedCourseId = COURSES[Number(key) - 1].id
        pitchMeter.value = 0.5
        pitchMeter.direction = 1
        draw()
        startPitchMeter()
        return
      }
      if (key === ' ' || key === 'Enter') {
        event.preventDefault()
        if (selectedCourseId) {
          releasePitch()
        } else {
          selectedCourseId = COURSES[4].id
          draw()
          startPitchMeter()
        }
      }
      return
    }

    if (gameState.phase === 'bat') {
      if (key.startsWith('Arrow')) {
        event.preventDefault()
        if (event.repeat) return
        const next = { ...battingCursor }
        if (key === 'ArrowUp') next.row = Math.max(0, next.row - 1)
        if (key === 'ArrowDown') next.row = Math.min(2, next.row + 1)
        if (key === 'ArrowLeft') next.column = Math.max(0, next.column - 1)
        if (key === 'ArrowRight') next.column = Math.min(2, next.column + 1)
        battingCursor = next
        draw()
        return
      }

      if (key === 'z' || key === 'Z' || key === 'x' || key === 'X' || key === ' ') {
        event.preventDefault()
        if (event.repeat) return
        const action = key === 'x' || key === 'X' ? 'power' : key === ' ' ? 'take' : 'contact'
        const timingQuality = battingTimingQuality()
        const cursorMatch = cursorMatchesPitch()
        stopBattingTiming()
        submitBatting(gameState, action, gameRng, { timingQuality, cursorMatch })
        afterGameAction()
      }
      return
    }
  }

  if (event.key !== 'Enter') return
  if (!event.target.matches('[data-testid="team-name-input"]')) return

  event.preventDefault()
  renameCurrentTeam()
})

root.addEventListener('change', async (event) => {
  const input = event.target

  if (input.matches('[data-ability-number], [data-fit-number]')) {
    const value = Number(input.value)
    input.value = String(Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value))) : 1)
    syncAbilityPair(input)
    updateAbilityTotal()
    return
  }

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

    case 'resume-game':
      resumeGame()
      return

    case 'delete-save':
      clearSavedGame()
      draw()
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

    case 'add-bench':
      addBenchToActiveTeam()
      return

    case 'remove-bench':
      updateActiveTeam(removeBenchPlayer(activeTeam(), Number(button.dataset.bench)))
      message = '控え選手を削除しました'
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
      selectedCourseId = button.dataset.course
      pitchMeter.value = 0.5
      pitchMeter.direction = 1
      draw()
      startPitchMeter()
      return

    case 'release-pitch':
      releasePitch()
      return

    case 'move-cursor':
      battingCursor = {
        row: Number(button.dataset.row),
        column: Number(button.dataset.column),
      }
      draw()
      return

    case 'bat': {
      if (!gameState || gameState.phase !== 'bat') return
      const timingQuality = battingTimingQuality()
      const cursorMatch = cursorMatchesPitch()
      stopBattingTiming()
      submitBatting(gameState, button.dataset.swing, gameRng, { timingQuality, cursorMatch })
      afterGameAction()
      return
    }

    case 'auto-play':
      if (!gameState) return
      stopMeters()
      autoPlayLiveGame(gameState, gameRng)
      afterGameAction()
      return

    case 'back-to-team':
      stopMeters()
      screen = 'team'
      draw()
      return

    default:
      break
  }
})

draw()
