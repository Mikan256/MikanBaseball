/**
 * 決定論的な疑似乱数生成器 (mulberry32)。
 *
 * シードを固定すれば同じプレー列が常に再現されるため、
 * ユニットテストで結果の揺らぎを排除できる。
 */
export function createRng(seed = 1) {
  let state = seed >>> 0

  /** [0, 1) の値を返す */
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    /** 0 以上 max 未満の整数 */
    int(max) {
      return Math.floor(next() * max)
    },
    /** 確率 p で true を返す */
    chance(p) {
      return next() < p
    },
    /** 配列からランダムに 1 つ選ぶ */
    pick(items) {
      return items[Math.floor(next() * items.length)]
    },
    /** 累積重み表から 1 つ選ぶ（weightOf で重みを引く） */
    weighted(items, weightOf) {
      const total = items.reduce((sum, item) => sum + weightOf(item), 0)
      let threshold = next() * total
      for (const item of items) {
        threshold -= weightOf(item)
        if (threshold < 0) return item
      }
      return items[items.length - 1]
    },
  }
}

/** テスト・デバッグ用: ゲーム状態から同じシードを作る */
export function rngFromState(state) {
  return createRng(state.rngSeed)
}
