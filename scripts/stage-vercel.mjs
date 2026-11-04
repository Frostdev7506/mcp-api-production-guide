import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(root, ".deploy");
// An explicit source list keeps recordings, private env files and unrelated work out.
const files = ["api.ts", "auth.ts", "mcp.ts", "hosted-api.ts", "hosted-mcp.ts"];
for (const service of ["api", "mcp"]) {
  const directory = resolve(destination, service);
  await mkdir(resolve(directory, "src"), { recursive: true });
  for (const file of files) await copyFile(resolve(root, "src", file), resolve(directory, "src", file));
  for (const file of ["package.json", "package-lock.json"]) await copyFile(resolve(root, file), resolve(directory, file));
  const config = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8"));
  config.compilerOptions.rootDir = "src";
  config.include = ["src/**/*.ts"];
  await writeFile(resolve(directory, "tsconfig.json"), JSON.stringify(config, null, 2) + "\n");
  await writeFile(resolve(directory, "src/index.ts"), `import express from "express";\nimport app from "./hosted-${service}.js";\nconst server = express();\nserver.use(app);\nexport default server;\n`);
  await writeFile(resolve(directory, "vercel.json"), JSON.stringify({
    $schema: "https://openapi.vercel.sh/vercel.json", framework: "express", regions: ["iad1"],
  }, null, 2) + "\n");
  await writeFile(resolve(directory, ".vercelignore"), "node_modules\ndist\n.env*\nsecrets\n");
  console.log(directory);
}
