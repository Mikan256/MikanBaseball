/** 初期チームデータ。プレイヤーはここを編集して自分だけの球隊を作れる。 */

export const TEAMS = {
  home: {
    name: 'マンダリンタイガース',
    color: '#f5a524',
    logo: '🐯',
    lineup: [
      { name: '柴田 一郎', number: 1, power: 0.52 },
      { name: '鈴木 二郎', number: 2, power: 0.48 },
      { name: '高橋 三郎', number: 3, power: 0.61 },
      { name: '田中 四郎', number: 4, power: 0.55 },
      { name: '伊藤 五郎', number: 5, power: 0.44 },
    ],
  },
  away: {
    name: 'オーシャンホークス',
    color: '#4a90d9',
    logo: '🦅',
    lineup: [
      { name: '佐藤 六郎', number: 1, power: 0.5 },
      { name: '山本 七郎', number: 2, power: 0.57 },
      { name: '中村 八郎', number: 3, power: 0.53 },
      { name: '小林 九郎', number: 4, power: 0.46 },
      { name: '加藤 十郎', number: 5, power: 0.6 },
    ],
  },
}
