/** シード付き乱数（mulberry32）。状態は32bit整数ひとつで、reducer に保存できる。 */
export class Rng {
  constructor(public state: number) {}

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) の整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** [min, max] の整数 */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** 重み付き選択。インデックスを返す */
  weighted(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

export const randomSeed = (): number => (Math.random() * 0x100000000) | 0;

