import { expect, test } from '@playwright/test'

const FAKE_SDK = `
(function(){
  class FakeClient {
    constructor(opts){
      this.opts = opts
      this.isConnected = false
      this.currentRoomId = null
      this.handlers = {}
    }
    on(name, fn){ this.handlers[name] = fn }
    connect(roomId){
      this.isConnected = true
      this.currentRoomId = roomId || 'TEST-ROOM-1'
      setTimeout(() => this.handlers.onRoomState?.({
        room: {
          roomId: this.currentRoomId,
          gameId: this.opts.gameId,
          hostId: 'me',
          status: 'lobby',
          maxPlayers: 2,
          isPublic: true,
          createdAt: Date.now()
        },
        players: [{
          userId: 'me',
          username: 'Mikan',
          displayName: 'Mikan',
          isReady: false,
          isHost: true
        }]
      }), 0)
    }
    disconnect(){ this.isConnected = false }
    setReady(ready){ this.ready = ready }
    sendPeerData(data){ window.__lastPeerData = data }
    startGame(){}
  }
  class FakeGame {
    constructor(opts){
      this.gameId = opts.gameId
      this.multiplayer = new FakeClient(opts)
    }
    destroy(){ this.multiplayer.disconnect() }
  }
  window.FlaxiaGame = { FlaxiaGame: FakeGame, MultiplayerClient: FakeClient }
})();
`

test('Flaxia SDKの/sdk/game.jsを読み込み、ルームを作成できる', async ({ page }) => {
  await page.route('**/sdk/game.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }),
  )

  await page.setContent(
    '<iframe id="game" src="http://127.0.0.1:4173/" style="width:1000px;height:800px;border:0"></iframe>',
  )
  const frame = page.frameLocator('#game')

  await frame.getByTestId('start').click()
  await frame.getByTestId('mode-online').click()
  await expect(frame.getByTestId('online-create')).toBeEnabled()

  await frame.getByTestId('online-create').click()
  await expect(frame.getByTestId('online-room-code')).toHaveText('TEST-ROOM-1')
  await expect(frame.getByTestId('online-status')).toContainText('1/2')
})
