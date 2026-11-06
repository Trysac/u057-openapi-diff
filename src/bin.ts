#!/usr/bin/env node
import { run } from "./cli.js";

const io = {
  stdout: (text: string): void => {
    process.stdout.write(text);
  },
  stderr: (text: string): void => {
    process.stderr.write(text);
  },
};

process.exitCode = await run(process.argv.slice(2), io);
