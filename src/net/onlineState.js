import { makePitch } from '../game/liveGame.js'

/**
 * Flaxia マルチプレイで送る試合状態の圧縮・復元。
 *
 * 64KB のメッセージ上限に収めるため、チーム情報は開始時に別送し、
 * ログと打席履歴は直近だけを送る。
 */

const MAX_LOG = 40
const MAX_PLAYS = 120

export function packMatchState(state) {
  const { teams: _teams, ...rest } = state

  return {
    ...rest,
    teams: undefined,
    log: rest.log.slice(-MAX_LOG),
    plays: rest.plays.slice(-MAX_PLAYS),
    runners: rest.runners.map((runner) => (runner ? { id: runner.id, name: runner.name } : null)),
    currentPitch: rest.currentPitch
      ? {
          typeId: rest.currentPitch.type.id,
          courseId: rest.currentPitch.course.id,
        }
      : null,
    lastPitch: rest.lastPitch ? { ...rest.lastPitch } : null,
  }
}

export function unpackMatchState(packed, teams) {
  return {
    ...packed,
    teams,
    log: [...(packed.log ?? [])],
    plays: [...(packed.plays ?? [])],
    runners: (packed.runners ?? [null, null, null]).map((runner) => runner ?? null),
    currentPitch: packed.currentPitch
      ? makePitch(packed.currentPitch.typeId, packed.currentPitch.courseId)
      : null,
  }
}

export function packedStateSize(state) {
  return JSON.stringify(packMatchState(state)).length
}
