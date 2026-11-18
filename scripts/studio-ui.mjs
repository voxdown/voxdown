/** Exercise the visible workspace menus; never bypass hidden controls. */
export async function clickWorkspaceAction(page, id) {
  const menus = {
    preferences: "view",
    help: "help",
    example: "help",
    workbench: "tools",
    recent: "file",
    new: "file",
    download: "file",
    "caret-page": "preview",
    "page-source": "preview",
  };
  if (id === "save-primary") {
    await page.locator("#save-primary").click();
    return;
  }
  if (id === "caret-page" || id === "page-source") await ensurePreview(page);
  const menu = menus[id];
  if (!menu) throw new Error(`Unknown workspace action: ${id}`);
  if (!(await page.locator(`#${id}`).isVisible())) await page.locator(`#${menu}-menu`).click();
  await page.locator(`#${id}`).click();
}
export async function openPreferences(page) {
  if (!(await page.locator("#preferences-dialog").isVisible()))
    await clickWorkspaceAction(page, "preferences");
}
export async function selectPaper(page, value) {
  await openPreferences(page);
  await page.locator("#paper").selectOption(value);
  await page.getByRole("button", { name: "Close preferences", exact: true }).click();
}

/** Reveal the optional preview using its real workspace control. */
export async function ensurePreview(page) {
  if (!(await page.locator("#preview").isVisible())) await page.locator("#preview-toggle").click();
  await page.locator("#preview").waitFor({ state: "visible" });
}
