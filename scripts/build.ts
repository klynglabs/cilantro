import { build } from "bun"

const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "build",
  target: "bun",
  minify: true,
  packages: "external",
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("Built successfully")
