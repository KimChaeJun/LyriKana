import { TrainingExample } from "./types";

export interface DedupeResult<T> {
  items: T[];
  removedCount: number;
}

function createTrainingExampleKey(example: TrainingExample): string {
  return [example.task, example.input, example.output].join("\u0000");
}

export function dedupeTrainingExamples(
  examples: TrainingExample[]
): DedupeResult<TrainingExample> {
  const seen = new Set<string>();
  const items: TrainingExample[] = [];

  for (const example of examples) {
    const key = createTrainingExampleKey(example);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(example);
  }

  return {
    items,
    removedCount: examples.length - items.length,
  };
}
