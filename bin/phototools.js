#!/usr/bin/env node
"use strict";

require("dotenv").config();
require("../src/cli/index.js")(process.argv.slice(2))
  .then((exitCode) => {
    if (typeof exitCode === "number") process.exitCode = exitCode;
  })
  .catch((err) => {
    process.stderr.write(`phototools: ${err.message}\n`);
    process.exitCode = process.exitCode || 1;
  });
