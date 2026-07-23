// Thin typed helpers over D1.
import type { Env } from '../types';

export async function one<T = any>(env: Env, sql: string, ...binds: any[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...binds).first<T>()) as any;
}
export async function many<T = any>(env: Env, sql: string, ...binds: any[]): Promise<T[]> {
  const r = await env.DB.prepare(sql).bind(...binds).all<T>();
  return ((r as any).results || []) as T[];
}
export async function run(env: Env, sql: string, ...binds: any[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}
export async function count(env: Env, sql: string, ...binds: any[]): Promise<number> {
  const row = await one<{ n: number }>(env, sql, ...binds);
  return row?.n ?? 0;
}
