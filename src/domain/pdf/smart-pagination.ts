export type CutKind =
  | "explicit"
  | "heading"
  | "visual"
  | "block"
  | "table"
  | "fallback";

export interface PaginationCandidate {
  y: number;
  kind: CutKind;
  weight: number;
  label: string;
}

export interface ProtectedRange {
  top: number;
  bottom: number;
  label: string;
}

export interface PaginationHints {
  candidates: PaginationCandidate[];
  protectedRanges: ProtectedRange[];
  explicitRanges: ProtectedRange[];
  hardExplicitPagination: boolean;
}

export interface PaginationPlan {
  cuts: number[];
  warnings: string[];
  strategy: "explicit-pages" | "semantic";
}

function crossingRanges(
  ranges: ProtectedRange[],
  y: number
): ProtectedRange[] {
  return ranges.filter((range) => y > range.top + 1 && y < range.bottom - 1);
}

export function planSmartCuts(
  documentHeight: number,
  hints: PaginationHints,
  targetPageHeight: number
): PaginationPlan {
  const explicit = hints.explicitRanges
    .filter((range) => range.bottom > range.top + 2)
    .sort((a, b) => a.top - b.top);
  if (hints.hardExplicitPagination && explicit.length >= 2) {
    const cuts = [0];
    for (const range of explicit.slice(0, -1)) {
      if (range.bottom > cuts.at(-1)! + 2 && range.bottom < documentHeight - 1) {
        cuts.push(range.bottom);
      }
    }
    cuts.push(documentHeight);
    return { cuts, warnings: [], strategy: "explicit-pages" };
  }

  const candidates = hints.candidates
    .filter((candidate) => candidate.y > 1 && candidate.y < documentHeight - 1)
    .sort((a, b) => a.y - b.y);
  const protectedRanges = hints.protectedRanges
    .filter((range) => range.bottom > range.top + 2);
  const cuts = [0];
  const warnings: string[] = [];

  for (let guard = 0; cuts.at(-1)! < documentHeight - 1; guard += 1) {
    if (guard > 10_000) throw new Error("Smart pagination did not converge");
    const start = cuts.at(-1)!;
    const remaining = documentHeight - start;
    if (remaining <= targetPageHeight * 1.04) break;
    const target = start + targetPageHeight;
    const minimum = start + Math.max(180, targetPageHeight * 0.42);
    const maximum = Math.min(
      documentHeight - 2,
      start + targetPageHeight * 1.35
    );
    const choices = candidates
      .filter((candidate) =>
        candidate.y >= minimum
        && candidate.y <= maximum
        && documentHeight - candidate.y > 40
      )
      .map((candidate) => {
        const crossings = crossingRanges(protectedRanges, candidate.y);
        const distance = Math.abs(candidate.y - target) / targetPageHeight;
        const overshoot = Math.max(0, candidate.y - target) / targetPageHeight;
        return {
          ...candidate,
          crossings,
          score:
            candidate.weight
            - distance * 720
            - overshoot * 180
            - crossings.length * 1600
        };
      })
      .sort((a, b) =>
        a.crossings.length - b.crossings.length
        || b.score - a.score
        || Math.abs(a.y - target) - Math.abs(b.y - target)
      );

    let selected = choices[0];
    if (!selected) {
      const crossing = crossingRanges(protectedRanges, target)
        .sort((a, b) => b.bottom - a.bottom)[0];
      if (
        crossing
        && crossing.top - start >= Math.max(120, targetPageHeight * 0.28)
      ) {
        selected = {
          y: crossing.top,
          kind: "fallback",
          weight: 0,
          label: `Avoid ${crossing.label}`,
          crossings: [],
          score: 0
        };
      } else if (
        crossing
        && crossing.bottom > target
        && crossing.bottom < documentHeight - 1
      ) {
        selected = {
          y: crossing.bottom,
          kind: "fallback",
          weight: 0,
          label: `Keep ${crossing.label} intact`,
          crossings: [],
          score: 0
        };
        warnings.push(
          `Page ${cuts.length} contains an over-height ${crossing.label}.`
        );
      } else {
        selected = {
          y: target,
          kind: "fallback",
          weight: 0,
          label: "Target page height",
          crossings: [],
          score: 0
        };
        warnings.push(
          `Page ${cuts.length} used a height-based fallback cut.`
        );
      }
    }
    if (selected.crossings.length > 0) {
      warnings.push(
        `Page ${cuts.length} could not avoid every protected content block.`
      );
    }
    const y = Math.min(documentHeight, Math.max(start + 2, selected.y));
    if (y >= documentHeight - 1) break;
    cuts.push(y);
  }

  const tailHeight = documentHeight - cuts.at(-1)!;
  if (
    cuts.length > 1
    && tailHeight < Math.min(180, targetPageHeight * 0.2)
  ) {
    cuts.pop();
  }
  cuts.push(documentHeight);
  return {
    cuts,
    warnings: [...new Set(warnings)],
    strategy: "semantic"
  };
}
