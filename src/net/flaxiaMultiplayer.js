// 契約: https://github.com/TeamFlaxia/flaxia/blob/main/docs/developer/game-api.md
import { createRng } from '../game/rng.js'
import { createLiveGame, currentTurnSide, submitBatting, submitPitch } from '../game/liveGame.js'
import { parseTeamCode, serializeTeam } from '../game/teamCode.js'
import { packMatchState, unpackMatchState } from './onlineState.js'

export const FLaxia_GAME_ID = 'mikanbaseball'
const MAX_PEER_PAYLOAD = 60_000

export function isFlaxiaEnvironment() {
  if (typeof window === 'undefined') return false
  return window.parent !== window || /(^|\.)flaxia\.app$/i.test(window.location.hostname)
}

export async function loadFlaxiaSdk() {
  // 現行のGame SDKは /sdk/game.js。旧 /sdk/multiplayer.js は配信されていない環境がある。
  if (window.FlaxiaGame) return window.FlaxiaGame
  if (window.FlaxiaMultiplayer) return window.FlaxiaMultiplayer
  if (!isFlaxiaEnvironment()) {
    throw new Error('Flaxia Arcade内で起動するとオンライン対戦が使えます')
  }

  const inject = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = () => reject(new Error(`${src} を読み込めませんでした`))
      document.head.append(script)
    })

  try {
    await inject('/sdk/game.js')
  } catch {
    // 旧環境向けフォールバック
    await inject('/sdk/multiplayer.js')
  }

  if (!window.FlaxiaGame && !window.FlaxiaMultiplayer) {
    throw new Error('Flaxia Game SDKが利用できません')
  }
  return window.FlaxiaGame ?? window.FlaxiaMultiplayer
}

function teamPayload(team) {
  return JSON.parse(serializeTeam(team))
}

function parseTeamPayload(payload) {
  return parseTeamCode(JSON.stringify(payload))
}

/** ピアから届いた操作を検証する */
export function sanitizeOnlineAction(action) {
  if (!action || typeof action !== 'object') return null

  if (action.kind === 'pitch') {
    const selection = action.selection
    if (!selection || typeof selection !== 'object') return null
    if (typeof selection.typeId !== 'string' || typeof selection.courseId !== 'string') return null
    const releaseQuality = Number(selection.releaseQuality)
    return {
      kind: 'pitch',
      selection: {
        typeId: selection.typeId,
        courseId: selection.courseId,
        releaseQuality: Number.isFinite(releaseQuality)
          ? Math.min(1, Math.max(0, releaseQuality))
          : 0.5,
      },
    }
  }

  if (action.kind === 'bat') {
    if (!['take', 'contact', 'power'].includes(action.swing)) return null
    const timingQuality = Number(action.timingQuality)
    return {
      kind: 'bat',
      swing: action.swing,
      timingQuality: Number.isFinite(timingQuality) ? Math.min(1, Math.max(0, timingQuality)) : 0.5,
      cursorMatch: Boolean(action.cursorMatch),
    }
  }

  return null
}

/** ホスト側で操作を試合状態に適用する */
export function applyOnlineAction(state, action, rng) {
  const safe = sanitizeOnlineAction(action)
  if (!safe) return false

  if (safe.kind === 'pitch') {
    submitPitch(state, safe.selection, rng)
    return true
  }

  submitBatting(state, safe.swing, rng, {
    timingQuality: safe.timingQuality,
    cursorMatch: safe.cursorMatch,
  })
  return true
}

/**
 * Flaxia SDK を使ったホスト権威のオンライン対戦。
 *
 * - 部屋を作った側がホスト（ホーム）
 * - ルームIDで参加した側がゲスト（アウェイ）
 * - ホストだけが試合エンジンを動かし、状態を相手へ送る
 */
export class OnlineMatch {
  constructor({ onLobby, onGame, onError, gameId = FLaxia_GAME_ID } = {}) {
    this.gameId = gameId
    this.onLobby = onLobby ?? (() => {})
    this.onGame = onGame ?? (() => {})
    this.onError = onError ?? (() => {})

    this.client = null
    this.room = null
    this.players = []
    this.isHost = false
    this.localSide = 'home'
    this.localTeam = null
    this.remoteTeam = null
    this.localReady = false
    this.remoteReady = false
    this.gameState = null
    this.teams = null
    this.pendingAction = false
    this.game = null
    this.rng = createRng(1)
    this.seed = 1
    this.connecting = false
    this.connected = false
    this.connectTimer = null
    this.status = ''
    this.error = ''
  }

  clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  snapshot() {
    return {
      available: isFlaxiaEnvironment(),
      connecting: this.connecting,
      connected: this.connected,
      roomId: this.room?.roomId ?? this.client?.currentRoomId ?? null,
      players: this.players,
      isHost: this.isHost,
      localSide: this.localSide,
      localReady: this.localReady,
      remoteReady: this.remoteReady,
      canStart: Boolean(
        this.isHost && this.localReady && this.remoteReady && this.localTeam && this.remoteTeam,
      ),
      localTeamName: this.localTeam?.name ?? null,
      remoteTeamName: this.remoteTeam?.name ?? null,
      status: this.status,
      error: this.error,
    }
  }

  async connect({ roomId = null } = {}) {
    if (this.connecting || this.client) return
    this.connecting = true
    this.error = ''
    this.status = '接続中...'
    this.onLobby()

    try {
      const sdk = await loadFlaxiaSdk()
      this.isHost = !roomId
      this.localSide = this.isHost ? 'home' : 'away'

      if (typeof sdk.FlaxiaGame === 'function') {
        this.game = new sdk.FlaxiaGame({ gameId: this.gameId, autoConnect: false })
        this.client = this.game.multiplayer
      } else if (typeof sdk.MultiplayerClient === 'function') {
        this.client = new sdk.MultiplayerClient({ gameId: this.gameId, autoConnect: false })
      } else {
        throw new Error('Flaxia Game SDKの形式が不正です')
      }

      this.bindEvents()
      this.connected = false
      this.client.connect(roomId || undefined)
      this.status = roomId ? 'ルームに参加しています...' : 'ルームを作成しています...'
      this.connectTimer = setTimeout(() => {
        if (this.room) return
        this.error = 'ルームに接続できませんでした。Flaxiaにログインしているか確認してください'
        this.status = '接続できません'
        this.onLobby()
      }, 12_000)
    } catch (error) {
      this.error = error.message
      this.status = ''
      this.connected = false
      this.clearConnectTimer()
    } finally {
      this.connecting = false
      this.onLobby()
    }
  }

  bindEvents() {
    const client = this.client

    client.on('onRoomState', (state) => {
      this.clearConnectTimer()
      this.connected = true
      this.room = state.room
      this.players = state.players ?? []
      this.status = `${this.players.length}/${state.room.maxPlayers} 人が参加中`
      if (this.players.length >= 2) this.announceTeam()
      this.onLobby()
    })

    client.on('onPlayerJoined', (player) => {
      this.status = `${player.username ?? 'プレイヤー'} が参加しました`
      this.announceTeam()
      this.onLobby()
    })

    client.on('onPlayerLeft', () => {
      this.remoteReady = false
      this.remoteTeam = null
      this.status = '相手プレイヤーが退出しました'
      this.onLobby()
    })

    client.on('onError', (error) => {
      this.clearConnectTimer()
      this.error = error.message
      this.onLobby()
    })

    client.on('onDisconnect', () => {
      this.clearConnectTimer()
      this.connected = false
      this.status = '切断されました'
      this.onLobby()
    })

    client.on('onPeerData', (event) => {
      this.handlePeerData(event.data)
    })
  }

