import { build } from "bun"

const result = await build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  compile: {
    target: "bun-windows-x64-modern",
    outfile: "cilantro",
    windows: {
      title: "Cilantro",
      hideConsole: true,
      publisher: "@aarmful",
      copyright: "github.com/klynglabs",
      description: "A lightweight Steam hour booster powered by Bun",
    },
  },
  minify: true,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("Built successfully")
