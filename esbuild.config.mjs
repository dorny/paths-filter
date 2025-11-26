import chalk from "chalk";
import { analyzeMetafile, build } from "esbuild";

(async () => {
  try {
    const startTime = Date.now();
    console.info(
      chalk.bold(`🚀 ${chalk.blueBright("paths-filter")} Build\n`),
    );

    const result = await build({
      entryPoints: ["./src/main.ts"],
      outfile: "dist/index.mjs",
      metafile: true,
      bundle: true,
      format: "esm",
      platform: "node",
      target: ["node24"],
      treeShaking: true,
      // Ensure require is properly defined: https://github.com/evanw/esbuild/issues/1921
      banner: {
        js:
          "import { createRequire } from 'module';\n" +
          "const require = createRequire(import.meta.url);",
      },
    });

    const analysis = await analyzeMetafile(result.metafile);
    console.info(`📝 Bundle Analysis:${analysis}`);

    console.info(
      `${chalk.bold.green("✔ Bundled successfully!")} (${
        Date.now() - startTime
      }ms)`,
    );
  } catch (error) {
    console.error(`🧨 ${chalk.red.bold("Failed:")} ${error.message}`);
    console.debug(`📚 ${chalk.blueBright.bold("Stack:")} ${error.stack}`);
    process.exit(1);
  }
})();
