import { DomainError } from "../domain/errors";

/**
 * Track A signature paths: the check-in page captures a finger/stylus
 * signature as SVG path data (`M x y L x y ...`). We store the path, render
 * it into the digital Form T3, and refuse the two failure shapes a zero-auth
 * public endpoint invites: an oversized payload, and a tap that is not a
 * signature. The same analysis gives the bounding box the PDF renderer
 * needs to fit the path into a cell.
 */
export const SIGNATURE_MAX_BYTES = 20 * 1024;
export const SIGNATURE_MIN_POINTS = 6;
export const SIGNATURE_MIN_EXTENT = 12;
export const SIGNATURE_MIN_LENGTH = 40;

const ALLOWED = /^[MmLlHhVvCcSsQqTtAaZz0-9eE\s,.+-]+$/;
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export interface SignatureAnalysis {
  points: number;
  length: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

/**
 * Walks the path with absolute coordinates. `points` counts every coordinate
 * pair, control points included (a curve is more stroke than a line). Curves
 * contribute their control points to the bounding box (a safe over-estimate)
 * and their chord to the length (an under-estimate, which is the
 * conservative side for the "non-trivial" test).
 */
export function analyseSignaturePath(path: string): SignatureAnalysis {
  if (!ALLOWED.test(path)) throw new DomainError("SIGNATURE_INVALID", "The signature is not SVG path data");
  const tokens = path.match(TOKEN) ?? [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let points = 0;
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const touch = (px: number, py: number) => {
    points += 1;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const moveTo = (nx: number, ny: number, draw: boolean) => {
    if (draw) length += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    touch(x, y);
  };

  let i = 0;
  let command = "";
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      i += 1;
      if (command === "Z" || command === "z") {
        moveTo(startX, startY, true);
        continue;
      }
    } else if (!command) {
      throw new DomainError("SIGNATURE_INVALID", "Signature path must start with a command");
    }
    const upper = command.toUpperCase();
    const arity = ARITY[upper];
    if (arity === undefined || arity === 0) throw new DomainError("SIGNATURE_INVALID", `Unexpected token ${token}`);
    const args = tokens.slice(i, i + arity).map(Number);
    if (args.length < arity || args.some((n) => !Number.isFinite(n))) {
      throw new DomainError("SIGNATURE_INVALID", "Signature path is truncated");
    }
    i += arity;
    const rel = command !== upper;
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (upper) {
      case "M":
        moveTo(ox + args[0], oy + args[1], false);
        startX = x;
        startY = y;
        command = rel ? "l" : "L"; // implicit lineto after the first pair
        break;
      case "L":
      case "T":
        moveTo(ox + args[0], oy + args[1], true);
        break;
      case "H":
        moveTo(ox + args[0], y, true);
        break;
      case "V":
        moveTo(x, oy + args[0], true);
        break;
      case "C":
        touch(ox + args[0], oy + args[1]);
        touch(ox + args[2], oy + args[3]);
        moveTo(ox + args[4], oy + args[5], true);
        break;
      case "S":
      case "Q":
        touch(ox + args[0], oy + args[1]);
        moveTo(ox + args[2], oy + args[3], true);
        break;
      case "A":
        moveTo(ox + args[5], oy + args[6], true);
        break;
      default:
        throw new DomainError("SIGNATURE_INVALID", `Unsupported path command ${command}`);
    }
  }
  if (points === 0) throw new DomainError("SIGNATURE_INVALID", "The signature is empty");
  return {
    points,
    length,
    bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

/** Refuses an oversized or trivial signature; returns the analysis otherwise. */
export function validateSignaturePath(path: unknown): SignatureAnalysis {
  if (typeof path !== "string" || path.trim() === "") {
    throw new DomainError("SIGNATURE_INVALID", "A signature is required");
  }
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes > SIGNATURE_MAX_BYTES) {
    throw new DomainError("SIGNATURE_INVALID", `The signature is too large (${bytes} bytes; limit ${SIGNATURE_MAX_BYTES})`);
  }
  const analysis = analyseSignaturePath(path);
  const extent = Math.max(analysis.bbox.width, analysis.bbox.height);
  if (analysis.points < SIGNATURE_MIN_POINTS || extent < SIGNATURE_MIN_EXTENT || analysis.length < SIGNATURE_MIN_LENGTH) {
    throw new DomainError("SIGNATURE_INVALID", "Please sign with a full signature, not a dot or a short line", {
      points: analysis.points,
      extent: Math.round(extent),
      length: Math.round(analysis.length),
    });
  }
  return analysis;
}
