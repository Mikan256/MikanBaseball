import { describe, expect, it } from 'vitest'
import { OnlineMatch } from '../../src/net/flaxiaMultiplayer.js'
import { currentTurnSide } from '../../src/game/liveGame.js'
import { randomTeam } from '../../src/data/rosterFactory.js'

class FakeClient {
  constructor() {
    this.handlers = {}
    this.isConnected = true
    this.currentRoomId = 'test-room'
    this.peer = null
    this.sent = []
  }

  connect() {
    this.isConnected = true
  }

  disconnect() {
    this.isConnected = false
  }

  on(event, handler) {
    this.handlers[event] = handler
  }

  emit(event, payload) {
    this.handlers[event]?.(payload)
  }

  sendPeerData(data) {
    this.sent.push(data)
    if (this.peer) this.peer.emit('onPeerData', { data: JSON.parse(JSON.stringify(data)) })
  }

  setReady() {}

  startGame() {}
}

function makeOnline(isHost) {
  const online = new OnlineMatch()
  const client = new FakeClient()
  online.client = client
  online.connected = true
  online.isHost = isHost
  online.localSide = isHost ? 'home' : 'away'
  online.bindEvents()
  return { online, client }
}

describe('オンライン対戦のホスト権威フロー', () => {
  it('チーム交換、試合開始、双方の操作が同期する', () => {
    const hostTeam = randomTeam({ name: 'ホスト球団', seed: 301 })
    const guestTeam = randomTeam({ name: 'ゲスト球団', seed: 302 })

    const host = makeOnline(true)
    const guest = makeOnline(false)
    host.client.peer = guest.client
    guest.client.peer = host.client

    expect(host.online.ready(hostTeam)).toBe(true)
    expect(guest.online.ready(guestTeam)).toBe(true)

    expect(host.online.remoteTeam.name).toBe('ゲスト球団')
    expect(guest.online.remoteTeam.name).toBe('ホスト球団')
    expect(host.online.snapshot().canStart).toBe(true)

    expect(host.online.startMatch()).toBe(true)

    expect(host.online.gameState.teams.home.name).toBe('ホスト球団')
    expect(host.online.gameState.teams.away.name).toBe('ゲスト球団')
    expect(guest.online.gameState.teams.home.name).toBe('ホスト球団')
    expect(guest.online.gameState.teams.away.name).toBe('ゲスト球団')

    expect(host.online.canAct()).toBe(true)
    expect(guest.online.canAct()).toBe(false)
    expect(currentTurnSide(host.online.gameState)).toBe('home')

    // ホストが投球 → ゲストが打席
    expect(
      host.online.submitAction({
        kind: 'pitch',
        selection: { typeId: 'straight', courseId: 'middle-center', releaseQuality: 0.8 },
      }),
    ).toBe(true)

    expect(host.online.gameState.phase).toBe('bat')
    expect(guest.online.gameState.phase).toBe('bat')
    expect(guest.online.gameState.currentPitch.type.id).toBe('straight')
    expect(host.online.canAct()).toBe(false)
    expect(guest.online.canAct()).toBe(true)

    // ゲストが打撃 → ホストへ送られ、1球が確定する
    expect(
      guest.online.submitAction({
        kind: 'bat',
        swing: 'contact',
        timingQuality: 0.7,
        cursorMatch: true,
      }),
    ).toBe(true)

    expect(host.online.gameState.log).toHaveLength(1)
    expect(guest.online.gameState.log).toHaveLength(1)
    expect(host.online.gameState.phase).toBe('pitch')
    expect(guest.online.gameState.phase).toBe('pitch')
    expect(host.online.canAct()).toBe(true)
    expect(guest.online.canAct()).toBe(false)
  })
})
