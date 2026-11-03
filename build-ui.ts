const transpiler = new Bun.Transpiler({ loader: "tsx", autoImportJSX: true, target: "browser", tsconfig: { compilerOptions: { jsx: "react-jsx" } } });
for (const name of ["status-item", "leading-navigation", "settings", "workspace", "updates"]) {
  await Bun.write(`${name}.js`, transpiler.transformSync(await Bun.file(`src/${name}.tsx`).text()).replaceAll("../status-labels.js", "./status-labels.js").replaceAll("../native.js", "./native.js").replaceAll("../theme.js", "./theme.js").replaceAll("../overview.js", "./overview.js").replaceAll("../campaigns.js", "./campaigns.js").replaceAll('"@/', '"@nyssance/shadcn/vega/'));
}
