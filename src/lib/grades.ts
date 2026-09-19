import type { Report } from "./types";

export const GRADE_STYLE: Record<Report["grade"], string> = {
  A: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  B: "bg-lime-500/15 text-lime-300 border-lime-500/40",
  C: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  D: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  F: "bg-red-500/15 text-red-300 border-red-500/40",
};

export const GRADE_LABEL: Record<Report["grade"], string> = {
  A: "Rock solid",
  B: "Mostly stable",
  C: "Some creep",
  D: "Volatile",
  F: "Buyer beware",
};
