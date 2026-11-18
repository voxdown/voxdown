/** Exercise the visible workspace menus; never bypass hidden controls. */
export async function clickWorkspaceAction(page, id) {
  const menus = {
    preferences: "view",
    help: "help",
    example: "help",
    workbench: "tools",
    recent: "file",
    new: "file",
    "save-file": "file",
    "caret-page": "preview",
    "page-source": "preview",
  };
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
