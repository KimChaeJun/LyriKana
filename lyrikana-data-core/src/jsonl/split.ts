export interface SplitOptions {
  validationRatio?: number;
}

export interface SplitResult<T> {
  train: T[];
  validation: T[];
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function splitByStableId<T>(
  items: T[],
  getId: (item: T) => string,
  options: SplitOptions = {}
): SplitResult<T> {
  const validationRatio = options.validationRatio ?? 0.1;
  const validationThreshold = Math.round(validationRatio * 10000);

  return items.reduce<SplitResult<T>>(
    (result, item) => {
      const bucket = hashString(getId(item)) % 10000;

      if (bucket < validationThreshold) {
        result.validation.push(item);
      } else {
        result.train.push(item);
      }

      return result;
    },
    { train: [], validation: [] }
  );
}
