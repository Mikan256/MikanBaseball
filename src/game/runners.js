import { BASE_COUNT } from './constants.js'

/**
 * 走者を bases 塁進める純粋関数。
 * 本塁を超えた走者の人数を scored として返す。
 *
 * 走者全員が同じだけ進む単純モデル。盗塁や犠牲フライは考慮しない。
 * 打者は含まれないので、安打のときは戻り値の 1 塁に打者を置く。
 */
export function advanceRunners(runners, bases) {
  const next = [null, null, null]
  let scored = 0

  for (let index = 0; index < BASE_COUNT; index += 1) {
    const runner = runners[index]
    if (!runner) continue
    const destination = index + 1 + bases
    if (destination > BASE_COUNT) scored += 1
    else next[destination - 1] = runner
  }

  return { runners: next, scored }
}

/**
 * 四球のときの進塁。押し出しのときだけ走者が進む。
 * 1 塁が空いていれば打者だけが 1 塁へ入り、他の走者は動かない。
 */
export function advanceOnWalk(runners) {
  const next = [...runners]
  let scored = 0

  if (next[0]) {
    if (next[1]) {
      if (next[2]) {
        scored += 1
      }
      next[2] = next[1]
    }
    next[1] = next[0]
  }
  next[0] = null

  return { runners: next, scored }
}
