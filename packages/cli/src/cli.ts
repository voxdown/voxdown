/** `vxd`: runs the command with the process's arguments, files and streams. */
import { nodeIo } from "./node-io";
import { run } from "./run";

// A reader that stops early, such as `vxd export story.vxd | head`, isn't an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    process.exit(error.code === "EPIPE" ? 0 : 2);
  });
}

process.exitCode = await run(process.argv.slice(2), nodeIo());