  handlePeerData(data) {
    if (!data || typeof data !== 'object') return

    if (data.type === 'mikan:team') {
      const parsed = parseTeamPayload(data.team)
      if (!parsed.ok) {
        this.error = `相手のチームデータが不正です: ${parsed.errors[0]}`
        this.onLobby()
        return
      }
      this.remoteTeam = parsed.team
      this.remoteReady = true
      this.status = `${parsed.team.name} の準備ができました`
      this.onLobby()
      return
    }

    if (data.type === 'mikan:start') {
      if (this.isHost) return
      const home = parseTeamPayload(data.home)
      const away = parseTeamPayload(data.away)
      if (!home.ok || !away.ok) {
        this.error = '開始データを読み込めませんでした'
        this.onLobby()
        return
      }

      this.teams = { home: home.team, away: away.team }
      this.seed = Number(data.seed) || 1
      this.gameState = unpackMatchState(data.state, this.teams)
      this.pendingAction = false
      this.connected = true
      this.status = '試合開始'
      this.onGame(this.gameState, this.localSide)
      return
    }

    if (data.type === 'mikan:state') {
      if (this.isHost || !this.teams) return
      this.gameState = unpackMatchState(data.state, this.teams)
      this.pendingAction = false
      this.onGame(this.gameState, this.localSide)
      return
    }

    if (data.type === 'mikan:action') {
      if (!this.isHost || !this.gameState || this.gameState.finished) return
      // ホストはホーム。ゲスト（アウェイ）の手番以外の操作は拒否する
      if (currentTurnSide(this.gameState) !== 'away') return
      if (!applyOnlineAction(this.gameState, data.action, this.rng)) return
      this.broadcastState()
      this.onGame(this.gameState, this.localSide)
    }
  }

  send(payload) {
    if (!this.client?.isConnected) return false
    if (JSON.stringify(payload).length > MAX_PEER_PAYLOAD) {
      this.error = '送信データが大きすぎます'
      this.onLobby()
      return false
    }
    this.client.sendPeerData(payload)
    return true
  }

  announceTeam() {
    if (!this.localReady || !this.localTeam) return false
    return this.send({ type: 'mikan:team', team: teamPayload(this.localTeam) })
  }

  ready(team) {
    if (!this.client || !this.connected) return false
    this.localTeam = team
    this.localReady = true
    this.client.setReady(true)
    this.announceTeam()
    this.status = '準備完了。相手を待っています'
    this.onLobby()
    return true
  }

  startMatch() {
    if (!this.isHost || !this.localTeam || !this.remoteTeam) return false

    if (!this.gameState) {
      this.seed = Math.floor(Math.random() * 1_000_000_000)
      this.rng = createRng(this.seed)
      this.teams = { home: this.localTeam, away: this.remoteTeam }
      this.gameState = createLiveGame({
        homeTeam: this.teams.home,
        awayTeam: this.teams.away,
        mode: 'two-player',
        rng: this.rng,
      })
      this.localSide = 'home'
    }

    try {
      this.client.startGame()
    } catch {
      // プラットフォーム側の開始通知が失敗しても、独自の start メッセージで続行する
    }

    this.send({
      type: 'mikan:start',
      home: teamPayload(this.teams.home),
      away: teamPayload(this.teams.away),
      seed: this.seed,
      state: packMatchState(this.gameState),
    })
    this.status = '試合開始'
    this.onGame(this.gameState, this.localSide)
    return true
  }

  submitAction(action) {
    if (!this.gameState || this.gameState.finished) return false

    if (this.isHost) {
      if (!applyOnlineAction(this.gameState, action, this.rng)) return false
      this.broadcastState()
      this.onGame(this.gameState, this.localSide)
      return true
    }

    if (this.pendingAction) return false
    this.pendingAction = true
    const sent = this.send({ type: 'mikan:action', action })
    if (!sent) {
      this.pendingAction = false
      return false
    }

    // 相手からの応答が来ない場合の保険
    setTimeout(() => {
      if (this.pendingAction) {
        this.pendingAction = false
        this.onGame(this.gameState, this.localSide)
      }
    }, 5000)
    return true
  }

  broadcastState() {
    if (!this.gameState) return
    this.send({ type: 'mikan:state', state: packMatchState(this.gameState) })
  }

  canAct() {
    if (!this.gameState || this.gameState.finished || this.pendingAction) return false
    return currentTurnSide(this.gameState) === this.localSide
  }

  leave() {
    this.clearConnectTimer()
    try {
      this.game?.destroy()
      this.client?.disconnect()
    } catch {
      // 切断失敗は無視する
    }
    this.client = null
    this.game = null
    this.connected = false
    this.connecting = false
    this.room = null
    this.players = []
    this.gameState = null
  }
}
