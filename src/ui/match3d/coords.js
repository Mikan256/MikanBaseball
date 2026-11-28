/**
 * ゲーム座標 (x, y, z) と three.js 座標の変換。
 * ゲーム: x = 左右（+ が右翼方向）, y = ホームからの奥行き, z = 高さ
 * three.js: Y が上なので (x, z, -y) に写す。
 */

/** ゲーム座標を three.js 座標のプレーンオブジェクトへ変換する */
export function toThree(x, y, z) {
  return { x, y: z, z: -y }
}

/** THREE.Vector3 互換オブジェクトをゲーム座標で上書きする */
export function setFromGame(vector3, x, y, z) {
  return vector3.set(x, z, -y)
}
