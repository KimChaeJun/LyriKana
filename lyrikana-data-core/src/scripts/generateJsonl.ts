import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCorrectionLogsJson } from "../correctionLogSchema";
import { correctionLogsToTrainingExamples } from "../jsonl/converters";
import { dedupeTrainingExamples } from "../jsonl/dedupe";
import { trainingExamplesToChatJsonl } from "../jsonl/exportJsonl";
import { splitByStableId } from "../jsonl/split";
import { validateCorrectionLogForTraining } from "../jsonl/validate";

interface GenerateJsonlOptions {
  inputPath: string;
  trainOutputPath: string;
  validationOutputPath: string;
  validationRatio: number;
  reportOutputPath: string;
}

interface RejectedLog {
  correctionId: string;
  reason: string;
}

interface GenerateJsonlReport {
  inputPath: string;
  trainOutputPath: string;
  validationOutputPath: string;
  totalLogs: number;
  acceptedLogs: number;
  rejectedLogs: RejectedLog[];
  duplicateExamplesRemoved: number;
  trainExamples: number;
  validationExamples: number;
  validationRatio: number;
}

function parseArgs(argv: string[]): GenerateJsonlOptions {
  const inputPath = argv[2] ?? "data/corrections.json";
  const trainOutputPath = argv[3] ?? "data/lyrikana-training.jsonl";
  const validationOutputPath = argv[4] ?? "data/lyrikana-validation.jsonl";
  const validationRatio = argv[5] ? Number(argv[5]) : 0.1;
  const reportOutputPath = argv[6] ?? "data/lyrikana-jsonl-report.json";

  if (!Number.isFinite(validationRatio) || validationRatio < 0 || validationRatio > 0.5) {
    throw new Error("Validation ratio must be a number between 0 and 0.5.");
  }

  return {
    inputPath: path.resolve(inputPath),
    trainOutputPath: path.resolve(trainOutputPath),
    validationOutputPath: path.resolve(validationOutputPath),
    validationRatio,
    reportOutputPath: path.resolve(reportOutputPath),
  };
}

function formatPathForReport(filePath: string): string {
  return path.relative(process.cwd(), filePath) || ".";
}

async function readCorrectionLogs(inputPath: string) {
  const raw = await readFile(inputPath, "utf8");
  return parseCorrectionLogsJson(raw);
}

async function main() {
  const {
    inputPath,
    trainOutputPath,
    validationOutputPath,
    validationRatio,
    reportOutputPath,
  } = parseArgs(process.argv);
  const logs = await readCorrectionLogs(inputPath);
  const rejectedLogs: RejectedLog[] = [];
  const validLogs = logs.filter((log) => {
    const validation = validateCorrectionLogForTraining(log);

    if (!validation.valid) {
      rejectedLogs.push({
        correctionId: log.id,
        reason: validation.reason ?? "unknown validation error",
      });
    }

    return validation.valid;
  });
  const examples = correctionLogsToTrainingExamples(validLogs);
  const dedupeResult = dedupeTrainingExamples(examples);
  const split = splitByStableId(
    dedupeResult.items,
    (example) => example.metadata.correctionId,
    { validationRatio }
  );

  const trainJsonl = trainingExamplesToChatJsonl(split.train);
  const validationJsonl = trainingExamplesToChatJsonl(split.validation);

  await mkdir(path.dirname(trainOutputPath), { recursive: true });
  await mkdir(path.dirname(validationOutputPath), { recursive: true });
  await mkdir(path.dirname(reportOutputPath), { recursive: true });
  await writeFile(trainOutputPath, trainJsonl ? `${trainJsonl}\n` : "", "utf8");
  await writeFile(
    validationOutputPath,
    validationJsonl ? `${validationJsonl}\n` : "",
    "utf8"
  );

  const report: GenerateJsonlReport = {
    inputPath: formatPathForReport(inputPath),
    trainOutputPath: formatPathForReport(trainOutputPath),
    validationOutputPath: formatPathForReport(validationOutputPath),
    totalLogs: logs.length,
    acceptedLogs: validLogs.length,
    rejectedLogs,
    duplicateExamplesRemoved: dedupeResult.removedCount,
    trainExamples: split.train.length,
    validationExamples: split.validation.length,
    validationRatio,
  };

  await writeFile(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Read ${logs.length} correction logs.`);
  console.log(`Accepted ${validLogs.length} correction logs.`);
  console.log(`Rejected ${rejectedLogs.length} correction logs.`);
  console.log(`Removed ${dedupeResult.removedCount} duplicate examples.`);
  console.log(`Wrote ${split.train.length} training examples.`);
  console.log(`Wrote ${split.validation.length} validation examples.`);
  console.log(`Train output: ${formatPathForReport(trainOutputPath)}`);
  console.log(`Validation output: ${formatPathForReport(validationOutputPath)}`);
  console.log(`Report output: ${formatPathForReport(reportOutputPath)}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate JSONL: ${message}`);
  process.exitCode = 1;
});
