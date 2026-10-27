# 雀闘：改

麻雀の牌・セット作りとローグライトRPG（8連戦・レベルアップ・装備・バフ効果・チェーン）を融合したブラウザゲーム。

## 起動

```sh
npm install
npm run dev      # 開発サーバ
npm test         # 単体テスト
npm run build    # dist/ に静的ファイルを出力
```

## 構成

| パス | 役割 |
|---|---|
| `src/core/tile.ts` | 全34種136枚の牌定義、基礎攻撃力、特殊牌（金牌・赤牌・虹牌） |
| `src/core/mentsu.ts` | 任意枚数のセット・ペア・単牌分解、カン・リーチ・マリガン判定 |
| `src/core/yaku.ts` | 1〜3セット役・四対子・装備解禁役の判定と効果定義 |
| `src/core/score.ts` | 新ダメージ計算式（牌攻撃力＋セットボーナス×レベル×役倍率×金牌倍率） |
| `src/core/battle.ts` | 8連戦・レベル/EXP・装備・特殊行動・敵スキルの状態遷移 `step(state, action)` |
| `src/core/monster.ts` | 敵の技抽選（通常攻撃・基本技・強力な技・ボス技） |
| `src/data/equipments.ts` | 全29種の装備データ（コモン・アンコモン・レア・レジェンド） |
| `src/data/monsters.ts` | 8連戦のモンスター・敵技定義 |
| `src/ui/` | 描画と CSS |
