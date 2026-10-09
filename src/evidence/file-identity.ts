/**
 * Whether two stats describe the same file.
 *
 * A path-based stat leaves `dev` at 0 on Windows under some Node versions while the handle-based stat
 * of the same file reports the volume serial, so comparing the two literally rejects every file that
 * was just opened. 0 means "not reported": the inode still has to match, and both devices are compared
 * whenever both report one. The MaaLogAnalyzer reader that loads MaaFramework logs applies the same
 * rule.
 *
 * This is an internal module. It is deliberately not re-exported by `evidence/index.ts`, because the
 * rule exists to guard file reads rather than to describe evidence.
 */
export function sameFileIdentity(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return (left.dev === right.dev || left.dev === 0 || right.dev === 0) && left.ino === right.ino;
}
