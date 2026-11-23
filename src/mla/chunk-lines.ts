/**
 * Split text chunks into complete lines without retaining the whole source.
 *
 * Chunk boundaries may fall anywhere, so the splitter carries a partial line across chunks. Line
 * numbers are continuous and source-local, matching the line numbers the merged-source scanners
 * record.
 */
export type LineFeeder = {
  push: (chunk: string) => void;
  finish: () => void;
};

export function createLineFeeder(
  onLine: (line: string, lineNumber: number) => void,
): LineFeeder {
  let pending = "";
  let lineNumber = 0;
  const emit = (line: string): void => {
    lineNumber += 1;
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line, lineNumber);
  };
  return {
    push: (chunk: string): void => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        emit(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    },
    finish: (): void => {
      if (pending.length === 0) return;
      const line = pending;
      pending = "";
      emit(line);
    },
  };
}
