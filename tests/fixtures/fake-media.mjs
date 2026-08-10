import { writeFile } from "node:fs/promises";

const [mode, ...args] = process.argv.slice(2);
if (mode === "ffprobe") {
  process.stdout.write(JSON.stringify({ format: { duration: "2.5" } }));
} else if (mode === "ffmpeg") {
  const destination = args.at(-1);
  if (!destination) throw new Error("fake ffmpeg destination is missing");
  await writeFile(destination, Buffer.alloc(12));
} else {
  throw new Error(`unknown fake media mode: ${mode}`);
}
