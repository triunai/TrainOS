import { createHash } from "node:crypto";

/**
 * Identity attempts on the session-QR page (name + last 4 IC characters),
 * limited IN MEMORY, PER PROCESS: a restart forgets, and two app instances
 * each keep their own count. Good enough to stop a phone brute-forcing 4
 * digits in the 20 minutes a room QR lives; a shared store (Postgres or
 * Redis) is the upgrade if the cockpit ever runs as several instances.
 *
 * Only FAILED attempts count, under two keys:
 *   token + IP + chosen name   5 per 10 minutes — the actual attack is guessing
 *                              one person's digits;
 *   token + IP                 25 per 10 minutes — a backstop against sweeping
 *                              the roster. Not 5: a training room shares one
 *                              public IP behind the venue Wi-Fi, and five typos
 *                              across twenty people must not lock the room out.
 */
export const WINDOW_MS = 10 * 60_000;
export const MAX_PER_PERSON = 5;
export const MAX_PER_DEVICE = 25;
const MAX_KEYS = 10_000;

const failures = new Map<string, number[]>();

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

function keysFor(token: string, ip: string, participantId: string): Array<{ key: string; max: number }> {
  const device = digest(`${token}|${ip}`);
  return [
    { key: `p:${device}:${participantId}`, max: MAX_PER_PERSON },
    { key: `d:${device}`, max: MAX_PER_DEVICE },
  ];
}

function live(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

/** Null when allowed; otherwise how long until the oldest counted failure ages out. */
export function blockedFor(token: string, ip: string, participantId: string, now = Date.now()): number | null {
  let wait: number | null = null;
  for (const { key, max } of keysFor(token, ip, participantId)) {
    const list = live(key, now);
    if (list.length >= max) wait = Math.max(wait ?? 0, WINDOW_MS - (now - list[list.length - max]));
  }
  return wait;
}

export function recordFailure(token: string, ip: string, participantId: string, now = Date.now()): void {
  if (failures.size > MAX_KEYS) for (const key of [...failures.keys()]) live(key, now);
  for (const { key } of keysFor(token, ip, participantId)) failures.set(key, [...live(key, now), now]);
}
