/** 試合のルール上の定数 */

/** 規定回 */
export const INNINGS = 9

/** 延長戦を含めた最大回 */
export const MAX_INNINGS = 12

/** 1 表 / 1 裏が 3 OUT で終了する */
export const OUTS_PER_HALF_INNING = 3

/** 塁は 3 つ。ホームランは「4 塁進む」として扱う */
export const BASE_COUNT = 3

/** 四球になるまでの球数 */
export const BALLS_FOR_WALK = 4

/** 三振になるまでの球数 */
export const STRIKES_FOR_OUT = 3

export const BASE_LABELS = ['一塁', '二塁', '三塁']
