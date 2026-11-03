import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { newBattle, calculateScore } from '../src/core/battle';
import { evaluateVeteranTitle } from '../src/core/titles';
import { MONSTERS } from '../src/data/monsters';
import type { D1Database, D1PreparedStatement } from '../src/server/db';
import { app } from '../src/server/index';

function createInMemoryD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(query: string): D1PreparedStatement {
      let boundValues: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          boundValues = values.map((v) => (v === undefined ? null : v));
          return stmt;
        },
        async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
          const prepared = sqlite.prepare(query);
          const row = prepared.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
          if (!row) return null;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          const prepared = sqlite.prepare(query);
          const rows = prepared.all(...(boundValues as never[])) as T[];
          return { results: rows ?? [] };
        },
        async run(): Promise<{ success: boolean }> {
          const prepared = sqlite.prepare(query);
          prepared.run(...(boundValues as never[]));
          return { success: true };
        },
      };
      return stmt;
    },
    async exec(query: string): Promise<unknown> {
      sqlite.exec(query);
      return { ok: true };
    },
  };
}

async function reqJson<T = Record<string, unknown>>(
  db: D1Database,
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { DB: db },
  );
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe('Cloudflare D1 Account, Autosave, Rankings, Veterans & Admin API', () => {
  it('1. Admin user (d-mukai / 6k1dJAN@30) is automatically provisioned and can log in', async () => {
    const db = createInMemoryD1();
    const loginRes = await reqJson<{
      authenticated: boolean;
      token: string;
      user: { loginId: string; role: string };
    }>(db, '/api/auth/login', 'POST', {
      loginId: 'd-mukai',
      password: '6k1dJAN@30',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.data.authenticated).toBe(true);
    expect(loginRes.data.user.loginId).toBe('d-mukai');
    expect(loginRes.data.user.role).toBe('admin');
  });

  it('2. User registration, 20-char comment limit, profile update, and birthday password reset work', async () => {
    const db = createInMemoryD1();

    // 21文字のコメントは拒否される
    const badReg = await reqJson<{ error: string }>(db, '/api/auth/register', 'POST', {
      loginId: 'player01',
      password: 'password123',
      birthDate: '1998-05-15',
      nickname: '雀士イチロー',
      comment: 'あいうえおかきくけこさしすせそたちつてとな', // 21文字
    });
    expect(badReg.status).toBe(400);

    // 20文字以内の正常登録
    const regRes = await reqJson<{
      authenticated: boolean;
      token: string;
      user: { id: string; loginId: string; nickname: string; comment: string };
    }>(db, '/api/auth/register', 'POST', {
      loginId: 'player01',
      password: 'password123',
      birthDate: '1998-05-15',
      nickname: '雀士イチロー',
      avatarData: 'data:image/webp;base64,UklGRg==',
      comment: '一撃必殺を狙います！よろしく！',
    });
    expect(regRes.status).toBe(200);
    expect(regRes.data.user.nickname).toBe('雀士イチロー');

    // 誤った生年月日ではパスワードリセット失敗
    const wrongReset = await reqJson(db, '/api/auth/reset-password', 'POST', {
      loginId: 'player01',
      birthDate: '1999-12-31',
      newPassword: 'newpassword999',
    });
    expect(wrongReset.status).toBe(401);

    // 正しい生年月日でパスワードリセット成功＆新パスワードでログイン可能
    const okReset = await reqJson<{ authenticated: boolean; token: string }>(
      db,
      '/api/auth/reset-password',
      'POST',
      {
        loginId: 'player01',
        birthDate: '1998-05-15',
        newPassword: 'newpassword999',
      },
    );
    expect(okReset.status).toBe(200);
    expect(okReset.data.authenticated).toBe(true);

    const loginNew = await reqJson<{ authenticated: boolean }>(db, '/api/auth/login', 'POST', {
      loginId: 'player01',
      password: 'newpassword999',
    });
    expect(loginNew.status).toBe(200);
    expect(loginNew.data.authenticated).toBe(true);
  });

  it('3. Autosave, play history, score TOP3, and Veterans (10 slots + mark lock + titles) work', async () => {
    const db = createInMemoryD1();
    const reg = await reqJson<{ token: string }>(db, '/api/auth/register', 'POST', {
      loginId: 'hero01',
      password: 'password123',
      birthDate: '2001-09-01',
      nickname: 'ヒロ',
      comment: '全制覇目指す',
    });
    const token = reg.data.token;

    // プレイ開始記録
    await reqJson(db, '/api/game/record-play', 'POST', { jobId: 'sword', difficulty: 'advanced' }, token);

    // オートセーブ保存
    const bState = newBattle(MONSTERS[0], 12345, 'sword', 'advanced');
    bState.stage = 4;
    await reqJson(db, '/api/game/autosave', 'PUT', { state: bState }, token);

    const meRes = await reqJson<{ activeSave: { stage: number; jobId: string } }>(
      db,
      '/api/auth/me',
      'GET',
      undefined,
      token,
    );
    expect(meRes.data.activeSave.stage).toBe(4);
    expect(meRes.data.activeSave.jobId).toBe('sword');

    // クリア＆称号判定テスト
    bState.status = 'won';
    bState.stage = 10;
    bState.yakuHistory.push({
      id: 'daisangen',
      name: '大三元',
      tier: 3,
      dmgMult: 12,
      chains: 3,
      effectText: '',
    });
    const sc = calculateScore(bState);
    const titleEval = evaluateVeteranTitle(bState, sc);
    expect(titleEval.tier).toBe('S');
    expect(titleEval.titleName).toBe('三元天覇の剣聖');

    // リザルト記録（クリア数・装備コレクション・役成立数・スコア）
    await reqJson(
      db,
      '/api/game/record-result',
      'POST',
      {
        jobId: 'sword',
        difficulty: 'advanced',
        isWon: true,
        stagesCleared: 10,
        totalScore: sc.totalScore,
        breakdown: sc,
        equipments: ['hp_up_10', 'atk_man_2'],
        yakuIds: ['daisangen', 'riichi'],
      },
      token,
    );

    const rankRes = await reqJson<{
      personalTop3: { totalScore: number }[];
      globalTop3: { totalScore: number }[];
    }>(db, '/api/game/job-ranking/sword', 'GET', undefined, token);
    expect(rankRes.data.personalTop3.length).toBe(1);
    expect(rankRes.data.personalTop3[0].totalScore).toBe(sc.totalScore);
    expect(rankRes.data.globalTop3[0].totalScore).toBe(sc.totalScore);

    // 強者共保存（スロット0・保護マークON）
    const vetSave = await reqJson<{ veterans: { id: string; isMarked: boolean; titleName: string }[] }>(
      db,
      '/api/game/veterans',
      'POST',
      {
        slotIndex: 0,
        jobId: 'sword',
        difficulty: 'advanced',
        titleName: titleEval.titleName,
        maxHp: 550,
        bonusTileAtk: { m: 12, p: 4, s: 0, wind: 0, dragon: 15 },
        equipments: ['hp_up_10', 'atk_man_2'],
        totalScore: sc.totalScore,
        comment: '対人戦用の最強剣士',
        isMarked: true,
      },
      token,
    );
    expect(vetSave.status).toBe(200);
    expect(vetSave.data.veterans.length).toBe(1);
    const vetId = vetSave.data.veterans[0].id;

    // 保護マーク中のスロット0への上書きおよび削除はブロックされる
    const overwriteBlocked = await reqJson(
      db,
      '/api/game/veterans',
      'POST',
      {
        slotIndex: 0,
        jobId: 'doctor',
        difficulty: 'beginner',
        titleName: '試練を越えし仙医',
        maxHp: 300,
        bonusTileAtk: { m: 0, p: 0, s: 0, wind: 0, dragon: 0 },
        equipments: [],
        totalScore: 5000,
      },
      token,
    );
    expect(overwriteBlocked.status).toBe(409);

    const deleteBlocked = await reqJson(db, `/api/game/veterans/${vetId}`, 'DELETE', undefined, token);
    expect(deleteBlocked.status).toBe(409);

    // マーク解除＆コメント更新後は削除可能
    await reqJson(
      db,
      `/api/game/veterans/${vetId}`,
      'PATCH',
      { isMarked: false, comment: 'マーク解除済み' },
      token,
    );
    const deleteOk = await reqJson<{ veterans: unknown[] }>(
      db,
      `/api/game/veterans/${vetId}`,
      'DELETE',
      undefined,
      token,
    );
    expect(deleteOk.status).toBe(200);
    expect(deleteOk.data.veterans.length).toBe(0);
  });

  it('4. Admin user (d-mukai) can manage users and cannot delete itself', async () => {
    const db = createInMemoryD1();
    await reqJson(db, '/api/auth/register', 'POST', {
      loginId: 'testuser',
      password: 'password123',
      birthDate: '2000-01-01',
      nickname: 'テスト太郎',
    });

    const adminLogin = await reqJson<{ token: string; user: { id: string } }>(
      db,
      '/api/auth/login',
      'POST',
      {
        loginId: 'd-mukai',
        password: '6k1dJAN@30',
      },
    );
    const adminToken = adminLogin.data.token;

    const listRes = await reqJson<{ users: { id: string; loginId: string }[] }>(
      db,
      '/api/admin/users',
      'GET',
      undefined,
      adminToken,
    );
    expect(listRes.status).toBe(200);
    expect(listRes.data.users.length).toBe(2);

    // Admin自身の削除は拒否される
    const selfDel = await reqJson(
      db,
      `/api/admin/users/${adminLogin.data.user.id}`,
      'DELETE',
      undefined,
      adminToken,
    );
    expect(selfDel.status).toBe(400);
  });
});

