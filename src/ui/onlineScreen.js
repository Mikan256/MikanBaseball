import { escapeHtml } from './teamScreen.js'

function playerList(players) {
  if (!players.length) return '<li class="muted">まだ誰もいません</li>'
  return players
    .map(
      (player) => `<li>
        <span class="badge">${player.isHost ? 'ホスト' : 'ゲスト'}</span>
        ${escapeHtml(player.displayName || player.username || 'プレイヤー')}
      </li>`,
    )
    .join('')
}

/** Flaxiaマルチプレイのロビー */
export function renderOnlineScreen({ online, localTeam, message = '' }) {
  const snapshot = online.snapshot()
  const connected = snapshot.connected

  return `
  <div class="online-screen">
    <header class="screen-header">
      <h1>オンライン対戦</h1>
      <p class="muted">Flaxia ArcadeのマルチプレイAPIで 1 対 1 対戦します。</p>
    </header>

    ${message ? `<p class="notice" data-testid="notice">${escapeHtml(message)}</p>` : ''}
    ${snapshot.error ? `<p class="notice" data-testid="online-error">${escapeHtml(snapshot.error)}</p>` : ''}
    ${!snapshot.available ? `<p class="notice" data-testid="online-unavailable">オンライン対戦はFlaxia Arcade内で起動したときだけ利用できます。ローカルでは1人プレイ／2人プレイで遊んでください。</p>` : ''}

    <section class="panel online-panel">
      <h2>ルーム</h2>
      ${
        connected
          ? `
        <div class="room-row">
          <div>
            <span class="muted small">ルームID</span>
            <strong data-testid="online-room-code">${escapeHtml(snapshot.roomId ?? '取得中...')}</strong>
          </div>
          <button data-action="online-copy-room" data-testid="online-copy-room"${snapshot.roomId ? '' : ' disabled'}>IDをコピー</button>
        </div>
        <p class="muted small">相手にこのルームIDを伝えて「ルームIDで参加」してもらってください。</p>
        <h3>参加者 <span class="muted small" data-testid="online-player-count">${snapshot.players.length}/2</span></h3>
        <ul class="online-players" data-testid="online-players">${playerList(snapshot.players)}</ul>
      `
          : `
        <p class="muted">ルームを作るか、相手から教えてもらったルームIDで参加してください。</p>
        <div class="online-join-row">
          <input type="text" data-testid="online-room-input" placeholder="ルームID" autocomplete="off" />
          <button class="primary" data-action="online-create" data-testid="online-create"${snapshot.available ? '' : ' disabled'}>ルームを作る</button>
          <button data-action="online-join" data-testid="online-join"${snapshot.available ? '' : ' disabled'}>ルームIDで参加</button>
        </div>
      `
      }
      <p class="muted small" data-testid="online-status">${escapeHtml(snapshot.status || '未接続')}</p>
    </section>

    <section class="panel">
      <h2>あなたのチーム</h2>
      <p><span class="badge">${escapeHtml(localTeam.name)}</span></p>
      <p class="muted small">このチームで対戦します。ホストがホーム、参加した側がアウェイになります。</p>

      <div class="online-ready-row">
        <button data-action="online-ready" data-testid="online-ready"${connected && !snapshot.localReady ? '' : ' disabled'}>
          ${snapshot.localReady ? '準備完了' : '準備完了にする'}
        </button>
        <button class="primary" data-action="online-start" data-testid="online-start"${snapshot.canStart ? '' : ' disabled'}>試合開始</button>
      </div>
      <p class="muted small" data-testid="online-ready-status">
        自分: ${snapshot.localReady ? '準備OK' : '未準備'} /
        相手: ${snapshot.remoteReady ? '準備OK' : '待機中'}
      </p>
    </section>

    <footer class="actions">
      <button data-action="online-back" data-testid="online-back">編成に戻る</button>
    </footer>
  </div>`
}
