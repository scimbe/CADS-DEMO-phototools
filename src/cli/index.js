"use strict";

module.exports = async function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === "organize") return require("./organizeCommand")(rest);
  process.stderr.write("Usage: phototools organize <srcDir> --out <dir> [--move] [--watermark-text <text>] [--font <path>] [--vision] [--contact-sheet] [--gallery] [--summary]\n");
  return 2;
};
