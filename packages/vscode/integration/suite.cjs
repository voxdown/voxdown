// The checks, run inside VS Code with the extension loaded.
const assert = require("node:assert/strict");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(check, what, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await wait(100);
  }
}

async function run() {
  const folder = process.env.VOXDOWN_EXAMPLES;
  const files = readdirSync(folder).filter((name) => name.endsWith(".vxd"));
  assert.ok(files.length >= 4, "the examples are there");

  for (const name of files) {
    const document = await vscode.workspace.openTextDocument(join(folder, name));
    await vscode.window.showTextDocument(document);
    assert.equal(document.languageId, "voxdown", `${name} opens as VoxDown`);
    const extension = vscode.extensions.all.find((entry) => entry.packageJSON.name === "voxdown");
    await until(() => extension?.isActive, "the extension to start");
    await wait(500);
    assert.deepEqual(vscode.languages.getDiagnostics(document.uri), [], `${name} has no warnings`);
    const symbols = await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      document.uri,
    );
    assert.ok(Array.isArray(symbols) && symbols.length > 0, `${name} has an outline`);
    console.log(`${name}: VoxDown, no warnings, ${symbols.length} outline entries`);
  }

  // A mistake shows as a warning with its code, and goes when it is fixed.
  const draft = await vscode.workspace.openTextDocument({
    language: "voxdown",
    content: "@Gerald “Could you not?\n",
  });
  const editor = await vscode.window.showTextDocument(draft);
  const warnings = await until(() => {
    const found = vscode.languages.getDiagnostics(draft.uri);
    return found.length ? found : null;
  }, "a warning for an unclosed quote");
  assert.ok(warnings.some((d) => d.code === "unclosed-quote" && d.source === "voxdown"));
  console.log(`a mistake: ${warnings.map((d) => d.code).join(", ")}`);
  await editor.edit((edit) => edit.insert(new vscode.Position(0, 23), "”"));
  await until(() => vscode.languages.getDiagnostics(draft.uri).length === 0, "the warning to go");
  console.log("fixed: the warning goes");

  // The commands run.
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(join(folder, files[0])),
  );
  await vscode.commands.executeCommand("voxdown.openPreview");
  await wait(500);
  const preview = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.input instanceof vscode.TabInputWebview);
  assert.ok(preview, "the script preview opens");
  console.log(`preview: "${preview.label}"`);
  await vscode.commands.executeCommand("voxdown.showCheatSheet");
  await wait(500);
  console.log("cheat sheet: opened");
}

module.exports = { run };
